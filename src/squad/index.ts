/**
 * Squad Builder Module
 *
 * Multi-agent orchestration system for managing AI agent squads,
 * task execution, and workflow automation.
 */

// Type exports
export * from './types';

// Core components
export { SupabaseClient } from './supabase-client';
export { AgentOrchestrator } from './orchestrator';
export { TaskQueue } from './queue';
export { PersonaManager, DEFAULT_PERSONAS, DEFAULT_BLOCK_TRIGGERS } from './persona';
export { OpenClawExecutor } from './openclaw-executor';
export type { OpenClawResult, ExecuteOptions } from './openclaw-executor';

// Discord integration
export {
  sendDiscordNotification,
  registerSlashCommands,
  buildTaskEmbed,
  buildAgentEmbed,
  buildBlockNotification,
  buildCompletionNotification,
  buildStatusEmbed,
  SLASH_COMMANDS,
  STATUS_COLORS,
} from './discord';

// Workflow engine
export { WorkflowEngine, WORKFLOW_TEMPLATES } from './workflow-engine';

// Notification service
export {
  NotificationService,
  getNotificationService,
  notifyTaskEvent,
  setDefaultWebhookUrl,
} from './notification-service';
export type {
  NotificationConfig,
  NotificationEvent,
  NotificationPayload,
} from './notification-service';

// Route handlers
export { squadRoutes } from './routes';
