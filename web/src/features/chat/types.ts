import type { ReplyQuote } from '../../api/types';

export type AskUserQuestionOption = {
  label: string;
  description?: string;
  preview?: string;
};

export type AskUserQuestion = {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: AskUserQuestionOption[];
};

export type ToolItem = {
  id: string;
  title: string;
  kind: string;
  status: 'done' | 'running' | 'failed';
  input?: Record<string, unknown>;
  output?: string;
  stderr?: string;
  cwdWarning?: string;
  outputLines?: string[];
  exitCode?: number;
  timeDisplay?: string;
  elapsedMs?: number;
  liveOutput?: string;
  liveErrorOutput?: string;
};

export type TranscriptArtifact = {
  id: string;
  type: string;
  label: string;
  detail?: string;
  url?: string;
  // Image-specific fields
  mimeType?: string;
  data?: string; // base64 encoded image data
};

export type PendingPermission = {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  description?: string;
  subtype?: string;
  alwaysAllow?: boolean;
};

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  toolCalls: ToolItem[];
  artifacts?: TranscriptArtifact[];
  quote?: ReplyQuote;
  streamingEndedAt?: number;
}

export interface StreamState {
  sessionId: string | null;
  isStreaming: boolean;
  messages: Message[];
  activeTools: Map<string, ToolItem>;
  pendingPermissions: PendingPermission[];
  error: string | null;
  pendingRouteSync: boolean;
  connectionState: 'connected' | 'reconnecting' | 'restarted' | 'interrupted' | 'failed';
}
