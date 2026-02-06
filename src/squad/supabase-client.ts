/**
 * Supabase Client for Squad Builder
 *
 * Handles all database operations with Supabase, including
 * CRUD operations and realtime subscriptions.
 */

import type {
  Squad,
  Agente,
  Task,
  Mensagem,
  Workflow,
  WorkflowExecution,
  DiscordChannel,
  TaskStatus,
  MessageType,
  SupabaseConfig,
} from './types';

/**
 * Supabase REST API client for Cloudflare Workers
 * (Using fetch instead of @supabase/supabase-js for edge compatibility)
 */
export class SupabaseClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(config: SupabaseConfig) {
    this.baseUrl = `${config.url}/rest/v1`;
    this.headers = {
      'Content-Type': 'application/json',
      'apikey': config.anonKey,
      'Authorization': `Bearer ${config.serviceKey || config.anonKey}`,
      'Prefer': 'return=representation',
    };
  }

  // =============================================================================
  // GENERIC METHODS
  // =============================================================================

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: { headers?: Record<string, string>; query?: Record<string, string> }
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    // Add query parameters
    if (options?.query) {
      const params = new URLSearchParams(options.query);
      url += `?${params.toString()}`;
    }

    const response = await fetch(url, {
      method,
      headers: {
        ...this.headers,
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Supabase error: ${response.status} - ${error}`);
    }

    // Handle empty responses
    const text = await response.text();
    if (!text) return [] as unknown as T;

    return JSON.parse(text) as T;
  }

  // =============================================================================
  // SQUADS
  // =============================================================================

  async getSquads(): Promise<Squad[]> {
    return this.request<Squad[]>('GET', '/squads', undefined, {
      query: { order: 'created_at.desc' },
    });
  }

  async getSquad(id: string): Promise<Squad | null> {
    const squads = await this.request<Squad[]>('GET', '/squads', undefined, {
      query: { id: `eq.${id}` },
    });
    return squads[0] || null;
  }

  async createSquad(squad: Omit<Squad, 'id' | 'created_at' | 'updated_at'>): Promise<Squad> {
    const [created] = await this.request<Squad[]>('POST', '/squads', squad);
    return created;
  }

  async updateSquad(id: string, updates: Partial<Squad>): Promise<Squad> {
    const [updated] = await this.request<Squad[]>(
      'PATCH',
      '/squads',
      { ...updates, updated_at: new Date().toISOString() },
      { query: { id: `eq.${id}` } }
    );
    return updated;
  }

  async deleteSquad(id: string): Promise<void> {
    await this.request('DELETE', '/squads', undefined, {
      query: { id: `eq.${id}` },
    });
  }

  // =============================================================================
  // AGENTS
  // =============================================================================

  async getAgentes(squadId?: string): Promise<Agente[]> {
    const query: Record<string, string> = { order: 'created_at.desc' };
    if (squadId) query.squad_id = `eq.${squadId}`;

    return this.request<Agente[]>('GET', '/agentes', undefined, { query });
  }

  async getAgente(id: string): Promise<Agente | null> {
    const agentes = await this.request<Agente[]>('GET', '/agentes', undefined, {
      query: { id: `eq.${id}` },
    });
    return agentes[0] || null;
  }

  async getActiveAgentes(squadId: string): Promise<Agente[]> {
    return this.request<Agente[]>('GET', '/agentes', undefined, {
      query: {
        squad_id: `eq.${squadId}`,
        ativo: 'eq.true',
        order: 'created_at.desc',
      },
    });
  }

  async createAgente(agente: Omit<Agente, 'id' | 'created_at' | 'updated_at'>): Promise<Agente> {
    const [created] = await this.request<Agente[]>('POST', '/agentes', agente);
    return created;
  }

  async updateAgente(id: string, updates: Partial<Agente>): Promise<Agente> {
    const [updated] = await this.request<Agente[]>(
      'PATCH',
      '/agentes',
      { ...updates, updated_at: new Date().toISOString() },
      { query: { id: `eq.${id}` } }
    );
    return updated;
  }

  async deleteAgente(id: string): Promise<void> {
    await this.request('DELETE', '/agentes', undefined, {
      query: { id: `eq.${id}` },
    });
  }

  async activateAgente(id: string): Promise<Agente> {
    return this.updateAgente(id, { ativo: true });
  }

  async deactivateAgente(id: string): Promise<Agente> {
    return this.updateAgente(id, { ativo: false });
  }

  // =============================================================================
  // TASKS
  // =============================================================================

  async getTasks(squadId?: string, status?: TaskStatus): Promise<Task[]> {
    const query: Record<string, string> = { order: 'created_at.desc' };
    if (squadId) query.squad_id = `eq.${squadId}`;
    if (status) query.status = `eq.${status}`;

    return this.request<Task[]>('GET', '/tasks', undefined, { query });
  }

  async getTask(id: string): Promise<Task | null> {
    const tasks = await this.request<Task[]>('GET', '/tasks', undefined, {
      query: { id: `eq.${id}` },
    });
    return tasks[0] || null;
  }

  async getTasksByStatus(squadId: string, status: TaskStatus): Promise<Task[]> {
    return this.request<Task[]>('GET', '/tasks', undefined, {
      query: {
        squad_id: `eq.${squadId}`,
        status: `eq.${status}`,
        order: 'priority.desc,created_at.asc',
      },
    });
  }

  async createTask(task: Omit<Task, 'id' | 'created_at' | 'updated_at'>): Promise<Task> {
    const [created] = await this.request<Task[]>('POST', '/tasks', task);
    return created;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<Task> {
    const [updated] = await this.request<Task[]>(
      'PATCH',
      '/tasks',
      { ...updates, updated_at: new Date().toISOString() },
      { query: { id: `eq.${id}` } }
    );
    return updated;
  }

  async updateTaskStatus(id: string, status: TaskStatus, motivo?: string): Promise<Task> {
    const updates: Partial<Task> = { status };
    if (status === 'bloqueado' && motivo) {
      updates.motivo_bloqueio = motivo;
    } else if (status !== 'bloqueado') {
      updates.motivo_bloqueio = undefined;
    }
    return this.updateTask(id, updates);
  }

  async assignTask(taskId: string, agentId: string): Promise<Task> {
    return this.updateTask(taskId, {
      assigned_agent_id: agentId,
      status: 'em_progresso',
    });
  }

  async deleteTask(id: string): Promise<void> {
    await this.request('DELETE', '/tasks', undefined, {
      query: { id: `eq.${id}` },
    });
  }

  // =============================================================================
  // MESSAGES
  // =============================================================================

  async getMensagens(taskId: string): Promise<Mensagem[]> {
    return this.request<Mensagem[]>('GET', '/mensagens', undefined, {
      query: {
        task_id: `eq.${taskId}`,
        order: 'created_at.asc',
      },
    });
  }

  async createMensagem(
    taskId: string,
    agenteId: string | undefined,
    conteudo: string,
    tipo: MessageType
  ): Promise<Mensagem> {
    const [created] = await this.request<Mensagem[]>('POST', '/mensagens', {
      task_id: taskId,
      agente_id: agenteId,
      conteudo,
      tipo,
    });
    return created;
  }

  // =============================================================================
  // WORKFLOWS
  // =============================================================================

  async getWorkflows(squadId?: string): Promise<Workflow[]> {
    const query: Record<string, string> = { order: 'created_at.desc' };
    if (squadId) query.squad_id = `eq.${squadId}`;

    return this.request<Workflow[]>('GET', '/workflows', undefined, { query });
  }

  async getWorkflow(id: string): Promise<Workflow | null> {
    const workflows = await this.request<Workflow[]>('GET', '/workflows', undefined, {
      query: { id: `eq.${id}` },
    });
    return workflows[0] || null;
  }

  async createWorkflow(workflow: Omit<Workflow, 'id' | 'created_at' | 'updated_at'>): Promise<Workflow> {
    const [created] = await this.request<Workflow[]>('POST', '/workflows', workflow);
    return created;
  }

  async updateWorkflow(id: string, updates: Partial<Workflow>): Promise<Workflow> {
    const [updated] = await this.request<Workflow[]>(
      'PATCH',
      '/workflows',
      { ...updates, updated_at: new Date().toISOString() },
      { query: { id: `eq.${id}` } }
    );
    return updated;
  }

  // =============================================================================
  // WORKFLOW EXECUTIONS
  // =============================================================================

  async getWorkflowExecution(id: string): Promise<WorkflowExecution | null> {
    const executions = await this.request<WorkflowExecution[]>(
      'GET',
      '/workflow_executions',
      undefined,
      { query: { id: `eq.${id}` } }
    );
    return executions[0] || null;
  }

  async createWorkflowExecution(
    execution: Omit<WorkflowExecution, 'id' | 'started_at' | 'completed_at'>
  ): Promise<WorkflowExecution> {
    const [created] = await this.request<WorkflowExecution[]>(
      'POST',
      '/workflow_executions',
      { ...execution, started_at: new Date().toISOString() }
    );
    return created;
  }

  async updateWorkflowExecution(
    id: string,
    updates: Partial<WorkflowExecution>
  ): Promise<WorkflowExecution> {
    const [updated] = await this.request<WorkflowExecution[]>(
      'PATCH',
      '/workflow_executions',
      updates,
      { query: { id: `eq.${id}` } }
    );
    return updated;
  }

  // =============================================================================
  // DISCORD CHANNELS
  // =============================================================================

  async getDiscordChannels(squadId: string): Promise<DiscordChannel[]> {
    return this.request<DiscordChannel[]>('GET', '/discord_channels', undefined, {
      query: {
        squad_id: `eq.${squadId}`,
        order: 'created_at.desc',
      },
    });
  }

  async getDiscordChannelByType(
    squadId: string,
    channelType: DiscordChannel['channel_type']
  ): Promise<DiscordChannel | null> {
    const channels = await this.request<DiscordChannel[]>(
      'GET',
      '/discord_channels',
      undefined,
      {
        query: {
          squad_id: `eq.${squadId}`,
          channel_type: `eq.${channelType}`,
        },
      }
    );
    return channels[0] || null;
  }

  async createDiscordChannel(
    channel: Omit<DiscordChannel, 'id' | 'created_at'>
  ): Promise<DiscordChannel> {
    const [created] = await this.request<DiscordChannel[]>(
      'POST',
      '/discord_channels',
      channel
    );
    return created;
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  /**
   * Get full squad data including agents, tasks, and messages
   */
  async getSquadWithRelations(squadId: string): Promise<{
    squad: Squad;
    agentes: Agente[];
    tasks: Task[];
    workflows: Workflow[];
  } | null> {
    const squad = await this.getSquad(squadId);
    if (!squad) return null;

    const [agentes, tasks, workflows] = await Promise.all([
      this.getAgentes(squadId),
      this.getTasks(squadId),
      this.getWorkflows(squadId),
    ]);

    return { squad, agentes, tasks, workflows };
  }

  /**
   * Get Kanban board data grouped by status
   */
  async getKanbanBoard(squadId: string): Promise<Record<TaskStatus, Task[]>> {
    const tasks = await this.getTasks(squadId);

    const board: Record<TaskStatus, Task[]> = {
      backlog: [],
      em_progresso: [],
      bloqueado: [],
      review: [],
      concluido: [],
    };

    for (const task of tasks) {
      board[task.status].push(task);
    }

    return board;
  }

  /**
   * Health check - verify Supabase connection
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.request('GET', '/squads', undefined, {
        query: { limit: '1' },
        headers: { 'Prefer': 'count=exact' },
      });
      return true;
    } catch {
      return false;
    }
  }
}
