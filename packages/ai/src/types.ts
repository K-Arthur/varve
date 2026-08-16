/** @varve/ai — types for AI assistant chat. */

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface AISession {
  id: string;
  messages: AIMessage[];
  createdAt: number;
}

export type AIModel = 'varve-default' | 'claude-3-sonnet' | 'gpt-4o';
