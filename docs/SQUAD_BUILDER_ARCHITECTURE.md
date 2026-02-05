# Squad Builder - Architecture Specification

## Overview

Squad Builder integrates the Lovable Dashboard (Supabase) with Moltworker (OpenClaw runtime) to create a multi-agent task management system with Discord integration.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SQUAD BUILDER SYSTEM                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌────────────────┐    ┌────────────────┐    ┌────────────────────────┐    │
│  │    LOVABLE     │    │    SUPABASE    │    │       DISCORD          │    │
│  │   Dashboard    │◄──►│    Database    │◄──►│   Bot + Webhooks       │    │
│  │   (React)      │    │   + Realtime   │    │                        │    │
│  └────────────────┘    └────────────────┘    └────────────────────────┘    │
│          │                     │                        │                   │
│          └─────────────────────┼────────────────────────┘                   │
│                                │                                            │
│                                ▼                                            │
│                    ┌────────────────────────┐                               │
│                    │    MOLTWORKER API      │                               │
│                    │   (Squad Builder API)  │                               │
│                    │   /api/squad/*         │                               │
│                    └────────────────────────┘                               │
│                                │                                            │
│                                ▼                                            │
│              ┌─────────────────────────────────────┐                        │
│              │      AGENT ORCHESTRATOR             │                        │
│              │   (Multi-Agent Task Distribution)   │                        │
│              │   - Task Queue Management           │                        │
│              │   - Agent Selection                 │                        │
│              │   - Workflow Execution              │                        │
│              └─────────────────────────────────────┘                        │
│                                │                                            │
│         ┌──────────┬──────────┼──────────┬──────────┐                      │
│         ▼          ▼          ▼          ▼          ▼                      │
│    ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│    │ Agent 1 │ │ Agent 2 │ │ Agent 3 │ │ Agent 4 │ │ Agent N │            │
│    │ Persona │ │ Persona │ │ Persona │ │ Persona │ │ Persona │            │
│    │  "Dev"  │ │"Review" │ │ "Test"  │ │"Deploy" │ │  ...    │            │
│    └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Supabase Database (Source of Truth)

The Lovable dashboard already has these tables:

```sql
-- Squads (teams of agents)
CREATE TABLE squads (
  id UUID PRIMARY KEY,
  nome VARCHAR NOT NULL,
  descricao TEXT,
  cor VARCHAR,
  regras_globais JSONB,
  gatilhos_bloqueio JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Agents (AI workers with personas)
CREATE TABLE agentes (
  id UUID PRIMARY KEY,
  squad_id UUID REFERENCES squads(id),
  nome VARCHAR NOT NULL,
  tipo VARCHAR,
  soul TEXT,              -- Agent persona/personality
  regras JSONB,           -- Agent-specific rules
  limitadores JSONB,      -- Rate limits, restrictions
  gatilhos_bloqueio JSONB,
  ativo BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Tasks (work items)
CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  squad_id UUID REFERENCES squads(id),
  titulo VARCHAR NOT NULL,
  descricao TEXT,
  status task_status,     -- backlog, em_progresso, bloqueado, review, concluido
  motivo_bloqueio TEXT,
  assigned_agent_id UUID REFERENCES agentes(id),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Messages (agent communications)
CREATE TABLE mensagens (
  id UUID PRIMARY KEY,
  task_id UUID REFERENCES tasks(id),
  agente_id UUID REFERENCES agentes(id),
  conteudo TEXT,
  tipo message_type,      -- resposta, pergunta, bloqueio, entrega
  created_at TIMESTAMP
);
```

**Additional Tables Needed:**

```sql
-- Workflows (automation sequences)
CREATE TABLE workflows (
  id UUID PRIMARY KEY,
  squad_id UUID REFERENCES squads(id),
  nome VARCHAR NOT NULL,
  descricao TEXT,
  steps JSONB,            -- Array of workflow steps
  triggers JSONB,         -- What starts this workflow
  ativo BOOLEAN,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Workflow Executions (running instances)
CREATE TABLE workflow_executions (
  id UUID PRIMARY KEY,
  workflow_id UUID REFERENCES workflows(id),
  task_id UUID REFERENCES tasks(id),
  current_step INTEGER,
  status VARCHAR,         -- running, paused, completed, failed
  context JSONB,          -- Execution state/variables
  started_at TIMESTAMP,
  completed_at TIMESTAMP
);

-- Discord Channel Mappings
CREATE TABLE discord_channels (
  id UUID PRIMARY KEY,
  squad_id UUID REFERENCES squads(id),
  channel_id VARCHAR NOT NULL,
  channel_type VARCHAR,   -- kanban, notifications, chat
  webhook_url TEXT,
  created_at TIMESTAMP
);
```

### 2. Moltworker API Extensions

New routes under `/api/squad/*`:

```typescript
// Squad Management
POST   /api/squad/sync                    // Sync from Supabase
GET    /api/squad/status                  // Get orchestrator status

// Task Execution
POST   /api/squad/tasks/:id/execute       // Start task execution
POST   /api/squad/tasks/:id/pause         // Pause task
POST   /api/squad/tasks/:id/resume        // Resume task
GET    /api/squad/tasks/:id/progress      // Get execution progress

// Agent Management
GET    /api/squad/agents                  // List available agents
POST   /api/squad/agents/:id/activate     // Activate agent persona
POST   /api/squad/agents/:id/deactivate   // Deactivate agent

// Workflow Execution
POST   /api/squad/workflows/:id/start     // Start workflow
POST   /api/squad/workflows/:id/stop      // Stop workflow
GET    /api/squad/workflows/:id/status    // Get workflow status

// Discord Integration
POST   /api/squad/discord/webhook         // Receive Discord events
POST   /api/squad/discord/notify          // Send notification to Discord
```

### 3. Agent Orchestrator

The orchestrator manages multi-agent coordination:

```typescript
interface AgentOrchestrator {
  // Task queue
  queue: TaskQueue;

  // Active agents
  agents: Map<string, AgentInstance>;

  // Methods
  assignTask(task: Task): Promise<AgentInstance>;
  executeTask(agent: AgentInstance, task: Task): Promise<TaskResult>;
  handleBlocking(task: Task, reason: string): Promise<void>;
  broadcastProgress(task: Task, progress: Progress): void;
}

interface AgentInstance {
  id: string;
  persona: AgentPersona;
  status: 'idle' | 'working' | 'blocked';
  currentTask?: Task;

  // Execute task with this agent's persona
  execute(task: Task): AsyncIterator<TaskProgress>;
}

interface AgentPersona {
  id: string;
  name: string;
  soul: string;           // System prompt personality
  rules: Rule[];          // Behavioral rules
  limiters: Limiter[];    // Constraints
  blockTriggers: string[];// When to block and ask for help
}
```

### 4. Workflow Engine

Workflows are sequences of automated steps:

```typescript
interface Workflow {
  id: string;
  name: string;
  steps: WorkflowStep[];
  triggers: WorkflowTrigger[];
}

interface WorkflowStep {
  id: string;
  type: 'agent_task' | 'condition' | 'parallel' | 'wait' | 'notify';
  config: StepConfig;
  onSuccess?: string;     // Next step ID
  onFailure?: string;     // Step ID on failure
  onBlock?: string;       // Step ID when blocked
}

interface WorkflowTrigger {
  type: 'manual' | 'schedule' | 'webhook' | 'task_status' | 'discord_command';
  config: TriggerConfig;
}

// Example workflow: Code Review Pipeline
const codeReviewWorkflow: Workflow = {
  id: 'code-review',
  name: 'Code Review Pipeline',
  steps: [
    { id: 'analyze', type: 'agent_task', config: { agentType: 'reviewer', action: 'analyze_pr' }},
    { id: 'test', type: 'agent_task', config: { agentType: 'tester', action: 'run_tests' }},
    { id: 'review_result', type: 'condition', config: { check: 'tests_passed' }},
    { id: 'approve', type: 'agent_task', config: { agentType: 'reviewer', action: 'approve_pr' }},
    { id: 'notify_team', type: 'notify', config: { channel: 'discord', message: 'PR approved!' }},
  ],
  triggers: [
    { type: 'webhook', config: { event: 'pull_request.opened' }},
    { type: 'discord_command', config: { command: '/review' }},
  ]
};
```

### 5. Discord Integration

Two-way Discord integration:

```typescript
// Discord -> Moltworker
interface DiscordWebhookPayload {
  type: 'command' | 'message' | 'reaction';
  channelId: string;
  userId: string;
  content: string;
  command?: {
    name: string;
    args: string[];
  };
}

// Moltworker -> Discord
interface DiscordNotification {
  channelId: string;
  type: 'task_update' | 'block_alert' | 'completion' | 'message';
  content: string;
  embed?: DiscordEmbed;
}

// Discord Bot Commands
/squad status                    - Show squad status
/squad tasks                     - List current tasks
/task create <title>             - Create new task
/task assign <id> <agent>        - Assign task to agent
/task status <id>                - Get task status
/task block <id> <reason>        - Block task with reason
/agent list                      - List available agents
/agent activate <name>           - Activate agent
/workflow run <name>             - Run workflow
/workflow stop <id>              - Stop workflow
```

### 6. Real-time Sync Strategy

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   LOVABLE   │     │  SUPABASE   │     │  MOLTWORKER │
│  Dashboard  │     │  Realtime   │     │    Worker   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       │  User updates     │                   │
       │  Kanban board     │                   │
       │──────────────────►│                   │
       │                   │                   │
       │                   │  Realtime event   │
       │                   │──────────────────►│
       │                   │                   │
       │                   │                   │  Agent executes
       │                   │                   │  task
       │                   │                   │
       │                   │  Status update    │
       │                   │◄──────────────────│
       │                   │                   │
       │  Realtime update  │                   │
       │◄──────────────────│                   │
       │                   │                   │
       │  UI reflects      │                   │
       │  new status       │                   │
       │                   │                   │
```

## Implementation Phases

### Phase 1: Core API (This PR)
- [x] Architecture design
- [ ] Squad API routes (`/api/squad/*`)
- [ ] Supabase client integration
- [ ] Basic task execution endpoint
- [ ] Agent persona configuration

### Phase 2: Agent Orchestrator
- [ ] Multi-agent queue system
- [ ] Task assignment logic
- [ ] Progress reporting
- [ ] Blocking/unblocking flow

### Phase 3: Discord Integration
- [ ] Discord bot setup
- [ ] Webhook receiver
- [ ] Notification sender
- [ ] Slash commands

### Phase 4: Workflow Engine
- [ ] Workflow definition schema
- [ ] Step execution engine
- [ ] Conditional branching
- [ ] Parallel execution

### Phase 5: Dashboard Integration
- [ ] Supabase Realtime subscription
- [ ] Bi-directional sync
- [ ] Conflict resolution

## Environment Variables

New secrets needed:

```bash
# Supabase connection
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJxxx
SUPABASE_SERVICE_KEY=eyJxxx  # For server-side operations

# Discord integration
DISCORD_BOT_TOKEN=xxx        # Already exists
DISCORD_WEBHOOK_SECRET=xxx   # For verifying webhooks
DISCORD_GUILD_ID=xxx         # Server ID for commands
```

## File Structure

```
src/
├── squad/
│   ├── index.ts              # Squad module exports
│   ├── types.ts              # TypeScript interfaces
│   ├── orchestrator.ts       # Agent orchestrator
│   ├── queue.ts              # Task queue implementation
│   ├── persona.ts            # Agent persona management
│   └── workflow/
│       ├── engine.ts         # Workflow execution engine
│       ├── steps.ts          # Step type implementations
│       └── triggers.ts       # Trigger handlers
├── integrations/
│   ├── supabase/
│   │   ├── client.ts         # Supabase client
│   │   ├── sync.ts           # Bi-directional sync
│   │   └── realtime.ts       # Realtime subscriptions
│   └── discord/
│       ├── bot.ts            # Discord bot logic
│       ├── commands.ts       # Slash commands
│       └── webhooks.ts       # Webhook handling
└── routes/
    └── squad.ts              # Squad API routes
```
