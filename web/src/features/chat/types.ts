import type { ReplyQuote } from '../../api/types';

export type ToolItem = {
  id: string;
  title: string;
  kind: string;
  status: 'done' | 'running' | 'failed';
  output?: string;
  stderr?: string;
  cwdWarning?: string;
  outputLines?: string[];
  exitCode?: number;
  timeDisplay?: string;
  elapsedMs?: number;
};

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls: ToolItem[];
  quote?: ReplyQuote;
}

export interface StreamState {
  isStreaming: boolean;
  messages: Message[];
  activeTools: Map<string, ToolItem>;
  error: string | null;
}
