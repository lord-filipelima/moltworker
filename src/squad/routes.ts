/**
 * Squad Builder API Routes
 *
 * RESTful API endpoints for squad management, task execution,
 * agent control, and workflow automation.
 */

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { createAccessMiddleware } from '../auth';
import { SupabaseClient } from './supabase-client';
import { AgentOrchestrator } from './orchestrator';
import { DEFAULT_PERSONAS } from './persona';
import type {
  ExecuteTaskRequest,
  StartWorkflowRequest,
  SyncRequest,
  DiscordWebhookPayload,
  DiscordNotification,
} from './types';
import {
  getNotificationService,
  NotificationConfig,
  NotificationEvent,
  notifyTaskEvent,
} from './notification-service';

/**
 * Squad Builder Routes
 * Routes are PUBLIC for easier integration with external dashboards
 * Authentication can be added per-route if needed
 */
const squadRoutes = new Hono<AppEnv>();

// NOTE: Authentication removed for easier dashboard integration
// To add auth back, uncomment the line below:
// squadRoutes.use('*', createAccessMiddleware({ type: 'json' }));

// Singleton instances (per-request in workers, but shared within a request)
let supabaseClient: SupabaseClient | null = null;
let orchestrator: AgentOrchestrator | null = null;

/**
 * Get or create Supabase client
 */
function getSupabase(env: AppEnv['Bindings']): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error('Supabase configuration missing. Set SUPABASE_URL and SUPABASE_ANON_KEY');
  }

  if (!supabaseClient) {
    supabaseClient = new SupabaseClient({
      url: env.SUPABASE_URL,
      anonKey: env.SUPABASE_ANON_KEY,
      serviceKey: env.SUPABASE_SERVICE_KEY,
    });
  }

  return supabaseClient;
}

/**
 * Get or create orchestrator
 */
function getOrchestrator(env: AppEnv['Bindings'], sandbox?: unknown): AgentOrchestrator {
  if (!orchestrator) {
    const supabase = getSupabase(env);
    orchestrator = new AgentOrchestrator(supabase, {
      sandbox: sandbox as any,
    });
  }
  return orchestrator;
}

// =============================================================================
// HEALTH & STATUS
// =============================================================================

