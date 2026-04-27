// API types for Ultraplan backend
import type {
  ChatStreamRequest,
  ChatControlRequest,
  CommandSuggestion,
  CommandSuggestionsResponse,
  ComposerSuggestionType,
  ExecuteCommandRequest,
  ExecuteCommandResponse,
  FileSuggestion,
  FileSuggestionsResponse,
  ReplyQuote,
  ServerEvent,
  Session,
  SessionMessage,
} from '../../../packages/contracts/src/index.ts';

export interface AuthInitResponse {
  tempToken: string;
  expiresAt: string;
}

export interface AuthVerifyResponse {
  apiKey: string;
  expiresAt: string;
}

export interface AuthValidateResponse {
  valid: boolean;
}

export type { ServerEvent };

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
}

export interface ToolsResponse {
  tools: ToolDefinition[];
}

export interface SessionsResponse {
  sessions: Session[]
  hasMore: boolean
}

export interface StateResponse {
  permissionMode: string;
  approvedTools: string[];
  pendingTools: unknown[];
  model: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
  };
  cwd: string;
  gitBranch?: string | null;
  connected: boolean;
}

export type ChatRequest = ChatStreamRequest;

export type {
  ChatStreamRequest,
  ChatControlRequest,
  ComposerSuggestionType,
  FileSuggestion,
  CommandSuggestion,
  FileSuggestionsResponse,
  CommandSuggestionsResponse,
  ExecuteCommandRequest,
  ExecuteCommandResponse,
  ReplyQuote,
  Session,
  SessionMessage,
};

export interface ApiError {
  success: false;
  error: string;
  message?: string;
  auth_domain?: 'web_api' | 'bridge_oauth' | 'session_ingress';
}
