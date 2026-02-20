/**
 * OpenClaw Executor for Squad Builder
 *
 * Handles real task execution by communicating with the OpenClaw (Moltbot)
 * gateway running inside the Cloudflare Sandbox container.
 *
 * Uses two communication methods:
 * - containerFetch: HTTP requests to the gateway API on port 18789
 * - startProcess: CLI commands via the `clawdbot` binary
 */

import type { Sandbox, Process } from '@cloudflare/sandbox';
import type { Agente, Task } from './types';
import { waitForProcess } from '../gateway/utils';
import { MOLTBOT_PORT } from '../config';

/** Maximum time to wait for a CLI command to complete */
const CLI_TIMEOUT_MS = 20_000;

/** Maximum time to wait for a chat message response */
const CHAT_TIMEOUT_MS = 120_000;

/** Poll interval when waiting for process completion */
const POLL_INTERVAL_MS = 1_000;

/**
 * Result of an OpenClaw execution
 */
export interface OpenClawResult {
  success: boolean;
  response: string;
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
  durationMs: number;
}

/**
 * Options for executing a task via OpenClaw
 */
export interface ExecuteOptions {
  /** System prompt override (from agent persona) */
  systemPrompt?: string;
  /** Maximum wait time in ms (default: CHAT_TIMEOUT_MS) */
  timeoutMs?: number;
  /** Additional context to include in the message */
  context?: Record<string, unknown>;
}

/**
 * OpenClaw Executor
 *
 * Sends tasks to the OpenClaw gateway for AI-powered execution.
 * The gateway must already be running inside the sandbox container.
 */
export class OpenClawExecutor {
  private readonly sandbox: Sandbox;

  constructor(sandbox: Sandbox) {
    this.sandbox = sandbox;
  }

  /**
   * Execute a task by sending it as a chat message to the OpenClaw gateway.
   *
   * Builds a prompt from the agent persona + task description and sends it
   * to the gateway via the CLI. The gateway routes it to the configured AI
   * model (Claude/Anthropic) and returns the response.
   */
  async executeTask(
    agent: Agente,
    task: Task,
    options: ExecuteOptions = {}
  ): Promise<OpenClawResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? CHAT_TIMEOUT_MS;

    // Build the message to send to the AI
    const message = this.buildTaskMessage(agent, task, options);

    console.log(
      `[OpenClaw] Executing task "${task.titulo}" with agent "${agent.nome}"`
    );
    console.log(`[OpenClaw] Message length: ${message.length} chars`);

    try {
      // First, verify the gateway is reachable
      const gatewayReady = await this.isGatewayReady();
      if (!gatewayReady) {
        return {
          success: false,
          response: 'OpenClaw gateway is not running or not reachable',
          stdout: '',
          stderr: 'Gateway not ready on port ' + MOLTBOT_PORT,
          exitCode: undefined,
          durationMs: Date.now() - startTime,
        };
      }

      // Send the message via the gateway HTTP API
      const result = await this.sendChatMessage(message, timeoutMs);
      const durationMs = Date.now() - startTime;

      console.log(
        `[OpenClaw] Task completed in ${durationMs}ms, success: ${result.success}`
      );

      return {
        ...result,
        durationMs,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      console.error(`[OpenClaw] Execution error:`, errorMessage);

      return {
        success: false,
        response: `Execution failed: ${errorMessage}`,
        stdout: '',
        stderr: errorMessage,
        exitCode: undefined,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Send a chat message to the OpenClaw gateway via its HTTP API.
   *
   * The gateway exposes a REST endpoint for sending messages. We use
   * containerFetch to reach it inside the sandbox.
   */
  private async sendChatMessage(
    message: string,
    timeoutMs: number
  ): Promise<Omit<OpenClawResult, 'durationMs'>> {
    // Try HTTP API first (faster, more reliable)
    try {
      const httpResult = await this.sendViaHttpApi(message, timeoutMs);
      if (httpResult.success) {
        return httpResult;
      }
      console.log(
        '[OpenClaw] HTTP API failed, falling back to CLI:',
        httpResult.stderr
      );
    } catch (error) {
      console.log(
        '[OpenClaw] HTTP API error, falling back to CLI:',
        error instanceof Error ? error.message : error
      );
    }

    // Fall back to CLI
    return this.sendViaCli(message, timeoutMs);
  }

  /**
   * Send message via the gateway HTTP API using containerFetch
   */
  private async sendViaHttpApi(
    message: string,
    timeoutMs: number
  ): Promise<Omit<OpenClawResult, 'durationMs'>> {
    const url = `http://localhost:${MOLTBOT_PORT}/api/v1/chat`;

    const request = new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        stream: false,
      }),
    });

