#!/usr/bin/env node
/**
 * Supabase Agents Script for Squad Builder
 * Usage:
 *   node agents.js list <squad_id>    - List agents in a squad
 *   node agents.js get <agent_id>     - Get agent details (including soul, rules)
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
  'Content-Type': 'application/json'
};

async function listAgents(squadId) {
  const url = `${SUPABASE_URL}/rest/v1/agentes?squad_id=eq.${squadId}&select=*&order=nome.asc`;

  const response = await fetch(url, { headers });
  const agents = await response.json();

  if (!response.ok) {
    console.error('Error fetching agents:', agents);
    return;
  }

  console.log(`Agents in squad ${squadId}:\n`);
  agents.forEach(agent => {
    const status = agent.ativo ? 'ACTIVE' : 'INACTIVE';
    console.log(`[${status}] ${agent.nome}`);
    console.log(`  ID: ${agent.id}`);
    console.log(`  Soul: ${agent.soul || 'Not defined'}`);
    console.log('');
  });
}

async function getAgent(agentId) {
  const url = `${SUPABASE_URL}/rest/v1/agentes?id=eq.${agentId}&select=*`;

  const response = await fetch(url, { headers });
  const agents = await response.json();

  if (!response.ok || agents.length === 0) {
    console.error('Agent not found:', agentId);
    return;
  }

  const agent = agents[0];
  console.log('Agent Details:');
  console.log(`  Name: ${agent.nome}`);
  console.log(`  Active: ${agent.ativo ? 'Yes' : 'No'}`);
  console.log(`  Squad ID: ${agent.squad_id}`);
  console.log(`\n  Soul (Personality):\n    ${agent.soul || 'Not defined'}`);

  if (agent.regras) {
    console.log(`\n  Rules:\n    ${JSON.stringify(agent.regras, null, 2).replace(/\n/g, '\n    ')}`);
  }

  if (agent.limitadores) {
    console.log(`\n  Limiters:\n    ${JSON.stringify(agent.limitadores, null, 2).replace(/\n/g, '\n    ')}`);
  }

  if (agent.gatilhos_bloqueio) {
    console.log(`\n  Block Triggers:\n    ${JSON.stringify(agent.gatilhos_bloqueio, null, 2).replace(/\n/g, '\n    ')}`);
  }
}

// Main
const [,, command, ...args] = process.argv;

switch (command) {
  case 'list':
    if (!args[0]) {
      console.error('Usage: agents.js list <squad_id>');
      process.exit(1);
    }
    listAgents(args[0]);
    break;
  case 'get':
    if (!args[0]) {
      console.error('Usage: agents.js get <agent_id>');
      process.exit(1);
    }
    getAgent(args[0]);
    break;
  default:
    console.log('Usage:');
    console.log('  agents.js list <squad_id>   - List agents in squad');
    console.log('  agents.js get <agent_id>    - Get agent details');
}
