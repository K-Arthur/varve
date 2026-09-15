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

/** Execution mode: on-device local models vs remote inference. */
export type AIExecutionMode = 'local' | 'cloud' | 'hybrid' | 'disabled';

/** Model loading/runtime lifecycle state. */
export type AIModelLoadState = 'unloaded' | 'loading' | 'ready' | 'error';

/** Current AI pipeline task status. */
export interface AITaskStatus {
  task: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  progress?: number;
  executionMode: AIExecutionMode;
  modelLoadState: AIModelLoadState;
}
