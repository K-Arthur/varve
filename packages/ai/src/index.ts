/** @varve/ai — AI assistant chat controller. */

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

import { dispatchIntelligence, type IntelligenceDispatchContext } from './intelligenceRegistry';

const MOCK_RESPONSES = {
  default:
    "I'm the Varve AI assistant. I can help you with design suggestions, generate shapes, or automate repetitive tasks.",
  help: 'Here are some things I can do:\n- Suggest color palettes\n- Generate layout ideas\n- Optimize your design for accessibility\n- Automate repetitive tasks\n\nTry asking me to "make this pop" or "suggest a better layout."',
};

export async function chat(
  _sessionId: string,
  message: string,
  ctx?: IntelligenceDispatchContext,
): Promise<import('./types').AIMessage> {
  const dispatched = ctx ? dispatchIntelligence(message, ctx) : null;

  let reply: string;
  if (dispatched) {
    reply = dispatched.summary;
  } else {
    const lower = message.toLowerCase();
    reply = MOCK_RESPONSES.default;
    if (lower.includes('help') || lower.includes('what')) {
      reply = MOCK_RESPONSES.help;
    } else if (lower.includes('hello') || lower.includes('hi')) {
      reply = 'Hello! How can I help with your design today?';
    }
  }

  await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));

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
