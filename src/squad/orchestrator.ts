/**
 * Agent Orchestrator for Squad Builder
 *
 * Coordinates multiple AI agents, manages task assignment,
 * and handles the execution lifecycle of tasks.
 */

import type { Sandbox } from '@cloudflare/sandbox';
import type {
  Squad,
  Agente,
  Task,
  TaskExecution,
  TaskProgress,
  AgentInstance,
  AgentStatus,
  AgentMetrics,
  ExecuteTaskRequest,
  ExecuteTaskResponse,
} from './types';
import { TaskQueue } from './queue';
import { PersonaManager } from './persona';
import { SupabaseClient } from './supabase-client';
import { getNotificationService } from './notification-service';

/**
 * Agent Orchestrator
 * Central coordinator for multi-agent task execution
 */
export class AgentOrchestrator {
  private readonly supabase: SupabaseClient;
  private readonly queue: TaskQueue;
  private readonly personas: PersonaManager;
  private readonly agents: Map<string, AgentInstance> = new Map();
  private readonly sandbox?: Sandbox;
  private isRunning: boolean = false;
  private processingInterval?: ReturnType<typeof setInterval>;

  constructor(
    supabase: SupabaseClient,
    options?: {
      sandbox?: Sandbox;
      maxRetries?: number;
      processingIntervalMs?: number;
    }
  ) {
    this.supabase = supabase;
    this.queue = new TaskQueue({ maxRetries: options?.maxRetries ?? 3 });
    this.personas = new PersonaManager();
    this.sandbox = options?.sandbox;
  }

  // =============================================================================
  // INITIALIZATION
  // =============================================================================

  /**
   * Initialize the orchestrator with agents from a squad
   */
  async initialize(squadId: string): Promise<void> {
    console.log(`[Orchestrator] Initializing for squad ${squadId}`);

    // Load active agents
    const agentes = await this.supabase.getActiveAgentes(squadId);

    for (const agente of agentes) {
      this.registerAgent(agente);
    }

    // Load backlog tasks
    const tasks = await this.supabase.getTasksByStatus(squadId, 'backlog');
    this.queue.syncFromTasks(tasks);

    console.log(
      `[Orchestrator] Initialized with ${agentes.length} agents and ${tasks.length} queued tasks`
    );
  }

  /**
   * Register an agent instance
   */
  registerAgent(agente: Agente): AgentInstance {
    const instance: AgentInstance = {
      id: agente.id,
      agente,
      status: 'idle',
      metrics: {
        tasksCompleted: 0,
        tasksFailed: 0,
        tasksBlocked: 0,
        averageTaskDuration: 0,
        tokensUsed: 0,
      },
    };

    this.agents.set(agente.id, instance);
    this.personas.register(agente);

    console.log(`[Orchestrator] Registered agent: ${agente.nome} (${agente.id})`);
    return instance;
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): boolean {
    const removed = this.agents.delete(agentId);
    this.personas.unregister(agentId);
    return removed;
  }

  // =============================================================================
  // TASK EXECUTION
  // =============================================================================

  /**
   * Execute a task with an agent
   */
  async executeTask(request: ExecuteTaskRequest): Promise<ExecuteTaskResponse> {
    const { taskId, agentId, priority, context } = request;

    // Get task from database
    const task = await this.supabase.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Select agent
    let selectedAgent: AgentInstance | undefined;

    if (agentId) {
      selectedAgent = this.agents.get(agentId);
      if (!selectedAgent) {
        throw new Error(`Agent ${agentId} not found or not registered`);
      }
    } else {
      selectedAgent = this.selectAgent(task);
      if (!selectedAgent) {
        throw new Error('No available agent to handle this task');
      }
    }

    // Update priority if specified
    if (priority !== undefined) {
      task.priority = priority;
    }

    // Start execution tracking
    const execution = this.queue.startExecution(task.id, selectedAgent.id);

    // Update agent status
    selectedAgent.status = 'working';
    selectedAgent.currentTask = task;
    selectedAgent.lastActivity = new Date().toISOString();

    // Update task status in database
    await this.supabase.assignTask(task.id, selectedAgent.id);

    // Send notification: task assigned
    const notificationService = getNotificationService();
    await notificationService.notify(task.squad_id, {
      event: 'task_assigned',
      task,
      agent: selectedAgent.agente,
    });

    // Execute the task asynchronously
    this.runTaskExecution(selectedAgent, task, execution, context).catch((err) => {
      console.error(`[Orchestrator] Task execution error:`, err);
    });

    return {
      executionId: execution.id,
      taskId: task.id,
      agentId: selectedAgent.id,
      status: execution.status,
    };
  }