// GET /api/squad/status - Get orchestrator status
squadRoutes.get('/status', async (c) => {
  try {
    const orch = getOrchestrator(c.env, c.get('sandbox'));
    const status = orch.getStatus();

    return c.json({
      success: true,
      status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /api/squad/health - Health check for Supabase connection
squadRoutes.get('/health', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const healthy = await supabase.healthCheck();

    return c.json({
      success: healthy,
      supabase: healthy ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// =============================================================================
// SYNC
// =============================================================================

// POST /api/squad/sync - Sync data from Supabase
squadRoutes.post('/sync', async (c) => {
  try {
    const body = await c.req.json<SyncRequest>();
    const supabase = getSupabase(c.env);
    const orch = getOrchestrator(c.env, c.get('sandbox'));

    let squadsSync = 0;
    let agentsSync = 0;
    let tasksSync = 0;
    const errors: string[] = [];

    if (body.squadId) {
      // Sync specific squad
      const data = await supabase.getSquadWithRelations(body.squadId);
      if (data) {
        squadsSync = 1;
        agentsSync = data.agentes.length;
        tasksSync = data.tasks.length;

        // Initialize orchestrator with this squad
        await orch.initialize(body.squadId);
      } else {
        errors.push(`Squad ${body.squadId} not found`);
      }
    } else {
      // Sync all squads
      const squads = await supabase.getSquads();
      squadsSync = squads.length;

      for (const squad of squads) {
        try {
          const data = await supabase.getSquadWithRelations(squad.id);
          if (data) {
            agentsSync += data.agentes.length;
            tasksSync += data.tasks.length;
          }
        } catch (err) {
          errors.push(`Failed to sync squad ${squad.id}: ${err}`);
        }
      }
    }

    return c.json({
      success: errors.length === 0,
      squadsSync,
      agentsSync,
      tasksSync,
      lastSync: new Date().toISOString(),
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// =============================================================================
// SQUADS
// =============================================================================

// GET /api/squad/squads - List all squads
squadRoutes.get('/squads', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const squads = await supabase.getSquads();
    return c.json({ success: true, squads });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /api/squad/squads/:id - Get squad with relations
squadRoutes.get('/squads/:id', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const squadId = c.req.param('id');
    const data = await supabase.getSquadWithRelations(squadId);

    if (!data) {
      return c.json({ success: false, error: 'Squad not found' }, 404);
    }

    return c.json({ success: true, ...data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /api/squad/squads/:id/kanban - Get Kanban board
squadRoutes.get('/squads/:id/kanban', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const squadId = c.req.param('id');
    const board = await supabase.getKanbanBoard(squadId);

    return c.json({ success: true, board });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// =============================================================================
// AGENTS
// =============================================================================

// GET /api/squad/agents - List all agents
squadRoutes.get('/agents', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const squadId = c.req.query('squad_id');
    const agentes = await supabase.getAgentes(squadId);

    return c.json({ success: true, agentes });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /api/squad/agents/:id - Get agent details
squadRoutes.get('/agents/:id', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const agentId = c.req.param('id');
    const agente = await supabase.getAgente(agentId);

    if (!agente) {
      return c.json({ success: false, error: 'Agent not found' }, 404);
    }

    // Get runtime status from orchestrator
    const orch = getOrchestrator(c.env, c.get('sandbox'));
    const instance = orch.getAgent(agentId);

    return c.json({
      success: true,
      agente,
      runtime: instance
        ? {
            status: instance.status,
            currentTask: instance.currentTask?.titulo,
            metrics: instance.metrics,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/squad/agents/:id/activate - Activate agent
squadRoutes.post('/agents/:id/activate', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const orch = getOrchestrator(c.env, c.get('sandbox'));
    const agentId = c.req.param('id');

    const agente = await supabase.activateAgente(agentId);
    orch.registerAgent(agente);

    return c.json({ success: true, agente });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/squad/agents/:id/deactivate - Deactivate agent
squadRoutes.post('/agents/:id/deactivate', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const orch = getOrchestrator(c.env, c.get('sandbox'));
    const agentId = c.req.param('id');

    const agente = await supabase.deactivateAgente(agentId);
    orch.unregisterAgent(agentId);

    return c.json({ success: true, agente });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /api/squad/agents/templates - Get default persona templates
squadRoutes.get('/agents/templates', async (c) => {
  return c.json({
    success: true,
    templates: Object.entries(DEFAULT_PERSONAS).map(([key, value]) => ({
      key,
      ...value,
    })),
  });
});

// =============================================================================
// TASKS
// =============================================================================

// GET /api/squad/tasks - List tasks
squadRoutes.get('/tasks', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const squadId = c.req.query('squad_id');
    const status = c.req.query('status') as any;
    const tasks = await supabase.getTasks(squadId, status);

    return c.json({ success: true, tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /api/squad/tasks/:id - Get task with messages
squadRoutes.get('/tasks/:id', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const taskId = c.req.param('id');

    const task = await supabase.getTask(taskId);
    if (!task) {
      return c.json({ success: false, error: 'Task not found' }, 404);
    }

    const mensagens = await supabase.getMensagens(taskId);

    // Get execution progress
    const orch = getOrchestrator(c.env, c.get('sandbox'));
    const progress = orch.getTaskProgress(taskId);

    return c.json({
      success: true,
      task,
      mensagens,
      progress,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/squad/tasks/:id/execute - Execute task
squadRoutes.post('/tasks/:id/execute', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const orch = getOrchestrator(c.env, c.get('sandbox'));
    const taskId = c.req.param('id');
    const body = await c.req.json<Partial<ExecuteTaskRequest>>();

    // Get task to find squad_id
    const task = await supabase.getTask(taskId);
    if (!task) {
      return c.json({ success: false, error: 'Task not found' }, 404);
    }

    // Auto-initialize orchestrator with the task's squad
    await orch.initialize(task.squad_id);

    const result = await orch.executeTask({
      taskId,
      agentId: body.agentId,
      priority: body.priority,
      context: body.context,
    });

    return c.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/squad/tasks/:id/pause - Pause task
squadRoutes.post('/tasks/:id/pause', async (c) => {
  try {
    const orch = getOrchestrator(c.env, c.get('sandbox'));
    const taskId = c.req.param('id');

    const paused = await orch.pauseTask(taskId);

    return c.json({
      success: paused,
      message: paused ? 'Task paused' : 'Task not running',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/squad/tasks/:id/resume - Resume task
squadRoutes.post('/tasks/:id/resume', async (c) => {
  try {
    const orch = getOrchestrator(c.env, c.get('sandbox'));
    const taskId = c.req.param('id');

    const result = await orch.resumeTask(taskId);

    if (!result) {
      return c.json({
        success: false,
        error: 'Task not found or not paused',
      }, 400);
    }

    return c.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /api/squad/tasks/:id/progress - Get task progress
squadRoutes.get('/tasks/:id/progress', async (c) => {
  try {
    const orch = getOrchestrator(c.env, c.get('sandbox'));
    const taskId = c.req.param('id');

    const progress = orch.getTaskProgress(taskId);

    if (!progress) {
      return c.json({
        success: false,
        error: 'No active execution for this task',
      }, 404);
    }

    return c.json({ success: true, progress });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// =============================================================================
// WORKFLOWS
// =============================================================================

// GET /api/squad/workflows - List workflows
squadRoutes.get('/workflows', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const squadId = c.req.query('squad_id');
    const workflows = await supabase.getWorkflows(squadId);

    return c.json({ success: true, workflows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /api/squad/workflows/:id - Get workflow details
squadRoutes.get('/workflows/:id', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const workflowId = c.req.param('id');

    const workflow = await supabase.getWorkflow(workflowId);
    if (!workflow) {
      return c.json({ success: false, error: 'Workflow not found' }, 404);
    }

    return c.json({ success: true, workflow });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/squad/workflows/:id/start - Start workflow
squadRoutes.post('/workflows/:id/start', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const workflowId = c.req.param('id');
    const body = await c.req.json<Partial<StartWorkflowRequest>>();

    const workflow = await supabase.getWorkflow(workflowId);
    if (!workflow) {
      return c.json({ success: false, error: 'Workflow not found' }, 404);
    }

    // Create workflow execution
    const execution = await supabase.createWorkflowExecution({
      workflow_id: workflowId,
      task_id: body.taskId,
      current_step: 0,
      status: 'running',
      context: body.input || {},
    });

    // TODO: Start workflow engine execution
    // For now, just return the execution

    return c.json({
      success: true,
      executionId: execution.id,
      workflowId: workflow.id,
      status: execution.status,
      currentStep: workflow.steps[0]?.id || 'none',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/squad/workflows/:id/stop - Stop workflow
squadRoutes.post('/workflows/:id/stop', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const executionId = c.req.param('id');

    const execution = await supabase.updateWorkflowExecution(executionId, {
      status: 'paused',
    });

    return c.json({ success: true, execution });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /api/squad/workflows/executions/:id - Get workflow execution status
squadRoutes.get('/workflows/executions/:id', async (c) => {
  try {
    const supabase = getSupabase(c.env);
    const executionId = c.req.param('id');

    const execution = await supabase.getWorkflowExecution(executionId);
    if (!execution) {
      return c.json({ success: false, error: 'Execution not found' }, 404);
    }

    return c.json({ success: true, execution });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// =============================================================================
// DISCORD INTEGRATION
// =============================================================================

// POST /api/squad/discord/webhook - Receive Discord webhook events
squadRoutes.post('/discord/webhook', async (c) => {
  try {
    // Verify webhook signature if configured
    const webhookSecret = c.env.DISCORD_WEBHOOK_SECRET;
    if (webhookSecret) {
      const signature = c.req.header('X-Signature-Ed25519');
      const timestamp = c.req.header('X-Signature-Timestamp');

      if (!signature || !timestamp) {
        return c.json({ error: 'Missing signature headers' }, 401);
      }

      // TODO: Verify Ed25519 signature
    }

    const payload = await c.req.json<DiscordWebhookPayload>();

    // Handle different event types
    if (payload.type === 'command' && payload.command) {
      const { name, args } = payload.command;
      const supabase = getSupabase(c.env);
      const orch = getOrchestrator(c.env, c.get('sandbox'));

      switch (name) {
        case 'status':
          const status = orch.getStatus();
          return c.json({
            type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
            data: {
              content: `**Squad Status**\nAgents: ${status.agents.length}\nQueue: ${status.queue.queueSize} tasks\nActive: ${status.queue.activeExecutions}`,
            },
          });

        case 'tasks':
          const tasks = await supabase.getTasks(undefined, 'em_progresso');
          const taskList = tasks.slice(0, 5).map((t) => `- ${t.titulo}`).join('\n');
          return c.json({
            type: 4,
            data: {
              content: `**Active Tasks**\n${taskList || 'No active tasks'}`,
            },
          });

        case 'execute':
          if (args.length < 1) {
            return c.json({
              type: 4,
              data: { content: 'Usage: /execute <task_id>' },
            });
          }
          try {
            const result = await orch.executeTask({ taskId: args[0] });
            return c.json({
              type: 4,
              data: {
                content: `Task ${args[0]} started. Execution ID: ${result.executionId}`,
              },
            });
          } catch (err) {
            return c.json({
              type: 4,
              data: { content: `Error: ${err}` },
            });
          }

        default:
          return c.json({
            type: 4,
            data: { content: `Unknown command: ${name}` },
          });
      }
    }

    return c.json({ success: true, received: payload.type });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/squad/discord/notify - Send notification to Discord
squadRoutes.post('/discord/notify', async (c) => {
  try {
    const notification = await c.req.json<DiscordNotification>();

    // Get webhook URL from channel or direct
    let webhookUrl = notification.webhookUrl;

    if (!webhookUrl && notification.channelId) {
      // Would look up from discord_channels table
      return c.json({
        success: false,
        error: 'Channel webhook lookup not implemented',
      }, 400);
    }

    if (!webhookUrl) {
      return c.json({
        success: false,
        error: 'No webhook URL or channel ID provided',
      }, 400);
    }

    // Build Discord message payload
    const discordPayload: Record<string, unknown> = {};

    if (notification.content) {
      discordPayload.content = notification.content;
    }

    if (notification.embed) {
      discordPayload.embeds = [notification.embed];
    }

    if (notification.mentionUsers?.length) {
      const mentions = notification.mentionUsers.map((id) => `<@${id}>`).join(' ');
      discordPayload.content = `${mentions} ${discordPayload.content || ''}`;
    }

    // Send to Discord webhook
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload),
    });

    if (!response.ok) {
      const error = await response.text();
      return c.json({
        success: false,
        error: `Discord API error: ${error}`,
      }, 500);
    }

    return c.json({ success: true, message: 'Notification sent' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// =============================================================================
// NOTIFICATION CONFIGURATION
// =============================================================================

// GET /api/squad/notifications/config/:squadId - Get notification config
squadRoutes.get('/notifications/config/:squadId', async (c) => {
  try {
    const squadId = c.req.param('squadId');
    const notificationService = getNotificationService();
    const config = notificationService.getConfig(squadId);

    return c.json({
      success: true,
      squadId,
      configured: !!config,
      config: config || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/squad/notifications/config/:squadId - Set notification config
squadRoutes.post('/notifications/config/:squadId', async (c) => {
  try {
    const squadId = c.req.param('squadId');
    const body = await c.req.json<NotificationConfig>();

    // Validate required fields
    if (!body.webhookUrl) {
      return c.json({ success: false, error: 'webhookUrl is required' }, 400);
    }

    if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
      return c.json({ success: false, error: 'events array is required' }, 400);
    }

    // Validate events
    const validEvents: NotificationEvent[] = [
      'task_started',
      'task_completed',
      'task_blocked',
      'task_unblocked',
      'task_assigned',
      'agent_activated',
      'agent_deactivated',
      'execution_error',
      'workflow_started',
      'workflow_completed',
    ];

    const invalidEvents = body.events.filter((e) => !validEvents.includes(e));
    if (invalidEvents.length > 0) {
      return c.json({
        success: false,
        error: `Invalid events: ${invalidEvents.join(', ')}`,
        validEvents,
      }, 400);
    }

    const notificationService = getNotificationService();
    notificationService.configure(squadId, body);

    return c.json({
      success: true,
      squadId,
      config: body,
      message: 'Notification config saved',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// DELETE /api/squad/notifications/config/:squadId - Remove notification config
squadRoutes.delete('/notifications/config/:squadId', async (c) => {
  try {
    const squadId = c.req.param('squadId');
    const notificationService = getNotificationService();
    const removed = notificationService.remove(squadId);

    return c.json({
      success: true,
      squadId,
      removed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/squad/notifications/test/:squadId - Test notification
squadRoutes.post('/notifications/test/:squadId', async (c) => {
  try {
    const squadId = c.req.param('squadId');
    const body = await c.req.json<{ event?: NotificationEvent }>().catch(() => ({}));
    const notificationService = getNotificationService();

    const config = notificationService.getConfig(squadId);
    if (!config) {
      return c.json({
        success: false,
        error: 'No notification config for this squad. Configure first via POST /notifications/config/:squadId',
      }, 400);
    }

    // Send test notification
    const testEvent = body.event || 'task_completed';
    const result = await notificationService.notify(squadId, {
      event: testEvent,
      message: `Test notification from Squad Builder API`,
      task: {
        id: 'test-task-id',
        squad_id: squadId,
        titulo: 'Test Task',
        status: 'concluido',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      agent: {
        id: 'test-agent-id',
        squad_id: squadId,
        nome: 'Test Agent',
        ativo: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });

    return c.json({
      success: result.success,
      squadId,
      event: testEvent,
      error: result.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// GET /api/squad/notifications/events - List available notification events
squadRoutes.get('/notifications/events', async (c) => {
  return c.json({
    success: true,
    events: [
      { name: 'task_started', description: 'When a task execution begins' },
      { name: 'task_completed', description: 'When a task is marked as completed' },
      { name: 'task_blocked', description: 'When a task is blocked (requires attention)' },
      { name: 'task_unblocked', description: 'When a blocked task is resumed' },
      { name: 'task_assigned', description: 'When a task is assigned to an agent' },
      { name: 'agent_activated', description: 'When an agent is activated' },
      { name: 'agent_deactivated', description: 'When an agent is deactivated' },
      { name: 'execution_error', description: 'When a task execution fails with error' },
      { name: 'workflow_started', description: 'When a workflow begins execution' },
      { name: 'workflow_completed', description: 'When a workflow finishes execution' },
    ],
  });
});

// =============================================================================
// ORCHESTRATOR CONTROL
// =============================================================================

// POST /api/squad/orchestrator/init/:squadId - Initialize orchestrator with a squad
squadRoutes.post('/orchestrator/init/:squadId', async (c) => {
  try {
    const orch = getOrchestrator(c.env, c.get('sandbox'));
    const squadId = c.req.param('squadId');

    await orch.initialize(squadId);

    return c.json({
      success: true,
      message: `Orchestrator initialized for squad ${squadId}`,
      status: orch.getStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/squad/orchestrator/start - Start auto-processing
squadRoutes.post('/orchestrator/start', async (c) => {
  try {
    const orch = getOrchestrator(c.env, c.get('sandbox'));
    const body = await c.req.json<{ intervalMs?: number }>().catch(() => ({ intervalMs: undefined }));

    orch.start(body.intervalMs);

    return c.json({
      success: true,
      message: 'Orchestrator started',
      status: orch.getStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/squad/orchestrator/stop - Stop auto-processing
squadRoutes.post('/orchestrator/stop', async (c) => {
  try {
    const orch = getOrchestrator(c.env, c.get('sandbox'));
    orch.stop();

    return c.json({
      success: true,
      message: 'Orchestrator stopped',
      status: orch.getStatus(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

export { squadRoutes };
