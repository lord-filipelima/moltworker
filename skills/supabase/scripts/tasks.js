#!/usr/bin/env node
/**
 * Supabase Tasks Script for Squad Builder
 * Usage:
 *   node tasks.js list [squad_id]     - List all tasks (optionally filter by squad)
 *   node tasks.js get <task_id>       - Get task details
 *   node tasks.js update <task_id> <status> - Update task status
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  process.exit(1);
}

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function listTasks(squadId) {
  let url = `${SUPABASE_URL}/rest/v1/tasks?select=*&order=created_at.desc`;
  if (squadId) {
    url += `&squad_id=eq.${squadId}`;
  }

  const response = await fetch(url, { headers });
  const tasks = await response.json();

  if (!response.ok) {
    console.error('Error fetching tasks:', tasks);
    return;
  }

  console.log(`Found ${tasks.length} tasks:\n`);
  tasks.forEach(task => {
    console.log(`[${task.status}] ${task.titulo}`);
    console.log(`  ID: ${task.id}`);
    console.log(`  Description: ${task.descricao || 'N/A'}`);
    console.log('');
  });
}

async function getTask(taskId) {
  const url = `${SUPABASE_URL}/rest/v1/tasks?id=eq.${taskId}&select=*`;

  const response = await fetch(url, { headers });
  const tasks = await response.json();

  if (!response.ok || tasks.length === 0) {
    console.error('Task not found:', taskId);
    return;
  }

  const task = tasks[0];
  console.log('Task Details:');
  console.log(`  Title: ${task.titulo}`);
  console.log(`  Status: ${task.status}`);
  console.log(`  Description: ${task.descricao || 'N/A'}`);
  console.log(`  Squad ID: ${task.squad_id}`);
  console.log(`  Created: ${task.created_at}`);
}

async function updateTaskStatus(taskId, status) {
  const validStatuses = ['backlog', 'em_progresso', 'bloqueado', 'review', 'concluido'];
  if (!validStatuses.includes(status)) {
    console.error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    return;
  }

  const url = `${SUPABASE_URL}/rest/v1/tasks?id=eq.${taskId}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status })
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('Error updating task:', result);
    return;
  }

  console.log(`Task ${taskId} updated to status: ${status}`);
}

// Main
const [,, command, ...args] = process.argv;

switch (command) {
  case 'list':
    listTasks(args[0]);
    break;
  case 'get':
    if (!args[0]) {
      console.error('Usage: tasks.js get <task_id>');
      process.exit(1);
    }
    getTask(args[0]);
    break;
  case 'update':
    if (args.length < 2) {
      console.error('Usage: tasks.js update <task_id> <status>');
      process.exit(1);
    }
    updateTaskStatus(args[0], args[1]);
    break;
  default:
    console.log('Usage:');
    console.log('  tasks.js list [squad_id]     - List tasks');
    console.log('  tasks.js get <task_id>       - Get task details');
    console.log('  tasks.js update <task_id> <status> - Update status');
    console.log('\nStatuses: backlog, em_progresso, bloqueado, review, concluido');
}