  /**
   * Run the actual task execution
   */
  private async runTaskExecution(
    agent: AgentInstance,
    task: Task,
    execution: TaskExecution,
    context?: Record<string, unknown>
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Build system prompt with persona
      const systemPrompt = this.personas.buildSystemPrompt(agent.agente, {
        taskTitle: task.titulo,
        taskDescription: task.descricao,
      });

      // Log the start
      await this.supabase.createMensagem(
        task.id,
        agent.id,
        `Starting work on task: ${task.titulo}`,
        'resposta'
      );

      // Send notification: task started
      const notificationService = getNotificationService();
      await notificationService.notify(task.squad_id, {
        event: 'task_started',
        task,
        agent: agent.agente,
      });

      this.queue.updateProgress(execution.id, 10, 'Agent initialized');

      // Check for block triggers before starting
      const blockTrigger = this.personas.checkBlockTriggers(agent.agente, {
        // These would come from task analysis
        uncertainty: 0,
        requiresExternalAccess: false,
        isDestructive: false,
      });

      if (blockTrigger && blockTrigger.requiresApproval) {
        // Block the task
        this.queue.blockExecution(execution.id, blockTrigger.message);
        await this.supabase.updateTaskStatus(task.id, 'bloqueado', blockTrigger.message);

        await this.supabase.createMensagem(
          task.id,
          agent.id,
          blockTrigger.message,
          'bloqueio'
        );

        // Send notification: task blocked
        await notificationService.notify(task.squad_id, {
          event: 'task_blocked',
          task,
          agent: agent.agente,
          message: blockTrigger.message,
        });

        agent.status = 'blocked';
        agent.metrics.tasksBlocked++;
        return;
      }

      this.queue.updateProgress(execution.id, 30, 'Analyzing task');

      // TODO: Integrate with actual OpenClaw/Claude execution
      // For now, simulate execution
      if (this.sandbox) {
        // Would use sandbox to run OpenClaw commands
        // Example: await this.sandbox.startProcess('clawdbot chat --message "..."');
      }

      // Simulate progress
      this.queue.updateProgress(execution.id, 50, 'Working on task');
      await this.delay(2000);

      this.queue.updateProgress(execution.id, 80, 'Finalizing');
      await this.delay(1000);

      // Complete the execution
      const result = {
        taskId: task.id,
        agentId: agent.id,
        message: 'Task completed successfully',
        duration: Date.now() - startTime,
      };

      this.queue.completeExecution(execution.id, result);

      // Update task status
      await this.supabase.updateTaskStatus(task.id, 'review');

      // Log completion
      await this.supabase.createMensagem(
        task.id,
        agent.id,
        `Completed task: ${task.titulo}. Ready for review.`,
        'entrega'
      );

      // Send notification: task completed
      await notificationService.notify(task.squad_id, {
        event: 'task_completed',
        task,
        agent: agent.agente,
        duration: Date.now() - startTime,
      });

      // Update agent metrics
      agent.status = 'idle';
      agent.currentTask = undefined;
      agent.metrics.tasksCompleted++;
      this.updateAverageTaskDuration(agent, Date.now() - startTime);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Fail the execution
      this.queue.failExecution(execution.id, errorMessage);

      // Update task status
      await this.supabase.updateTaskStatus(task.id, 'bloqueado', errorMessage);

      // Log error
      await this.supabase.createMensagem(
        task.id,
        agent.id,
        `Error: ${errorMessage}`,
        'bloqueio'
      );

      // Send notification: execution error
      const notificationService = getNotificationService();
      await notificationService.notify(task.squad_id, {
        event: 'execution_error',
        task,
        agent: agent.agente,
        error: errorMessage,
      });

      // Update agent
      agent.status = 'idle';
      agent.currentTask = undefined;
      agent.metrics.tasksFailed++;
    }
  }

  /**
   * Pause a task execution
   */
  async pauseTask(taskId: string): Promise<boolean> {
    const execution = this.queue.getExecutionByTaskId(taskId);
    if (!execution || execution.status !== 'running') {
      return false;
    }

    this.queue.blockExecution(execution.id, 'Paused by user');
    await this.supabase.updateTaskStatus(taskId, 'bloqueado', 'Paused by user');

    const agent = this.agents.get(execution.agentId);
    if (agent) {
      agent.status = 'idle';
      agent.currentTask = undefined;
    }

    return true;
  }

  /**
   * Resume a paused task
   */
  async resumeTask(taskId: string): Promise<ExecuteTaskResponse | null> {
    const task = await this.supabase.getTask(taskId);
    if (!task || task.status !== 'bloqueado') {
      return null;
    }

    // Send notification: task unblocked
    const notificationService = getNotificationService();
    await notificationService.notify(task.squad_id, {
      event: 'task_unblocked',
      task,
    });

    return this.executeTask({ taskId: task.id });
  }

  // =============================================================================
  // AGENT SELECTION
  // =============================================================================

  /**
   * Select the best available agent for a task
   */
  selectAgent(task: Task): AgentInstance | undefined {
    const availableAgents = Array.from(this.agents.values()).filter(
      (agent) => agent.status === 'idle' && agent.agente.ativo
    );

    if (availableAgents.length === 0) {
      return undefined;
    }

    // Score each agent based on various factors
    const scored = availableAgents.map((agent) => {
      let score = 0;

      // Prefer agents with fewer completed tasks (load balancing)
      score -= agent.metrics.tasksCompleted * 0.1;

      // Prefer agents with lower failure rate
      const totalTasks = agent.metrics.tasksCompleted + agent.metrics.tasksFailed;
      if (totalTasks > 0) {
        const successRate = agent.metrics.tasksCompleted / totalTasks;
        score += successRate * 10;
      }

      // Prefer agents with faster average task duration
      if (agent.metrics.averageTaskDuration > 0) {
        score -= agent.metrics.averageTaskDuration / 60000; // Penalty per minute
      }

      return { agent, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored[0]?.agent;
  }

  /**
   * Get available agents
   */
  getAvailableAgents(): AgentInstance[] {
    return Array.from(this.agents.values()).filter(
      (agent) => agent.status === 'idle' && agent.agente.ativo
    );
  }

  // =============================================================================
  // QUEUE PROCESSING
  // =============================================================================

  /**
   * Start automatic queue processing
   */
  start(intervalMs: number = 5000): void {
    if (this.isRunning) return;

    this.isRunning = true;
    console.log('[Orchestrator] Started queue processing');

    this.processingInterval = setInterval(() => {
      this.processNextTask().catch((err) => {
        console.error('[Orchestrator] Queue processing error:', err);
      });
    }, intervalMs);
  }

  /**
   * Stop automatic queue processing
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = undefined;
    }
    console.log('[Orchestrator] Stopped queue processing');
  }

  /**
   * Process the next task in queue
   */
  private async processNextTask(): Promise<void> {
    // Check if we have available agents
    const availableAgents = this.getAvailableAgents();
    if (availableAgents.length === 0) {
      return; // No available agents
    }

    // Get next task from queue
    const task = this.queue.getNext();
    if (!task) {
      return; // No tasks in queue
    }

    // Execute the task
    try {
      await this.executeTask({ taskId: task.id });
    } catch (error) {
      console.error(`[Orchestrator] Failed to execute task ${task.id}:`, error);
      // Re-queue if can retry
      if (this.queue.canRetry(task.id)) {
        this.queue.markAttempt(task.id);
        this.queue.enqueue(task, task.priority);
      }
    }
  }

  // =============================================================================
  // STATUS & METRICS
  // =============================================================================

  /**
   * Get orchestrator status
   */
  getStatus(): {
    isRunning: boolean;
    agents: Array<{ id: string; name: string; status: AgentStatus; currentTask?: string }>;
    queue: ReturnType<TaskQueue['getStats']>;
  } {
    return {
      isRunning: this.isRunning,
      agents: Array.from(this.agents.values()).map((agent) => ({
        id: agent.id,
        name: agent.agente.nome,
        status: agent.status,
        currentTask: agent.currentTask?.titulo,
      })),
      queue: this.queue.getStats(),
    };
  }

  /**
   * Get task progress
   */
  getTaskProgress(taskId: string): TaskProgress | null {
    const execution = this.queue.getExecutionByTaskId(taskId);
    if (!execution) return null;

    return {
      taskId: execution.taskId,
      agentId: execution.agentId,
      status: execution.status,
      progress: execution.progress,
      message: execution.logs[execution.logs.length - 1]?.message,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get all registered agents
   */
  getAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): AgentInstance | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get the task queue
   */
  getQueue(): TaskQueue {
    return this.queue;
  }

  /**
   * Get the persona manager
   */
  getPersonas(): PersonaManager {
    return this.personas;
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  private updateAverageTaskDuration(agent: AgentInstance, duration: number): void {
    const { tasksCompleted, averageTaskDuration } = agent.metrics;
    if (tasksCompleted === 0) {
      agent.metrics.averageTaskDuration = duration;
    } else {
      // Weighted average
      agent.metrics.averageTaskDuration =
        (averageTaskDuration * (tasksCompleted - 1) + duration) / tasksCompleted;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