    // Use AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.sandbox.containerFetch(
        request,
        MOLTBOT_PORT
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          response: '',
          stdout: '',
          stderr: `HTTP ${response.status}: ${errorText}`,
          exitCode: undefined,
        };
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const data = (await response.json()) as Record<string, unknown>;
        const responseText =
          (data.response as string) ||
          (data.message as string) ||
          (data.content as string) ||
          (data.text as string) ||
          JSON.stringify(data);

        return {
          success: true,
          response: responseText,
          stdout: responseText,
          stderr: '',
          exitCode: 0,
        };
      }

      const text = await response.text();
      return {
        success: true,
        response: text,
        stdout: text,
        stderr: '',
        exitCode: 0,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      const errorMsg =
        error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        response: '',
        stdout: '',
        stderr: `HTTP API error: ${errorMsg}`,
        exitCode: undefined,
      };
    }
  }

  /**
   * Send message via the clawdbot CLI (fallback method)
   *
   * Uses `clawdbot chat` command which connects to the gateway via WebSocket
   * and sends a single message, then exits.
   */
  private async sendViaCli(
    message: string,
    timeoutMs: number
  ): Promise<Omit<OpenClawResult, 'durationMs'>> {
    // Escape the message for shell safety
    const escapedMessage = this.escapeShellArg(message);

    // Note: CLI is still named "clawdbot" until upstream renames it
    const command = `clawdbot chat --message ${escapedMessage} --url ws://localhost:${MOLTBOT_PORT} --no-interactive`;

    console.log('[OpenClaw] Running CLI command');

    const proc = await this.sandbox.startProcess(command);

    // Wait for the process to complete
    await this.waitForCompletion(proc, timeoutMs);

    const logs = await proc.getLogs();
    const stdout = logs.stdout || '';
    const stderr = logs.stderr || '';

    // Extract the AI response from stdout
    // The CLI may output additional log lines, so we try to extract just the response
    const response = this.extractResponse(stdout);
    const success =
      proc.exitCode === 0 ||
      (response.length > 0 && !stderr.includes('Error'));

    return {
      success,
      response,
      stdout,
      stderr,
      exitCode: proc.exitCode,
    };
  }

  /**
   * Check if the OpenClaw gateway is running and reachable
   */
  async isGatewayReady(): Promise<boolean> {
    try {
      const url = `http://localhost:${MOLTBOT_PORT}/`;
      const request = new Request(url);
      const response = await this.sandbox.containerFetch(
        request,
        MOLTBOT_PORT
      );
      return response.status < 500;
    } catch {
      return false;
    }
  }

  /**
   * Get the OpenClaw/clawdbot version running in the container
   */
  async getVersion(): Promise<string> {
    try {
      const proc = await this.sandbox.startProcess('clawdbot --version');
      await waitForProcess(proc, CLI_TIMEOUT_MS);
      const logs = await proc.getLogs();
      return (logs.stdout || '').trim();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Build the task message to send to the AI.
   *
   * Combines the agent persona (system prompt), task details,
   * and any additional context into a single message.
   */
  private buildTaskMessage(
    agent: Agente,
    task: Task,
    options: ExecuteOptions
  ): string {
    const parts: string[] = [];

    // Add system prompt / persona context
    if (options.systemPrompt) {
      parts.push(`[System Context]\n${options.systemPrompt}`);
    } else if (agent.soul) {
      parts.push(`[Agent Persona]\n${agent.soul}`);
    }

    // Add agent rules as constraints
    if (agent.regras) {
      const rules: string[] = [];
      if (agent.regras.allowedTaskTypes?.length) {
        rules.push(
          `Specialization: ${agent.regras.allowedTaskTypes.join(', ')}`
        );
      }
      if (agent.regras.forbiddenActions?.length) {
        rules.push(
          `Forbidden actions: ${agent.regras.forbiddenActions.join(', ')}`
        );
      }
      if (agent.regras.mustAskBefore?.length) {
        rules.push(
          `Must ask approval before: ${agent.regras.mustAskBefore.join(', ')}`
        );
      }
      if (rules.length > 0) {
        parts.push(`[Rules]\n${rules.join('\n')}`);
      }
    }

    // Add the task itself
    parts.push(`[Task]\nTitle: ${task.titulo}`);

    if (task.descricao) {
      parts.push(`Description: ${task.descricao}`);
    }

    if (task.priority !== undefined) {
      parts.push(`Priority: ${task.priority}`);
    }

    // Add extra context
    if (options.context && Object.keys(options.context).length > 0) {
      parts.push(`[Additional Context]\n${JSON.stringify(options.context, null, 2)}`);
    }

    // Add output instructions
    parts.push(
      `[Instructions]\nPlease complete the task described above. ` +
        `Provide a clear, actionable response. ` +
        `If you cannot complete the task or need more information, explain what is blocking you.`
    );

    return parts.join('\n\n');
  }

  /**
   * Wait for a process to complete with timeout
   */
  private async waitForCompletion(
    proc: Process,
    timeoutMs: number
  ): Promise<void> {
    const maxAttempts = Math.ceil(timeoutMs / POLL_INTERVAL_MS);
    let attempts = 0;

    while (proc.status === 'running' && attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      attempts++;
    }

    if (proc.status === 'running') {
      console.warn('[OpenClaw] Process timed out, killing...');
      try {
        await proc.kill();
      } catch {
        // Ignore kill errors
      }
    }
  }

  /**
   * Extract the AI response from CLI output.
   *
   * The CLI may output log lines, connection info, etc. before the actual
   * response. We try to extract just the meaningful content.
   */
  private extractResponse(stdout: string): string {
    if (!stdout) return '';

    const lines = stdout.split('\n');
    const responseLines: string[] = [];
    let inResponse = false;

    for (const line of lines) {
      // Skip common log/info prefixes
      if (
        line.startsWith('[') ||
        line.startsWith('Connecting') ||
        line.startsWith('Connected') ||
        line.startsWith('Disconnected') ||
        line.startsWith('WebSocket') ||
        line.trim() === ''
      ) {
        // If we were already collecting response, an empty line is part of it
        if (inResponse && line.trim() === '') {
          responseLines.push(line);
        }
        continue;
      }

      inResponse = true;
      responseLines.push(line);
    }

    // If no filtering helped, return the full output
    const filtered = responseLines.join('\n').trim();
    return filtered || stdout.trim();
  }

  /**
   * Escape a string for safe use as a shell argument
   */
  private escapeShellArg(arg: string): string {
    // Use single quotes and escape any single quotes within
    return "'" + arg.replace(/'/g, "'\\''") + "'";
  }
}
