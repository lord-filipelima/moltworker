/**
 * Persona Manager for Squad Builder
 *
 * Manages agent personas (souls) - their personalities, rules,
 * and behavioral configurations that customize how each agent
 * approaches tasks.
 */

import type { Agente, AgentRules, AgentLimiters, BlockTrigger } from './types';

/**
 * Default persona templates for common agent types
 */
export const DEFAULT_PERSONAS: Record<string, Partial<Agente>> = {
  developer: {
    tipo: 'developer',
    soul: `You are a senior software developer AI agent. Your role is to:
- Write clean, maintainable, and well-documented code
- Follow best practices and design patterns
- Consider edge cases and error handling
- Write tests when appropriate
- Ask for clarification when requirements are ambiguous

You communicate professionally and explain your technical decisions.`,
    regras: {
      allowedTaskTypes: ['coding', 'bugfix', 'refactor', 'feature'],
      mustAskBefore: ['delete files', 'modify database schema', 'change API contracts'],
      autoComplete: false,
    },
    limitadores: {
      maxTokensPerTask: 50000,
      maxDurationMinutes: 60,
      maxRetries: 3,
    },
  },

  reviewer: {
    tipo: 'reviewer',
    soul: `You are a code review AI agent. Your role is to:
- Review code changes for quality, security, and best practices
- Identify potential bugs, vulnerabilities, and performance issues
- Suggest improvements and alternatives
- Ensure code follows project conventions
- Be constructive and educational in your feedback

You are thorough but not pedantic. Focus on significant issues.`,
    regras: {
      allowedTaskTypes: ['review', 'audit', 'analysis'],
      forbiddenActions: ['approve without review', 'merge without approval'],
      autoComplete: true,
    },
    limitadores: {
      maxTokensPerTask: 30000,
      maxDurationMinutes: 30,
    },
  },

  tester: {
    tipo: 'tester',
    soul: `You are a QA/testing AI agent. Your role is to:
- Write comprehensive test cases
- Execute tests and report results
- Identify edge cases and failure scenarios
- Verify bug fixes and new features
- Document test coverage and gaps

You are methodical and thorough in your testing approach.`,
    regras: {
      allowedTaskTypes: ['testing', 'qa', 'validation'],
      mustAskBefore: ['skip tests', 'mark as pass without testing'],
    },
    limitadores: {
      maxDurationMinutes: 45,
      maxRetries: 2,
    },
  },

  writer: {
    tipo: 'writer',
    soul: `You are a technical writer AI agent. Your role is to:
- Write clear and comprehensive documentation
- Create user guides and API documentation
- Maintain README files and wikis
- Write helpful code comments
- Translate technical concepts for different audiences

You write clearly, concisely, and accurately.`,
    regras: {
      allowedTaskTypes: ['documentation', 'writing', 'translation'],
      autoComplete: true,
    },
    limitadores: {
      maxTokensPerTask: 20000,
      maxDurationMinutes: 30,
    },
  },

  planner: {
    tipo: 'planner',
    soul: `You are a project planning AI agent. Your role is to:
- Break down large tasks into smaller, actionable items
- Estimate effort and complexity
- Identify dependencies and blockers
- Prioritize tasks effectively
- Create project roadmaps and timelines

You think strategically and communicate plans clearly.`,
    regras: {
      allowedTaskTypes: ['planning', 'estimation', 'breakdown'],
      mustAskBefore: ['commit to deadlines', 'change scope'],
    },
    limitadores: {
      maxDurationMinutes: 30,
    },
  },

  assistant: {
    tipo: 'assistant',
    soul: `You are a helpful general-purpose AI assistant. Your role is to:
- Answer questions and provide information
- Help with various tasks as needed
- Coordinate with other agents when necessary
- Escalate issues that require human attention

You are friendly, helpful, and proactive.`,
    regras: {
      autoComplete: true,
    },
    limitadores: {
      maxTokensPerTask: 10000,
      maxDurationMinutes: 15,
    },
  },
};

