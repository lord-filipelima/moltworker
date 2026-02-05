/**
 * Squad Builder Type Definitions
 *
 * These types mirror the Supabase database schema from Lovable dashboard
 * and define the structures for multi-agent orchestration.
 */

// =============================================================================
// ENUMS
// =============================================================================

export type TaskStatus =
  | 'backlog'
  | 'em_progresso'
  | 'bloqueado'
  | 'review'
  | 'concluido';

export type MessageType = 'resposta' | 'pergunta' | 'bloqueio' | 'entrega';

export type AgentStatus = 'idle' | 'working' | 'blocked' | 'offline';

export type WorkflowStatus = 'running' | 'paused' | 'completed' | 'failed';

export type StepType = 'agent_task' | 'condition' | 'parallel' | 'wait' | 'notify';

export type TriggerType = 'manual' | 'schedule' | 'webhook' | 'task_status' | 'discord_command';

// =============================================================================
// DATABASE ENTITIES (Matching Supabase Schema)
// =============================================================================

export interface Squad {
  id: string;
  nome: string;
  descricao?: string;
  cor?: string;
  regras_globais?: GlobalRules;
  gatilhos_bloqueio?: BlockTrigger[];
  created_at: string;
  updated_at: string;
}

export interface Agente {
  id: string;
  squad_id: string;
  nome: string;
  tipo?: string;
  soul?: string;              // Agent persona/personality prompt
  regras?: AgentRules;
  limitadores?: AgentLimiters;
  gatilhos_bloqueio?: BlockTrigger[];
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  squad_id: string;
  titulo: string;
  descricao?: string;
  status: TaskStatus;
  motivo_bloqueio?: string;
  assigned_agent_id?: string;
  priority?: number;
  created_at: string;
  updated_at: string;
}

export interface Mensagem {
  id: string;
  task_id: string;
  agente_id?: string;
  conteudo: string;
  tipo: MessageType;
  created_at: string;
}

export interface Workflow {
  id: string;
  squad_id: string;
  nome: string;
  descricao?: string;
  steps: WorkflowStep[];
  triggers: WorkflowTrigger[];
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkflowExecution {
  id: string;
  workflow_id: string;
  task_id?: string;
  current_step: number;
  status: WorkflowStatus;
  context: Record<string, unknown>;
  started_at: string;
  completed_at?: string;
}

export interface DiscordChannel {
  id: string;
  squad_id: string;
  channel_id: string;
  channel_type: 'kanban' | 'notifications' | 'chat';
  webhook_url?: string;
  created_at: string;
}

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

export interface GlobalRules {
  maxConcurrentTasks?: number;
  workingHours?: {
    start: string;    // "09:00"
    end: string;      // "18:00"
    timezone: string; // "America/Sao_Paulo"
  };
  autoAssign?: boolean;
  requireApproval?: TaskStatus[];
  notifyOnBlock?: boolean;
  defaultPriority?: number;
}

export interface AgentRules {
  allowedTaskTypes?: string[];
  forbiddenActions?: string[];
  mustAskBefore?: string[];      // Actions that require human approval
  autoComplete?: boolean;
  maxTasksPerDay?: number;
}

export interface AgentLimiters {
  maxTokensPerTask?: number;
  maxApiCallsPerTask?: number;
  maxDurationMinutes?: number;
  cooldownMinutes?: number;
  maxRetries?: number;
}

export interface BlockTrigger {
  condition: string;              // e.g., "uncertainty > 0.7"
  message: string;                // Message to show when blocked
  notifyChannel?: string;         // Discord channel to notify
  requiresApproval?: boolean;
}

// =============================================================================
// WORKFLOW TYPES
// =============================================================================

export interface WorkflowStep {
  id: string;
  type: StepType;
  name: string;
  config: StepConfig;
  onSuccess?: string;     // Next step ID
  onFailure?: string;     // Step ID on failure
  onBlock?: string;       // Step ID when blocked
}

export type StepConfig =
  | AgentTaskConfig
  | ConditionConfig
  | ParallelConfig
  | WaitConfig
  | NotifyConfig;

export interface AgentTaskConfig {
  agentType?: string;     // Type of agent to use
  agentId?: string;       // Specific agent ID
  action: string;         // Action to perform
  input?: Record<string, unknown>;
  timeout?: number;
}

export interface ConditionConfig {
  check: string;          // Expression to evaluate
  trueStep: string;       // Step ID if true
  falseStep: string;      // Step ID if false
}

export interface ParallelConfig {
  steps: string[];        // Step IDs to run in parallel
  waitAll?: boolean;      // Wait for all or just first
}

export interface WaitConfig {
  duration?: number;      // Milliseconds
  until?: string;         // Condition to wait for
  event?: string;         // Event to wait for
}

export interface NotifyConfig {
  channel: 'discord' | 'email' | 'webhook';
  target?: string;        // Channel ID, email, or URL
  message: string;
  embed?: DiscordEmbed;
}

export interface WorkflowTrigger {
  type: TriggerType;
  config: TriggerConfig;
}

export type TriggerConfig =
  | ManualTriggerConfig
  | ScheduleTriggerConfig
  | WebhookTriggerConfig
  | TaskStatusTriggerConfig
  | DiscordCommandTriggerConfig;

export interface ManualTriggerConfig {
  allowedUsers?: string[];
}

export interface ScheduleTriggerConfig {
  cron: string;           // Cron expression
  timezone?: string;
}

export interface WebhookTriggerConfig {
  event: string;          // e.g., "pull_request.opened"
  filter?: Record<string, unknown>;
}

export interface TaskStatusTriggerConfig {
  fromStatus?: TaskStatus;
  toStatus: TaskStatus;
  taskFilter?: Record<string, unknown>;
}

export interface DiscordCommandTriggerConfig {
  command: string;        // e.g., "/review"
  allowedRoles?: string[];
}

// =============================================================================
// DISCORD TYPES
// =============================================================================

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{
    name: string;
    value: string;
    inline?: boolean;
  }>;
  footer?: {
    text: string;
    icon_url?: string;
  };
  timestamp?: string;
}

