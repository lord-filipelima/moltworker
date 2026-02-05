/**
 * Task Queue for Squad Builder
 *
 * Manages task queuing, prioritization, and assignment to agents.
 * Uses in-memory storage with Supabase as the source of truth.
 */

import type { Task, TaskStatus, Agente, TaskExecution, ExecutionLog } from './types';

interface QueuedTask {
  task: Task;
  priority: number;
  queuedAt: Date;
  attempts: number;
  lastAttempt?: Date;
}

interface ExecutionState {
  execution: TaskExecution;
  logs: ExecutionLog[];
  startTime: Date;
}

/**
 * Task Queue implementation
 * Manages task prioritization and execution tracking
 */
export class TaskQueue {
  private queue: Map<string, QueuedTask> = new Map();
  private executions: Map<string, ExecutionState> = new Map();
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(options?: { maxRetries?: number; retryDelayMs?: number }) {
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryDelayMs = options?.retryDelayMs ?? 5000;
  }

  // =============================================================================
  // QUEUE OPERATIONS
  // =============================================================================

  /**
   * Add a task to the queue
   */
  enqueue(task: Task, priority?: number): void {
    const queuedTask: QueuedTask = {
      task,
      priority: priority ?? task.priority ?? 0,
      queuedAt: new Date(),
      attempts: 0,
    };

    this.queue.set(task.id, queuedTask);
    console.log(`[Queue] Task ${task.id} enqueued with priority ${queuedTask.priority}`);
  }

  /**
   * Remove a task from the queue
   */
  dequeue(taskId: string): Task | undefined {
    const queuedTask = this.queue.get(taskId);
    if (queuedTask) {
      this.queue.delete(taskId);
      console.log(`[Queue] Task ${taskId} dequeued`);
      return queuedTask.task;
    }
    return undefined;
  }

