/**
 * Workflow Engine for Squad Builder
 *
 * Executes automated workflow sequences with support for:
 * - Sequential and parallel step execution
 * - Conditional branching
 * - Agent task assignment
 * - Notifications
 * - Wait/delay steps
 */

import type {
  Workflow,
  WorkflowExecution,
  WorkflowStep,
  WorkflowStatus,
  StepType,
  AgentTaskConfig,
  ConditionConfig,
  ParallelConfig,
  WaitConfig,
  NotifyConfig,
  Task,
} from './types';
import { SupabaseClient } from './supabase-client';
import { AgentOrchestrator } from './orchestrator';
import { sendDiscordNotification, buildTaskEmbed } from './discord';

/**
 * Result of a workflow step execution
 */
interface StepResult {
  success: boolean;
  nextStepId?: string;
  error?: string;
  output?: unknown;
}

/**
 * Workflow Engine
 * Executes workflow definitions step by step
 */
export class WorkflowEngine {
  private readonly supabase: SupabaseClient;
  private readonly orchestrator: AgentOrchestrator;
  private readonly activeExecutions: Map<string, WorkflowExecution> = new Map();

  constructor(supabase: SupabaseClient, orchestrator: AgentOrchestrator) {
    this.supabase = supabase;
    this.orchestrator = orchestrator;
  }

  // =============================================================================
  // WORKFLOW EXECUTION
  // =============================================================================

  /**
   * Start executing a workflow
   */
  async startWorkflow(
    workflow: Workflow,
    input?: Record<string, unknown>,
    taskId?: string
  ): Promise<WorkflowExecution> {
    // Create execution record
    const execution = await this.supabase.createWorkflowExecution({
      workflow_id: workflow.id,
      task_id: taskId,
      current_step: 0,
      status: 'running',
      context: {
        input: input || {},
        stepResults: {},
      },
    });

    this.activeExecutions.set(execution.id, execution);

    // Start execution in background
    this.runWorkflow(workflow, execution).catch((err) => {
      console.error(`[Workflow] Execution ${execution.id} failed:`, err);
    });

    return execution;
  }

  /**
   * Stop a running workflow
   */
  async stopWorkflow(executionId: string): Promise<WorkflowExecution | null> {
    const execution = this.activeExecutions.get(executionId);
    if (!execution) return null;

    execution.status = 'paused';
    await this.supabase.updateWorkflowExecution(executionId, {
      status: 'paused',
    });

    this.activeExecutions.delete(executionId);
    return execution;
  }

  /**
   * Resume a paused workflow
   */
  async resumeWorkflow(executionId: string): Promise<WorkflowExecution | null> {
    const execution = await this.supabase.getWorkflowExecution(executionId);
    if (!execution || execution.status !== 'paused') return null;

    const workflow = await this.supabase.getWorkflow(execution.workflow_id);
    if (!workflow) return null;

    execution.status = 'running';
    await this.supabase.updateWorkflowExecution(executionId, {
      status: 'running',
    });

    this.activeExecutions.set(executionId, execution);

    // Resume execution from current step
    this.runWorkflow(workflow, execution).catch((err) => {
      console.error(`[Workflow] Execution ${executionId} failed:`, err);
    });

    return execution;
  }

  /**
   * Run the workflow execution loop
   */
  private async runWorkflow(
    workflow: Workflow,
    execution: WorkflowExecution
  ): Promise<void> {
    console.log(`[Workflow] Starting execution ${execution.id} for workflow ${workflow.nome}`);

    try {
      let currentStepIndex = execution.current_step;
      const context = execution.context as {
        input: Record<string, unknown>;
        stepResults: Record<string, unknown>;
      };

      while (currentStepIndex < workflow.steps.length) {
        // Check if execution was stopped
        if (!this.activeExecutions.has(execution.id)) {
          console.log(`[Workflow] Execution ${execution.id} was stopped`);
          return;
        }

        const step = workflow.steps[currentStepIndex];
        console.log(`[Workflow] Executing step ${step.id} (${step.type})`);

        // Update current step in database
        await this.supabase.updateWorkflowExecution(execution.id, {
          current_step: currentStepIndex,
        });

        // Execute the step
        const result = await this.executeStep(step, context);

        // Store step result
        context.stepResults[step.id] = result.output;

        if (!result.success) {
          // Step failed
          if (step.onFailure) {
            // Jump to failure step
            const failureIndex = workflow.steps.findIndex((s) => s.id === step.onFailure);
            if (failureIndex >= 0) {
              currentStepIndex = failureIndex;
              continue;
            }
          }

          // No failure handler, fail the workflow
          await this.failExecution(execution.id, result.error || 'Step failed');
          return;
        }

        // Determine next step
        if (result.nextStepId) {
          const nextIndex = workflow.steps.findIndex((s) => s.id === result.nextStepId);
          if (nextIndex >= 0) {
            currentStepIndex = nextIndex;
            continue;
          }
        }

        // Move to next step in sequence
        if (step.onSuccess) {
          const successIndex = workflow.steps.findIndex((s) => s.id === step.onSuccess);
          if (successIndex >= 0) {
            currentStepIndex = successIndex;
            continue;
          }
        }

        currentStepIndex++;
      }

      // Workflow completed successfully
      await this.completeExecution(execution.id, context.stepResults);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.failExecution(execution.id, errorMessage);
    }
  }

