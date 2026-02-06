/**
 * Discord Integration for Squad Builder
 *
 * Handles Discord bot interactions, webhooks, and notifications.
 * Provides two-way communication between Discord and the Squad Builder.
 */

import type {
  DiscordWebhookPayload,
  DiscordNotification,
  DiscordEmbed,
  Task,
  Agente,
  TaskStatus,
} from './types';

// =============================================================================
// DISCORD MESSAGE BUILDERS
// =============================================================================

/**
 * Status colors for Discord embeds
 */
export const STATUS_COLORS: Record<TaskStatus, number> = {
  backlog: 0x6b7280,     // Gray
  em_progresso: 0x3b82f6, // Blue
  bloqueado: 0xef4444,    // Red
  review: 0xf59e0b,       // Yellow
  concluido: 0x10b981,    // Green
};

/**
 * Build a Discord embed for a task
 */
export function buildTaskEmbed(task: Task, agent?: Agente): DiscordEmbed {
  const fields = [
    {
      name: 'Status',
      value: formatStatus(task.status),
      inline: true,
    },
  ];

  if (agent) {
    fields.push({
      name: 'Agent',
      value: agent.nome,
      inline: true,
    });
  }

  if (task.priority) {
    fields.push({
      name: 'Priority',
      value: task.priority.toString(),
      inline: true,
    });
  }

  if (task.descricao) {
    fields.push({
      name: 'Description',
      value: task.descricao.slice(0, 200) + (task.descricao.length > 200 ? '...' : ''),
      inline: false,
    });
  }

  if (task.motivo_bloqueio) {
    fields.push({
      name: 'Block Reason',
      value: task.motivo_bloqueio,
      inline: false,
    });
  }

  return {
    title: task.titulo,
    color: STATUS_COLORS[task.status],
    fields,
    footer: {
      text: `Task ID: ${task.id}`,
    },
    timestamp: task.updated_at,
  };
}

/**
 * Build a Discord embed for an agent
 */
export function buildAgentEmbed(agent: Agente, status?: string): DiscordEmbed {
  const fields = [
    {
      name: 'Type',
      value: agent.tipo || 'General',
      inline: true,
    },
    {
      name: 'Status',
      value: status || (agent.ativo ? 'Active' : 'Inactive'),
      inline: true,
    },
  ];

  if (agent.soul) {
    const soulPreview = agent.soul.split('\n')[0].slice(0, 100);
    fields.push({
      name: 'Personality',
      value: soulPreview + (agent.soul.length > 100 ? '...' : ''),
      inline: false,
    });
  }

  return {
    title: agent.nome,
    color: agent.ativo ? 0x10b981 : 0x6b7280,
    fields,
    footer: {
      text: `Agent ID: ${agent.id}`,
    },
  };
}

/**
 * Build a notification embed for blocked tasks
 */
