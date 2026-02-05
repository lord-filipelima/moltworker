/**
 * Notification Service for Squad Builder
 *
 * Handles automatic notifications to Discord when task statuses change,
 * agents complete work, or errors occur.
 */

import type {
  Task,
  Agente,
  TaskStatus,
  DiscordEmbed,
  DiscordNotification,
} from './types';
import {
  STATUS_COLORS,
  buildTaskEmbed,
  buildBlockNotification,
  buildCompletionNotification,
} from './discord';

// =============================================================================
// NOTIFICATION TYPES
// =============================================================================

export type NotificationEvent =
  | 'task_started'
  | 'task_completed'
  | 'task_blocked'
  | 'task_unblocked'
  | 'task_assigned'
  | 'agent_activated'
  | 'agent_deactivated'
  | 'execution_error'
  | 'workflow_started'
  | 'workflow_completed';

export interface NotificationConfig {
  webhookUrl: string;
  events: NotificationEvent[];
  mentionOnBlock?: string[];      // User/role IDs to mention when blocked
  mentionOnError?: string[];      // User/role IDs to mention on errors
  quietHours?: {
    start: string;    // "22:00"
    end: string;      // "08:00"
    timezone: string; // "America/Sao_Paulo"
  };
}

export interface NotificationPayload {
  event: NotificationEvent;
  task?: Task;
  agent?: Agente;
  message?: string;
  duration?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// NOTIFICATION SERVICE
// =============================================================================

export class NotificationService {
  private configs: Map<string, NotificationConfig> = new Map();
  private lastNotifications: Map<string, number> = new Map();
  private readonly rateLimitMs: number = 1000; // 1 second between same notifications

  /**
   * Configure notifications for a squad
   */
  configure(squadId: string, config: NotificationConfig): void {
    this.configs.set(squadId, config);
    console.log(`[NotificationService] Configured for squad ${squadId}`);
  }

  /**
   * Remove configuration for a squad
   */
  remove(squadId: string): boolean {
    return this.configs.delete(squadId);
  }

  /**
   * Get configuration for a squad
   */
  getConfig(squadId: string): NotificationConfig | undefined {
    return this.configs.get(squadId);
  }

  /**
   * Check if notifications are enabled for a squad/event
   */
  isEnabled(squadId: string, event: NotificationEvent): boolean {
    const config = this.configs.get(squadId);
    if (!config) return false;
    return config.events.includes(event);
  }

  /**
   * Send a notification
   */
  async notify(
    squadId: string,
    payload: NotificationPayload
  ): Promise<{ success: boolean; error?: string }> {
    const config = this.configs.get(squadId);
    if (!config) {
      return { success: false, error: 'No notification config for squad' };
    }

    // Check if event is enabled
    if (!config.events.includes(payload.event)) {
      return { success: false, error: 'Event not enabled' };
    }

    // Check rate limit
    const key = `${squadId}:${payload.event}:${payload.task?.id || 'general'}`;
    const lastTime = this.lastNotifications.get(key) || 0;
    if (Date.now() - lastTime < this.rateLimitMs) {
      return { success: false, error: 'Rate limited' };
    }

    // Check quiet hours
    if (config.quietHours && this.isQuietHours(config.quietHours)) {
      return { success: false, error: 'Quiet hours active' };
    }

    // Build the notification
    const notification = this.buildNotification(payload, config);

    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(notification),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `Discord API error: ${error}` };
      }

      // Update rate limit tracker
      this.lastNotifications.set(key, Date.now());

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Build notification payload for Discord
   */
  private buildNotification(
    payload: NotificationPayload,
    config: NotificationConfig
  ): Record<string, unknown> {
    const discordPayload: Record<string, unknown> = {};
    let embed: DiscordEmbed | undefined;

    switch (payload.event) {
      case 'task_started':
        embed = this.buildTaskStartedEmbed(payload);
        break;

      case 'task_completed':
        embed = this.buildTaskCompletedEmbed(payload);
        break;

      case 'task_blocked':
        embed = this.buildTaskBlockedEmbed(payload);
        // Add mentions for blocks
        if (config.mentionOnBlock?.length) {
          discordPayload.content = config.mentionOnBlock
            .map((id) => id.startsWith('role:') ? `<@&${id.slice(5)}>` : `<@${id}>`)
            .join(' ');
        }
        break;

      case 'task_unblocked':
        embed = this.buildTaskUnblockedEmbed(payload);
        break;

      case 'task_assigned':
        embed = this.buildTaskAssignedEmbed(payload);
        break;

      case 'agent_activated':
        embed = this.buildAgentStatusEmbed(payload, true);
        break;

      case 'agent_deactivated':
        embed = this.buildAgentStatusEmbed(payload, false);
        break;

      case 'execution_error':
        embed = this.buildErrorEmbed(payload);
        // Add mentions for errors
        if (config.mentionOnError?.length) {
          discordPayload.content = config.mentionOnError
            .map((id) => id.startsWith('role:') ? `<@&${id.slice(5)}>` : `<@${id}>`)
            .join(' ');
        }
        break;

      case 'workflow_started':
        embed = this.buildWorkflowEmbed(payload, 'started');
        break;

      case 'workflow_completed':
        embed = this.buildWorkflowEmbed(payload, 'completed');
        break;
    }

    if (embed) {
      discordPayload.embeds = [embed];
    }

    return discordPayload;
  }

  // =============================================================================
  // EMBED BUILDERS
  // =============================================================================