/**
 * Default block triggers for common scenarios
 */
export const DEFAULT_BLOCK_TRIGGERS: BlockTrigger[] = [
  {
    condition: 'uncertainty > 0.8',
    message: 'High uncertainty - need clarification before proceeding',
    requiresApproval: true,
  },
  {
    condition: 'requires_external_access',
    message: 'This task requires access to external systems',
    requiresApproval: true,
  },
  {
    condition: 'destructive_operation',
    message: 'This operation could cause data loss',
    requiresApproval: true,
    notifyChannel: 'notifications',
  },
  {
    condition: 'cost_exceeds_limit',
    message: 'Estimated cost exceeds configured limit',
    requiresApproval: true,
  },
];

/**
 * Persona Manager
 * Handles agent persona creation, validation, and application
 */
export class PersonaManager {
  private personas: Map<string, Agente> = new Map();

  /**
   * Register an agent's persona
   */
  register(agente: Agente): void {
    this.personas.set(agente.id, agente);
    console.log(`[Persona] Registered persona for agent ${agente.nome} (${agente.id})`);
  }

  /**
   * Get an agent's persona
   */
  get(agentId: string): Agente | undefined {
    return this.personas.get(agentId);
  }

  /**
   * Remove an agent's persona
   */
  unregister(agentId: string): boolean {
    const removed = this.personas.delete(agentId);
    if (removed) {
      console.log(`[Persona] Unregistered persona for agent ${agentId}`);
    }
    return removed;
  }

  /**
   * Get all registered personas
   */
  getAll(): Agente[] {
    return Array.from(this.personas.values());
  }

  /**
   * Create a new agent with default persona based on type
   */
  createFromTemplate(
    name: string,
    type: keyof typeof DEFAULT_PERSONAS,
    squadId: string,
    overrides?: Partial<Agente>
  ): Omit<Agente, 'id' | 'created_at' | 'updated_at'> {
    const template = DEFAULT_PERSONAS[type] || DEFAULT_PERSONAS.assistant;

    return {
      squad_id: squadId,
      nome: name,
      tipo: template.tipo || type,
      soul: template.soul || '',
      regras: { ...template.regras, ...overrides?.regras },
      limitadores: { ...template.limitadores, ...overrides?.limitadores },
      gatilhos_bloqueio: overrides?.gatilhos_bloqueio || DEFAULT_BLOCK_TRIGGERS,
      ativo: overrides?.ativo ?? true,
    };
  }