export function buildBlockNotification(task: Task, reason: string): DiscordEmbed {
  return {
    title: '🚨 Task Blocked',
    description: `**${task.titulo}** requires attention`,
    color: STATUS_COLORS.bloqueado,
    fields: [
      {
        name: 'Reason',
        value: reason,
        inline: false,
      },
      {
        name: 'Task ID',
        value: task.id,
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build a notification embed for completed tasks
 */
export function buildCompletionNotification(
  task: Task,
  agent: Agente,
  duration?: number
): DiscordEmbed {
  const fields = [
    {
      name: 'Agent',
      value: agent.nome,
      inline: true,
    },
  ];

  if (duration) {
    fields.push({
      name: 'Duration',
      value: formatDuration(duration),
      inline: true,
    });
  }

  return {
    title: '✅ Task Completed',
    description: task.titulo,
    color: STATUS_COLORS.concluido,
    fields,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Build squad status summary embed
 */
export function buildStatusEmbed(status: {
  agents: Array<{ name: string; status: string; currentTask?: string }>;
  queue: { queueSize: number; activeExecutions: number };
}): DiscordEmbed {
  const agentList = status.agents.length > 0
    ? status.agents.map((a) =>
        `**${a.name}**: ${a.status}${a.currentTask ? ` (${a.currentTask})` : ''}`
      ).join('\n')
    : 'No agents registered';

  return {
    title: '📊 Squad Status',
    color: 0x3b82f6,
    fields: [
      {
        name: 'Agents',
        value: agentList,
        inline: false,
      },
      {
        name: 'Queue',
        value: `${status.queue.queueSize} tasks waiting`,
        inline: true,
      },
      {
        name: 'Active',
        value: `${status.queue.activeExecutions} running`,
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };
}

// =============================================================================
// DISCORD COMMAND HANDLERS
// =============================================================================

/**
 * Discord slash command definitions for registration
 */
export const SLASH_COMMANDS = [
  {
    name: 'squad',
    description: 'Squad Builder commands',
    options: [
      {
        name: 'status',
        description: 'Show squad status',
        type: 1, // SUB_COMMAND
      },
      {
        name: 'tasks',
        description: 'List active tasks',
        type: 1,
      },
      {
        name: 'agents',
        description: 'List agents',
        type: 1,
      },
    ],
  },
  {
    name: 'task',
    description: 'Task management commands',
    options: [
      {
        name: 'create',
        description: 'Create a new task',
        type: 1,
        options: [
          {
            name: 'title',
            description: 'Task title',
            type: 3, // STRING
            required: true,
          },
          {
            name: 'description',
            description: 'Task description',
            type: 3,
            required: false,
          },
        ],
      },
      {
        name: 'execute',
        description: 'Start task execution',
        type: 1,
        options: [
          {
            name: 'id',
            description: 'Task ID',
            type: 3,
            required: true,
          },
          {
            name: 'agent',
            description: 'Agent to assign (optional)',
            type: 3,
            required: false,
          },
        ],
      },
      {
        name: 'status',
        description: 'Get task status',
        type: 1,
        options: [
          {
            name: 'id',
            description: 'Task ID',
            type: 3,
            required: true,
          },
        ],
      },
    ],
  },
  {
    name: 'agent',
    description: 'Agent management commands',
    options: [
      {
        name: 'list',
        description: 'List all agents',
        type: 1,
      },
      {
        name: 'activate',
        description: 'Activate an agent',
        type: 1,
        options: [
          {
            name: 'id',
            description: 'Agent ID',
            type: 3,
            required: true,
          },
        ],
      },
      {
        name: 'deactivate',
        description: 'Deactivate an agent',
        type: 1,
        options: [
          {
            name: 'id',
            description: 'Agent ID',
            type: 3,
            required: true,
          },
        ],
      },
    ],
  },
];

// =============================================================================
// DISCORD WEBHOOK SENDER
// =============================================================================

/**
 * Send a notification to Discord via webhook
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  notification: DiscordNotification
): Promise<{ success: boolean; error?: string }> {
  try {
    const payload: Record<string, unknown> = {};

    // Add content
    if (notification.content) {
      let content = notification.content;

      // Add mentions
      if (notification.mentionUsers?.length) {
        const userMentions = notification.mentionUsers.map((id) => `<@${id}>`).join(' ');
        content = `${userMentions} ${content}`;
      }

      if (notification.mentionRoles?.length) {
        const roleMentions = notification.mentionRoles.map((id) => `<@&${id}>`).join(' ');
        content = `${roleMentions} ${content}`;
      }

      payload.content = content;
    }

    // Add embed
    if (notification.embed) {
      payload.embeds = [notification.embed];
    }

    // Send to Discord
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Register slash commands with Discord
 */
export async function registerSlashCommands(
  botToken: string,
  applicationId: string,
  guildId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Guild-specific or global registration
    const url = guildId
      ? `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`
      : `https://discord.com/api/v10/applications/${applicationId}/commands`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify(SLASH_COMMANDS),
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Format task status for display
 */
function formatStatus(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    backlog: '📋 Backlog',
    em_progresso: '🔄 In Progress',
    bloqueado: '🚨 Blocked',
    review: '👀 Review',
    concluido: '✅ Completed',
  };
  return labels[status] || status;
}

/**
 * Format duration in milliseconds to human readable
 */
function formatDuration(ms: number): string {
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

/**
 * Parse Discord interaction data
 */
export function parseInteraction(interaction: Record<string, unknown>): {
  type: string;
  command?: { name: string; subcommand?: string; options: Record<string, unknown> };
  userId: string;
  channelId: string;
  guildId?: string;
} {
  const data = interaction.data as Record<string, unknown> | undefined;
  const member = interaction.member as Record<string, unknown> | undefined;
  const user = member?.user as Record<string, unknown> | undefined;

  let command: { name: string; subcommand?: string; options: Record<string, unknown> } | undefined;

  if (data && data.name) {
    const options = (data.options as Array<Record<string, unknown>>) || [];
    const subcommand = options.find((o) => o.type === 1);

    command = {
      name: data.name as string,
      subcommand: subcommand?.name as string | undefined,
      options: {},
    };

    // Parse options
    const optionList = subcommand
      ? (subcommand.options as Array<Record<string, unknown>>) || []
      : options;

    for (const opt of optionList) {
      if (opt.name && opt.value !== undefined) {
        command.options[opt.name as string] = opt.value;
      }
    }
  }

  return {
    type: String(interaction.type),
    command,
    userId: (user?.id as string) || (interaction.user as Record<string, unknown>)?.id as string || '',
    channelId: interaction.channel_id as string || '',
    guildId: interaction.guild_id as string,
  };
}