export interface DiscordWebhookPayload {
  type: 'command' | 'message' | 'reaction' | 'interaction';
  channelId: string;
  guildId?: string;
  userId: string;
  username?: string;
  content?: string;
  command?: {
    name: string;
    args: string[];
    options?: Record<string, unknown>;
  };
  messageId?: string;
  reactionEmoji?: string;
}

export interface DiscordNotification {
  channelId?: string;
  webhookUrl?: string;
  type: 'task_update' | 'block_alert' | 'completion' | 'message' | 'error';
  content?: string;
  embed?: DiscordEmbed;
  mentionUsers?: string[];
  mentionRoles?: string[];
}

// =============================================================================
// ORCHESTRATOR TYPES
// =============================================================================

export interface AgentInstance {
  id: string;
  agente: Agente;
  status: AgentStatus;
  currentTask?: Task;
  lastActivity?: string;
  metrics: AgentMetrics;
}

export interface AgentMetrics {
  tasksCompleted: number;
  tasksFailed: number;
  tasksBlocked: number;
  averageTaskDuration: number;
  tokensUsed: number;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  progress: number;       // 0-100
  logs: ExecutionLog[];
  result?: unknown;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export interface ExecutionLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: unknown;
}

export interface TaskProgress {
  taskId: string;
  agentId: string;
  status: TaskExecution['status'];
  progress: number;
  currentStep?: string;
  message?: string;
  timestamp: string;
}

// =============================================================================
// API REQUEST/RESPONSE TYPES
// =============================================================================

export interface SyncRequest {
  squadId?: string;       // Sync specific squad or all
  force?: boolean;        // Force full sync
}

export interface SyncResponse {
  success: boolean;
  squadsSync: number;
  agentsSync: number;
  tasksSync: number;
  lastSync: string;
  errors?: string[];
}

export interface ExecuteTaskRequest {
  taskId: string;
  agentId?: string;       // Optional, auto-assign if not specified
  priority?: number;
  context?: Record<string, unknown>;
}

export interface ExecuteTaskResponse {
  executionId: string;
  taskId: string;
  agentId: string;
  status: TaskExecution['status'];
  estimatedDuration?: number;
}

export interface TaskProgressResponse {
  execution: TaskExecution;
  agent: Pick<Agente, 'id' | 'nome' | 'tipo'>;
  messages: Mensagem[];
}

export interface StartWorkflowRequest {
  workflowId: string;
  taskId?: string;
  input?: Record<string, unknown>;
}

export interface StartWorkflowResponse {
  executionId: string;
  workflowId: string;
  status: WorkflowStatus;
  currentStep: string;
}

// =============================================================================
// SUPABASE CLIENT TYPES
// =============================================================================

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceKey?: string;
}

export interface RealtimePayload<T> {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: T;
  old: T | null;
  table: string;
  schema: string;
}