  // =============================================================================
  // STEP EXECUTION
  // =============================================================================

  /**
   * Execute a single workflow step
   */
  private async executeStep(
    step: WorkflowStep,
    context: { input: Record<string, unknown>; stepResults: Record<string, unknown> }
  ): Promise<StepResult> {
    switch (step.type) {
      case 'agent_task':
        return this.executeAgentTask(step.config as AgentTaskConfig, context);

      case 'condition':
        return this.executeCondition(step.config as ConditionConfig, context);

      case 'parallel':
        return this.executeParallel(step.config as ParallelConfig, context);

      case 'wait':
        return this.executeWait(step.config as WaitConfig, context);

      case 'notify':
        return this.executeNotify(step.config as NotifyConfig, context);

      default:
        return { success: false, error: `Unknown step type: ${step.type}` };
    }
  }

  /**
   * Execute an agent task step
   */
  private async executeAgentTask(
    config: AgentTaskConfig,
    context: { input: Record<string, unknown>; stepResults: Record<string, unknown> }
  ): Promise<StepResult> {
    try {
      // Get or create a task for this action
      const taskInput = {
        ...context.input,
        ...config.input,
      };

      // If we have a task ID from context, use it
      const taskId = context.input.taskId as string | undefined;

      if (taskId) {
        // Execute existing task
        const result = await this.orchestrator.executeTask({
          taskId,
          agentId: config.agentId,
          context: taskInput,
        });

        // Wait for completion with timeout
        const timeout = config.timeout || 300000; // 5 minutes default
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
          const progress = this.orchestrator.getTaskProgress(taskId);

          if (!progress) break;

          if (progress.status === 'completed') {
            return {
              success: true,
              output: { executionId: result.executionId, status: 'completed' },
            };
          }

          if (progress.status === 'failed') {
            return {
              success: false,
              error: 'Task execution failed',
              output: { executionId: result.executionId, status: 'failed' },
            };
          }

          if (progress.status === 'blocked') {
            // Task is blocked, this might be expected
            return {
              success: true,
              output: { executionId: result.executionId, status: 'blocked', blocked: true },
            };
          }

          // Wait before checking again
          await this.delay(2000);
        }

        return {
          success: false,
          error: 'Task execution timed out',
        };
      }

      // No task ID, just return success (action was logged)
      return {
        success: true,
        output: { action: config.action, message: 'Action recorded' },
      };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute a condition step
   */
  private async executeCondition(
    config: ConditionConfig,
    context: { input: Record<string, unknown>; stepResults: Record<string, unknown> }
  ): Promise<StepResult> {
    try {
      // Evaluate the condition expression
      const result = this.evaluateCondition(config.check, context);

      return {
        success: true,
        nextStepId: result ? config.trueStep : config.falseStep,
        output: { condition: config.check, result },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Condition evaluation failed',
      };
    }
  }

  /**
   * Execute parallel steps
   */
  private async executeParallel(
    config: ParallelConfig,
    context: { input: Record<string, unknown>; stepResults: Record<string, unknown> }
  ): Promise<StepResult> {
    // Note: In a real implementation, we'd need access to the workflow steps
    // to execute them in parallel. For now, just return success.
    return {
      success: true,
      output: {
        parallelSteps: config.steps,
        message: 'Parallel execution placeholder',
      },
    };
  }

  /**
   * Execute a wait step
   */
  private async executeWait(
    config: WaitConfig,
    _context: { input: Record<string, unknown>; stepResults: Record<string, unknown> }
  ): Promise<StepResult> {
    if (config.duration) {
      await this.delay(config.duration);
      return { success: true, output: { waited: config.duration } };
    }

    if (config.until) {
      // Would wait until condition is met
      // For now, just return success
      return { success: true, output: { until: config.until } };
    }

    if (config.event) {
      // Would wait for an event
      // For now, just return success
      return { success: true, output: { event: config.event } };
    }

    return { success: true };
  }

  /**
   * Execute a notification step
   */
  private async executeNotify(
    config: NotifyConfig,
    context: { input: Record<string, unknown>; stepResults: Record<string, unknown> }
  ): Promise<StepResult> {
    try {
      // Interpolate message with context
      let message = config.message;
      for (const [key, value] of Object.entries(context.input)) {
        message = message.replace(`{{${key}}}`, String(value));
      }
      for (const [key, value] of Object.entries(context.stepResults)) {
        message = message.replace(`{{results.${key}}}`, JSON.stringify(value));
      }

      if (config.channel === 'discord' && config.target) {
        const result = await sendDiscordNotification(config.target, {
          type: 'message',
          content: message,
          embed: config.embed,
        });

        if (!result.success) {
          return { success: false, error: result.error };
        }
      }

      // Other channels (email, webhook) would be implemented similarly

      return {
        success: true,
        output: { channel: config.channel, message },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Notification failed',
      };
    }
  }

  // =============================================================================
  // CONDITION EVALUATION
  // =============================================================================

  /**
   * Evaluate a simple condition expression
   * Supports: ==, !=, >, <, >=, <=, contains, exists
   */
  private evaluateCondition(
    expression: string,
    context: { input: Record<string, unknown>; stepResults: Record<string, unknown> }
  ): boolean {
    // Simple expression parser
    // Format: "variable operator value" or "variable.exists"

    // Check for exists
    if (expression.endsWith('.exists')) {
      const varName = expression.replace('.exists', '');
      const value = this.resolveVariable(varName, context);
      return value !== undefined && value !== null;
    }

    // Check for contains
    if (expression.includes(' contains ')) {
      const [varPart, valuePart] = expression.split(' contains ').map((s) => s.trim());
      const variable = this.resolveVariable(varPart, context);
      const searchValue = valuePart.replace(/['"]/g, '');

      if (Array.isArray(variable)) {
        return variable.includes(searchValue);
      }
      if (typeof variable === 'string') {
        return variable.includes(searchValue);
      }
      return false;
    }

    // Parse comparison operators
    const operators = ['===', '!==', '==', '!=', '>=', '<=', '>', '<'];
    for (const op of operators) {
      if (expression.includes(op)) {
        const [left, right] = expression.split(op).map((s) => s.trim());
        const leftValue = this.resolveVariable(left, context);
        const rightValue = this.parseValue(right);

        switch (op) {
          case '===':
          case '==':
            return leftValue === rightValue;
          case '!==':
          case '!=':
            return leftValue !== rightValue;
          case '>':
            return Number(leftValue) > Number(rightValue);
          case '<':
            return Number(leftValue) < Number(rightValue);
          case '>=':
            return Number(leftValue) >= Number(rightValue);
          case '<=':
            return Number(leftValue) <= Number(rightValue);
        }
      }
    }

    // If no operator, treat as truthy check
    const value = this.resolveVariable(expression, context);
    return Boolean(value);
  }

  /**
   * Resolve a variable from context
   * Supports: input.*, results.*, or direct value
   */
  private resolveVariable(
    path: string,
    context: { input: Record<string, unknown>; stepResults: Record<string, unknown> }
  ): unknown {
    const trimmed = path.trim();

    if (trimmed.startsWith('input.')) {
      const key = trimmed.replace('input.', '');
      return this.getNestedValue(context.input, key);
    }

    if (trimmed.startsWith('results.')) {
      const key = trimmed.replace('results.', '');
      return this.getNestedValue(context.stepResults, key);
    }

    // Try input first, then results
    let value = this.getNestedValue(context.input, trimmed);
    if (value === undefined) {
      value = this.getNestedValue(context.stepResults, trimmed);
    }

    return value;
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * Parse a value from string representation
   */
  private parseValue(value: string): unknown {
    const trimmed = value.trim();

    // Boolean
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;

    // Null
    if (trimmed === 'null') return null;

    // Number
    const num = Number(trimmed);
    if (!isNaN(num)) return num;

    // String (remove quotes)
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }

    return trimmed;
  }

  // =============================================================================
  // EXECUTION STATE MANAGEMENT
  // =============================================================================

  /**
   * Complete a workflow execution
   */
  private async completeExecution(
    executionId: string,
    results: Record<string, unknown>
  ): Promise<void> {
    await this.supabase.updateWorkflowExecution(executionId, {
      status: 'completed',
      context: { results },
      completed_at: new Date().toISOString(),
    });

    this.activeExecutions.delete(executionId);
    console.log(`[Workflow] Execution ${executionId} completed`);
  }

  /**
   * Fail a workflow execution
   */
  private async failExecution(
    executionId: string,
    error: string
  ): Promise<void> {
    await this.supabase.updateWorkflowExecution(executionId, {
      status: 'failed',
      context: { error },
      completed_at: new Date().toISOString(),
    });

    this.activeExecutions.delete(executionId);
    console.error(`[Workflow] Execution ${executionId} failed: ${error}`);
  }

  /**
   * Get execution status
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.activeExecutions.get(executionId);
  }

  /**
   * Get all active executions
   */
  getActiveExecutions(): WorkflowExecution[] {
    return Array.from(this.activeExecutions.values());
  }

  // =============================================================================
  // UTILITY
  // =============================================================================

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// WORKFLOW TEMPLATES
// =============================================================================

/**
 * Pre-built workflow templates for common use cases
 */
export const WORKFLOW_TEMPLATES: Record<string, Omit<Workflow, 'id' | 'squad_id' | 'created_at' | 'updated_at'>> = {
  'code-review': {
    nome: 'Code Review Pipeline',
    descricao: 'Automated code review workflow with testing',
    steps: [
      {
        id: 'analyze',
        type: 'agent_task',
        name: 'Analyze Code',
        config: {
          agentType: 'reviewer',
          action: 'analyze_code',
          timeout: 300000,
        } as AgentTaskConfig,
        onSuccess: 'test',
        onFailure: 'notify_failure',
      },
      {
        id: 'test',
        type: 'agent_task',
        name: 'Run Tests',
        config: {
          agentType: 'tester',
          action: 'run_tests',
          timeout: 600000,
        } as AgentTaskConfig,
        onSuccess: 'check_results',
        onFailure: 'notify_failure',
      },
      {
        id: 'check_results',
        type: 'condition',
        name: 'Check Test Results',
        config: {
          check: 'results.test.success == true',
          trueStep: 'approve',
          falseStep: 'notify_failure',
        } as ConditionConfig,
      },
      {
        id: 'approve',
        type: 'notify',
        name: 'Notify Approval',
        config: {
          channel: 'discord',
          message: 'Code review passed! Ready for merge.',
        } as NotifyConfig,
      },
      {
        id: 'notify_failure',
        type: 'notify',
        name: 'Notify Failure',
        config: {
          channel: 'discord',
          message: 'Code review failed. Please check the issues.',
        } as NotifyConfig,
      },
    ],
    triggers: [
      { type: 'manual', config: {} },
      { type: 'discord_command', config: { command: '/review' } },
    ],
    ativo: true,
  },

  'task-assignment': {
    nome: 'Auto Task Assignment',
    descricao: 'Automatically assign and execute new tasks',
    steps: [
      {
        id: 'assign',
        type: 'agent_task',
        name: 'Assign Task',
        config: {
          action: 'auto_assign',
        } as AgentTaskConfig,
        onSuccess: 'execute',
      },
      {
        id: 'execute',
        type: 'agent_task',
        name: 'Execute Task',
        config: {
          action: 'execute',
          timeout: 900000, // 15 minutes
        } as AgentTaskConfig,
        onSuccess: 'notify_complete',
        onBlock: 'notify_blocked',
      },
      {
        id: 'notify_complete',
        type: 'notify',
        name: 'Notify Completion',
        config: {
          channel: 'discord',
          message: 'Task "{{input.taskTitle}}" completed successfully!',
        } as NotifyConfig,
      },
      {
        id: 'notify_blocked',
        type: 'notify',
        name: 'Notify Blocked',
        config: {
          channel: 'discord',
          message: 'Task "{{input.taskTitle}}" is blocked and needs attention.',
        } as NotifyConfig,
      },
    ],
    triggers: [
      { type: 'task_status', config: { toStatus: 'backlog' } },
    ],
    ativo: true,
  },

  'daily-standup': {
    nome: 'Daily Standup Report',
    descricao: 'Generate and send daily standup summary',
    steps: [
      {
        id: 'gather',
        type: 'agent_task',
        name: 'Gather Status',
        config: {
          agentType: 'assistant',
          action: 'gather_standup_data',
        } as AgentTaskConfig,
        onSuccess: 'generate',
      },
      {
        id: 'generate',
        type: 'agent_task',
        name: 'Generate Report',
        config: {
          agentType: 'writer',
          action: 'write_standup_report',
        } as AgentTaskConfig,
        onSuccess: 'send',
      },
      {
        id: 'send',
        type: 'notify',
        name: 'Send Report',
        config: {
          channel: 'discord',
          message: '📊 Daily Standup\n{{results.generate.report}}',
        } as NotifyConfig,
      },
    ],
    triggers: [
      { type: 'schedule', config: { cron: '0 9 * * 1-5', timezone: 'America/Sao_Paulo' } },
    ],
    ativo: true,
  },
};
