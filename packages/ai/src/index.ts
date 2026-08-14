/** @varve/ai — on-device design assistants (chat surface) + Design Edit Plan contract. */

export {
  checkDesignPlanFreshness,
  type DesignEditOperation,
  type DesignEditPlan,
  type DesignEditSnapshot,
  type DesignInputKind,
  type DesignPlanFreshness,
  type DesignPlanMode,
  type DesignPlanScope,
  type DesignPlanSource,
  type DesignPlanValidation,
  type JsonValue,
  validateDesignEditPlan,
} from './designEditPlan';
export {
  dispatchIntelligence,
  INTELLIGENCE_COMMANDS,
  type IntelligenceCommandMeta,
  type IntelligenceDispatchContext,
  type IntelligenceDispatchHandlers,
  type IntelligenceDispatchResult,
  matchIntelligenceCommand,
} from './intelligenceRegistry';
export type { AIMessage, AIModel, AISession } from './types';
export const PACKAGE = '@varve/ai' as const;

import {
  dispatchIntelligence,
  INTELLIGENCE_COMMANDS,
  type IntelligenceDispatchContext,
} from './intelligenceRegistry';

/**
 * The honest fallback reply for intents no on-device command understands.
 *
 * Varve is offline-first: there is no cloud model behind this surface, and
 * pretending otherwise (canned personality replies, simulated latency)
 * misrepresents what runs. Unknown intents list the commands that actually
 * exist so the user can rephrase.
 */
function fallbackReply(hasContext: boolean): string {
  const commands = INTELLIGENCE_COMMANDS.map((c) => `- ${c.label}`).join('\n');
  if (!hasContext) {
    return `I'm the on-device design assistant — everything runs locally with no connection. I can help with:\n${commands}\n\nOpen me from the editor to run them against your document.`;
  }
  return `I'm Varve's on-device design assistant — everything runs locally. I can help with:\n${commands}\n\nTry one of those, or rephrase what you want.`;
}

export async function chat(
  _sessionId: string,
  message: string,
  ctx?: IntelligenceDispatchContext,
): Promise<import('./types').AIMessage> {
  const dispatched = ctx ? dispatchIntelligence(message, ctx) : null;
  const reply = dispatched ? dispatched.summary : fallbackReply(Boolean(ctx));

  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: reply,
    timestamp: Date.now(),
  };
}

export interface AIAssistant {
  session: import('./types').AISession;
  sendMessage(
    content: string,
    ctx?: IntelligenceDispatchContext,
  ): Promise<import('./types').AIMessage>;
  clear(): void;
}

export function createAssistant(sessionId?: string): AIAssistant {
  const session: import('./types').AISession = {
    id: sessionId ?? crypto.randomUUID(),
    messages: [],
    createdAt: Date.now(),
  };

  return {
    session,
    async sendMessage(content: string, ctx?: IntelligenceDispatchContext) {
      const userMsg: import('./types').AIMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      session.messages.push(userMsg);
      const reply = await chat(session.id, content, ctx);
      session.messages.push(reply);
      return reply;
    },
    clear() {
      session.messages = [];
    },
  };
}
