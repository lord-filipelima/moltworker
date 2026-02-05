#!/usr/bin/env node
/**
 * Supabase Messages Script for Squad Builder
 * Usage:
 *   node messages.js list <task_id>   - List messages for a task
 *   node messages.js add <task_id> <agent_name> <type> "<content>" - Add message
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

async function listMessages(taskId) {
  const url = `${SUPABASE_URL}/rest/v1/mensagens?task_id=eq.${taskId}&select=*&order=created_at.asc`;

  const response = await fetch(url, { headers });
  const messages = await response.json();

  if (!response.ok) {
    console.error('Error fetching messages:', messages);
    return;
  }

  console.log(`Messages for task ${taskId}:\n`);
  messages.forEach(msg => {
    const time = new Date(msg.created_at).toLocaleString('pt-BR');
    console.log(`[${time}] ${msg.agente_nome} (${msg.tipo}):`);
    console.log(`  ${msg.conteudo}`);
    console.log('');
  });
}

async function addMessage(taskId, agentName, tipo, content) {
  const validTypes = ['resposta', 'pergunta', 'bloqueio', 'entrega'];
  if (!validTypes.includes(tipo)) {
    console.error(`Invalid type. Must be one of: ${validTypes.join(', ')}`);
    return;
  }

  const url = `${SUPABASE_URL}/rest/v1/mensagens`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      task_id: taskId,
      agente_nome: agentName,
      tipo: tipo,
      conteudo: content
    })
  });

  const result = await response.json();

  if (!response.ok) {
    console.error('Error adding message:', result);
    return;
  }

  console.log(`Message added by ${agentName} (${tipo})`);
}

// Main
const [,, command, ...args] = process.argv;

switch (command) {
  case 'list':
    if (!args[0]) {
      console.error('Usage: messages.js list <task_id>');
      process.exit(1);
    }
    listMessages(args[0]);
    break;
  case 'add':
    if (args.length < 4) {
      console.error('Usage: messages.js add <task_id> <agent_name> <type> "<content>"');
      process.exit(1);
    }
    addMessage(args[0], args[1], args[2], args.slice(3).join(' '));
    break;
  default:
    console.log('Usage:');
    console.log('  messages.js list <task_id>   - List messages');
    console.log('  messages.js add <task_id> <agent_name> <type> "<content>" - Add message');
    console.log('\nTypes: resposta, pergunta, bloqueio, entrega');
    console.log('Agents: Maestro, Criativo, Critico, Polidor');
}
