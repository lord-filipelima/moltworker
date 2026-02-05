---
name: supabase
description: Interact with Supabase database for Squad Builder. Read and update tasks, agents, squads, and messages. Use for tracking task progress and managing the multi-agent workflow.
---

# Supabase Integration for Squad Builder

Interact with the Squad Builder database hosted on Supabase.

## Prerequisites

Environment variables (set as Cloudflare Worker secrets):
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_KEY` - Service role key for privileged access

## Available Scripts

### List Tasks
```bash
node /skills/supabase/scripts/tasks.js list [squad_id]
```

### Get Task Details
```bash
node /skills/supabase/scripts/tasks.js get <task_id>
```

### Update Task Status
```bash
node /skills/supabase/scripts/tasks.js update <task_id> <status>
# Status: backlog, em_progresso, bloqueado, review, concluido
```

### Add Message to Task
```bash
node /skills/supabase/scripts/messages.js add <task_id> <agent_name> <message_type> "<content>"
# Types: resposta, pergunta, bloqueio, entrega
```

### List Messages for Task
```bash
node /skills/supabase/scripts/messages.js list <task_id>
```

### List Agents in Squad
```bash
node /skills/supabase/scripts/agents.js list <squad_id>
```

## Database Schema

### Tasks Table
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Task ID |
| titulo | text | Task title |
| descricao | text | Task description |
| status | enum | backlog, em_progresso, bloqueado, review, concluido |
| squad_id | uuid | Parent squad |
| created_at | timestamp | Creation time |

### Messages Table
| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Message ID |
| task_id | uuid | Parent task |
| agente_nome | text | Agent name (Maestro, Criativo, etc.) |
| tipo | enum | resposta, pergunta, bloqueio, entrega |
| conteudo | text | Message content |
| created_at | timestamp | Creation time |

## Workflow Example

1. Get pending tasks: `tasks.js list`
2. Pick a task and start working: `tasks.js update <id> em_progresso`
3. Add progress message: `messages.js add <id> Maestro resposta "Analyzing task..."`
4. If blocked: `tasks.js update <id> bloqueado` + `messages.js add <id> Critico bloqueio "Need clarification on X"`
5. When done: `tasks.js update <id> concluido` + `messages.js add <id> Polidor entrega "Task completed!"`