  private buildTaskStartedEmbed(payload: NotificationPayload): DiscordEmbed {
    const { task, agent } = payload;
    return {
      title: '🚀 Task Started',
      description: task?.titulo || 'Unknown task',
      color: STATUS_COLORS.em_progresso,
      fields: [
        ...(agent ? [{
          name: 'Agent',
          value: agent.nome,
          inline: true,
        }] : []),
        ...(task?.priority ? [{
          name: 'Priority',
          value: task.priority.toString(),
          inline: true,
        }] : []),
      ],
      footer: task ? { text: `Task ID: ${task.id}` } : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private buildTaskCompletedEmbed(payload: NotificationPayload): DiscordEmbed {
    const { task, agent, duration } = payload;
    const fields = [];

    if (agent) {
      fields.push({
        name: 'Agent',
        value: agent.nome,
        inline: true,
      });
    }

    if (duration) {
      fields.push({
        name: 'Duration',
        value: this.formatDuration(duration),
        inline: true,
      });
    }

    return {
      title: '✅ Task Completed',
      description: task?.titulo || 'Unknown task',
      color: STATUS_COLORS.concluido,
      fields,
      footer: task ? { text: `Task ID: ${task.id}` } : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private buildTaskBlockedEmbed(payload: NotificationPayload): DiscordEmbed {
    const { task, message } = payload;
    return {
      title: '🚨 Task Blocked',
      description: `**${task?.titulo || 'Unknown task'}** requires attention`,
      color: STATUS_COLORS.bloqueado,
      fields: [
        {
          name: 'Reason',
          value: message || task?.motivo_bloqueio || 'No reason provided',
          inline: false,
        },
      ],
      footer: task ? { text: `Task ID: ${task.id}` } : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private buildTaskUnblockedEmbed(payload: NotificationPayload): DiscordEmbed {
    const { task, agent } = payload;
    return {
      title: '🔓 Task Unblocked',
      description: task?.titulo || 'Unknown task',
      color: 0x10b981, // Green
      fields: agent ? [{
        name: 'Resuming with',
        value: agent.nome,
        inline: true,
      }] : [],
      footer: task ? { text: `Task ID: ${task.id}` } : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private buildTaskAssignedEmbed(payload: NotificationPayload): DiscordEmbed {
    const { task, agent } = payload;
    return {
      title: '📋 Task Assigned',
      description: task?.titulo || 'Unknown task',
      color: 0x3b82f6, // Blue
      fields: agent ? [{
        name: 'Assigned to',
        value: agent.nome,
        inline: true,
      }] : [],
      footer: task ? { text: `Task ID: ${task.id}` } : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private buildAgentStatusEmbed(payload: NotificationPayload, activated: boolean): DiscordEmbed {
    const { agent } = payload;
    return {
      title: activated ? '🟢 Agent Activated' : '🔴 Agent Deactivated',
      description: agent?.nome || 'Unknown agent',
      color: activated ? 0x10b981 : 0x6b7280,
      fields: agent?.tipo ? [{
        name: 'Type',
        value: agent.tipo,
        inline: true,
      }] : [],
      footer: agent ? { text: `Agent ID: ${agent.id}` } : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private buildErrorEmbed(payload: NotificationPayload): DiscordEmbed {
    const { task, agent, error } = payload;
    return {
      title: '❌ Execution Error',
      description: task?.titulo || 'Task execution failed',
      color: 0xef4444, // Red
      fields: [
        {
          name: 'Error',
          value: error || 'Unknown error',
          inline: false,
        },
        ...(agent ? [{
          name: 'Agent',
          value: agent.nome,
          inline: true,
        }] : []),
      ],
      footer: task ? { text: `Task ID: ${task.id}` } : undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private buildWorkflowEmbed(
    payload: NotificationPayload,
    status: 'started' | 'completed'
  ): DiscordEmbed {
    const { message, metadata } = payload;
    const isStarted = status === 'started';

    return {
      title: isStarted ? '⚡ Workflow Started' : '🏁 Workflow Completed',
      description: message || (metadata?.workflowName as string) || 'Workflow',
      color: isStarted ? 0xf59e0b : 0x10b981, // Yellow or Green
      fields: metadata?.steps ? [{
        name: 'Steps',
        value: String(metadata.steps),
        inline: true,
      }] : [],
      timestamp: new Date().toISOString(),
    };
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  private isQuietHours(quietHours: NonNullable<NotificationConfig['quietHours']>): boolean {
    // Simple implementation - could be improved with proper timezone handling
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = quietHours.start.split(':').map(Number);
    const [endHour, endMinute] = quietHours.end.split(':').map(Number);
    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    // Handle overnight quiet hours (e.g., 22:00 - 08:00)
    if (startTime > endTime) {
      return currentTime >= startTime || currentTime < endTime;
    }

    return currentTime >= startTime && currentTime < endTime;
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Create a notification service instance (singleton per worker)
 */
let notificationServiceInstance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!notificationServiceInstance) {
    notificationServiceInstance = new NotificationService();
  }
  return notificationServiceInstance;
}

/**
 * Quick helper to send task notification
 */
export async function notifyTaskEvent(
  squadId: string,
  event: NotificationEvent,
  task: Task,
  agent?: Agente,
  extra?: Partial<NotificationPayload>
): Promise<void> {
  const service = getNotificationService();
  await service.notify(squadId, {
    event,
    task,
    agent,
    ...extra,
  });
}