  /**
   * Build a system prompt for an agent based on their persona
   */
  buildSystemPrompt(agente: Agente, context?: { taskTitle?: string; taskDescription?: string }): string {
    const parts: string[] = [];

    // Base soul/personality
    if (agente.soul) {
      parts.push(agente.soul);
    }

    // Add rules section
    if (agente.regras) {
      parts.push('\n## Rules and Guidelines');

      if (agente.regras.allowedTaskTypes?.length) {
        parts.push(`- You are specialized in: ${agente.regras.allowedTaskTypes.join(', ')}`);
      }

      if (agente.regras.forbiddenActions?.length) {
        parts.push(`- You must NEVER: ${agente.regras.forbiddenActions.join(', ')}`);
      }

      if (agente.regras.mustAskBefore?.length) {
        parts.push(`- You must ASK FOR APPROVAL before: ${agente.regras.mustAskBefore.join(', ')}`);
      }

      if (agente.regras.autoComplete) {
        parts.push('- You should complete tasks autonomously when possible');
      } else {
        parts.push('- You should ask for confirmation before completing tasks');
      }
    }

    // Add limiters section
    if (agente.limitadores) {
      parts.push('\n## Constraints');

      if (agente.limitadores.maxDurationMinutes) {
        parts.push(`- Maximum task duration: ${agente.limitadores.maxDurationMinutes} minutes`);
      }

      if (agente.limitadores.maxRetries) {
        parts.push(`- Maximum retry attempts: ${agente.limitadores.maxRetries}`);
      }
    }

    // Add block triggers section
    if (agente.gatilhos_bloqueio?.length) {
      parts.push('\n## When to Stop and Ask');
      for (const trigger of agente.gatilhos_bloqueio) {
        parts.push(`- ${trigger.message}`);
      }
    }

    // Add task context if provided
    if (context?.taskTitle || context?.taskDescription) {
      parts.push('\n## Current Task');
      if (context.taskTitle) {
        parts.push(`**Title:** ${context.taskTitle}`);
      }
      if (context.taskDescription) {
        parts.push(`**Description:** ${context.taskDescription}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Validate that an agent can handle a specific task type
   */
  canHandleTaskType(agente: Agente, taskType?: string): boolean {
    if (!taskType) return true;
    if (!agente.regras?.allowedTaskTypes?.length) return true;

    return agente.regras.allowedTaskTypes.includes(taskType);
  }

  /**
   * Check if an action requires approval
   */
  requiresApproval(agente: Agente, action: string): boolean {
    if (!agente.regras?.mustAskBefore?.length) return false;

    const actionLower = action.toLowerCase();
    return agente.regras.mustAskBefore.some(
      (a) => actionLower.includes(a.toLowerCase())
    );
  }

  /**
   * Check if an action is forbidden
   */
  isForbidden(agente: Agente, action: string): boolean {
    if (!agente.regras?.forbiddenActions?.length) return false;

    const actionLower = action.toLowerCase();
    return agente.regras.forbiddenActions.some(
      (a) => actionLower.includes(a.toLowerCase())
    );
  }

  /**
   * Check block triggers and return the first matching one
   */
  checkBlockTriggers(
    agente: Agente,
    context: { uncertainty?: number; requiresExternalAccess?: boolean; isDestructive?: boolean; estimatedCost?: number; costLimit?: number }
  ): BlockTrigger | null {
    if (!agente.gatilhos_bloqueio?.length) return null;

    for (const trigger of agente.gatilhos_bloqueio) {
      const condition = trigger.condition.toLowerCase();

      if (condition.includes('uncertainty') && context.uncertainty !== undefined) {
        const threshold = parseFloat(condition.match(/[\d.]+/)?.[0] || '0.8');
        if (context.uncertainty > threshold) return trigger;
      }

      if (condition.includes('external_access') && context.requiresExternalAccess) {
        return trigger;
      }

      if (condition.includes('destructive') && context.isDestructive) {
        return trigger;
      }

      if (condition.includes('cost') && context.estimatedCost !== undefined && context.costLimit !== undefined) {
        if (context.estimatedCost > context.costLimit) return trigger;
      }
    }

    return null;
  }

  /**
   * Merge persona updates while preserving unspecified fields
   */
  mergePersona(
    base: Agente,
    updates: Partial<Agente>
  ): Agente {
    return {
      ...base,
      ...updates,
      regras: updates.regras
        ? { ...base.regras, ...updates.regras }
        : base.regras,
      limitadores: updates.limitadores
        ? { ...base.limitadores, ...updates.limitadores }
        : base.limitadores,
      gatilhos_bloqueio: updates.gatilhos_bloqueio || base.gatilhos_bloqueio,
    };
  }

  /**
   * Get statistics about registered personas
   */
  getStats(): {
    total: number;
    active: number;
    byType: Record<string, number>;
  } {
    const personas = this.getAll();
    const byType: Record<string, number> = {};

    let active = 0;
    for (const persona of personas) {
      if (persona.ativo) active++;
      const tipo = persona.tipo || 'unknown';
      byType[tipo] = (byType[tipo] || 0) + 1;
    }

    return {
      total: personas.length,
      active,
      byType,
    };
  }
}