  /**
   * Get the next task to execute based on priority
   */
  getNext(): Task | undefined {
    if (this.queue.size === 0) return undefined;

    // Sort by priority (higher first), then by queue time (older first)
    const sorted = Array.from(this.queue.values()).sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      return a.queuedAt.getTime() - b.queuedAt.getTime();
    });

    const next = sorted[0];
    if (next) {
      // Check if we can retry (if it failed before)
      if (next.attempts > 0 && next.lastAttempt) {
        const timeSinceLastAttempt = Date.now() - next.lastAttempt.getTime();
        if (timeSinceLastAttempt < this.retryDelayMs) {
          // Not ready to retry yet, try next task
          return sorted.find((qt) => {
            if (qt.attempts === 0) return true;
            if (!qt.lastAttempt) return true;
            return Date.now() - qt.lastAttempt.getTime() >= this.retryDelayMs;
          })?.task;
        }
      }

      return next.task;
    }

    return undefined;
  }

  /**
   * Get all queued tasks
   */
  getAll(): Task[] {
    return Array.from(this.queue.values())
      .sort((a, b) => b.priority - a.priority)
      .map((qt) => qt.task);
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.queue.size;
  }

  /**
   * Check if task is in queue
   */
  has(taskId: string): boolean {
    return this.queue.has(taskId);
  }

  /**
   * Update task priority
   */
  updatePriority(taskId: string, priority: number): boolean {
    const queuedTask = this.queue.get(taskId);
    if (queuedTask) {
      queuedTask.priority = priority;
      return true;
    }
    return false;
  }

  /**
   * Mark task attempt (for retry tracking)
   */
  markAttempt(taskId: string): void {
    const queuedTask = this.queue.get(taskId);
    if (queuedTask) {
      queuedTask.attempts++;
      queuedTask.lastAttempt = new Date();
    }
  }

  /**
   * Check if task can be retried
   */
  canRetry(taskId: string): boolean {
    const queuedTask = this.queue.get(taskId);
    if (!queuedTask) return false;
    return queuedTask.attempts < this.maxRetries;
  }

  // =============================================================================
  // EXECUTION TRACKING
  // =============================================================================

  /**
   * Start task execution tracking
   */
  startExecution(taskId: string, agentId: string): TaskExecution {
    const executionId = `exec_${taskId}_${Date.now()}`;

    const execution: TaskExecution = {
      id: executionId,
      taskId,
      agentId,
      status: 'running',
      progress: 0,
      logs: [],
      startedAt: new Date().toISOString(),
    };

    this.executions.set(executionId, {
      execution,
      logs: [],
      startTime: new Date(),
    });

    // Remove from queue since it's now executing
    this.dequeue(taskId);

    console.log(`[Queue] Execution ${executionId} started for task ${taskId}`);
    return execution;
  }

  /**
   * Update execution progress
   */
  updateProgress(executionId: string, progress: number, message?: string): void {
    const state = this.executions.get(executionId);
    if (state) {
      state.execution.progress = Math.min(100, Math.max(0, progress));

      if (message) {
        this.addLog(executionId, 'info', message);
      }
    }
  }

  /**
   * Add log to execution
   */
  addLog(
    executionId: string,
    level: ExecutionLog['level'],
    message: string,
    data?: unknown
  ): void {
    const state = this.executions.get(executionId);
    if (state) {
      const log: ExecutionLog = {
        timestamp: new Date().toISOString(),
        level,
        message,
        data,
      };
      state.logs.push(log);
      state.execution.logs = state.logs;
    }
  }

  /**
   * Complete execution successfully
   */
  completeExecution(executionId: string, result?: unknown): TaskExecution | undefined {
    const state = this.executions.get(executionId);
    if (state) {
      state.execution.status = 'completed';
      state.execution.progress = 100;
      state.execution.result = result;
      state.execution.completedAt = new Date().toISOString();

      this.addLog(executionId, 'info', 'Task completed successfully');
      console.log(`[Queue] Execution ${executionId} completed`);

      return state.execution;
    }
    return undefined;
  }

  /**
   * Fail execution
   */
  failExecution(executionId: string, error: string): TaskExecution | undefined {
    const state = this.executions.get(executionId);
    if (state) {
      state.execution.status = 'failed';
      state.execution.error = error;
      state.execution.completedAt = new Date().toISOString();

      this.addLog(executionId, 'error', `Task failed: ${error}`);
      console.log(`[Queue] Execution ${executionId} failed: ${error}`);

      return state.execution;
    }
    return undefined;
  }

  /**
   * Block execution (requires human intervention)
   */
  blockExecution(executionId: string, reason: string): TaskExecution | undefined {
    const state = this.executions.get(executionId);
    if (state) {
      state.execution.status = 'blocked';
      state.execution.error = reason;

      this.addLog(executionId, 'warn', `Task blocked: ${reason}`);
      console.log(`[Queue] Execution ${executionId} blocked: ${reason}`);

      return state.execution;
    }
    return undefined;
  }

  /**
   * Get execution by ID
   */
  getExecution(executionId: string): TaskExecution | undefined {
    return this.executions.get(executionId)?.execution;
  }

  /**
   * Get execution by task ID (most recent)
   */
  getExecutionByTaskId(taskId: string): TaskExecution | undefined {
    for (const state of this.executions.values()) {
      if (state.execution.taskId === taskId) {
        return state.execution;
      }
    }
    return undefined;
  }

  /**
   * Get all active executions
   */
  getActiveExecutions(): TaskExecution[] {
    return Array.from(this.executions.values())
      .filter((state) => state.execution.status === 'running')
      .map((state) => state.execution);
  }

  /**
   * Get execution logs
   */
  getExecutionLogs(executionId: string): ExecutionLog[] {
    return this.executions.get(executionId)?.logs ?? [];
  }

  /**
   * Clean up old completed/failed executions (keep last N)
   */
  cleanup(keepLast: number = 100): number {
    const states = Array.from(this.executions.entries())
      .filter(([, state]) =>
        state.execution.status === 'completed' || state.execution.status === 'failed'
      )
      .sort(([, a], [, b]) =>
        new Date(b.execution.completedAt!).getTime() -
        new Date(a.execution.completedAt!).getTime()
      );

    let removed = 0;
    for (let i = keepLast; i < states.length; i++) {
      this.executions.delete(states[i][0]);
      removed++;
    }

    if (removed > 0) {
      console.log(`[Queue] Cleaned up ${removed} old executions`);
    }

    return removed;
  }

  // =============================================================================
  // SYNC METHODS
  // =============================================================================

  /**
   * Sync queue with tasks from database
   * Only adds tasks that aren't already queued or executing
   */
  syncFromTasks(tasks: Task[]): void {
    const executingTaskIds = new Set(
      this.getActiveExecutions().map((e) => e.taskId)
    );

    for (const task of tasks) {
      // Only queue backlog tasks that aren't already queued or executing
      if (
        task.status === 'backlog' &&
        !this.has(task.id) &&
        !executingTaskIds.has(task.id)
      ) {
        this.enqueue(task);
      }
    }
  }

  /**
   * Get tasks ready for assignment
   */
  getTasksReadyForAssignment(agent: Agente, limit: number = 5): Task[] {
    const tasks: Task[] = [];
    const sorted = Array.from(this.queue.values())
      .sort((a, b) => b.priority - a.priority)
      .map((qt) => qt.task);

    for (const task of sorted) {
      if (tasks.length >= limit) break;

      // Check if agent can handle this task type
      const allowedTypes = agent.regras?.allowedTaskTypes;
      if (allowedTypes && allowedTypes.length > 0) {
        // If task has a type field (would need to add to schema)
        // For now, allow all tasks
      }

      tasks.push(task);
    }

    return tasks;
  }

  // =============================================================================
  // STATISTICS
  // =============================================================================

  /**
   * Get queue statistics
   */
  getStats(): {
    queueSize: number;
    activeExecutions: number;
    completedExecutions: number;
    failedExecutions: number;
    blockedExecutions: number;
    averageExecutionTime: number;
  } {
    const executions = Array.from(this.executions.values());

    const completed = executions.filter(
      (s) => s.execution.status === 'completed'
    );
    const failed = executions.filter((s) => s.execution.status === 'failed');
    const blocked = executions.filter((s) => s.execution.status === 'blocked');
    const active = executions.filter((s) => s.execution.status === 'running');

    // Calculate average execution time for completed tasks
    let totalTime = 0;
    for (const state of completed) {
      if (state.execution.completedAt) {
        const start = new Date(state.execution.startedAt).getTime();
        const end = new Date(state.execution.completedAt).getTime();
        totalTime += end - start;
      }
    }
    const averageTime = completed.length > 0 ? totalTime / completed.length : 0;

    return {
      queueSize: this.queue.size,
      activeExecutions: active.length,
      completedExecutions: completed.length,
      failedExecutions: failed.length,
      blockedExecutions: blocked.length,
      averageExecutionTime: averageTime,
    };
  }
}
