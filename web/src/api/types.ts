// API types for Ultraplan backend

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

export type ServerEvent =
  | { type: 'message_start'; data: { id: string } }
  | { type: 'content_delta'; data: { delta: { type: 'text_delta'; text: string } } }
  | { type: 'content_block_stop'; data: unknown }
  | { type: 'message_end'; data: unknown }
  | { type: 'tool_use'; data: { id: string; name: string; input: Record<string, unknown> } }
  | { type: 'tool_progress'; data: { toolCallId: string; output?: string; elapsedMs?: number } }
  | { type: 'tool_result'; data: { toolCallId: string; result: string; exitCode?: number; timeDisplay?: string } }
  | { type: 'error'; data: { message: string } };

export interface ToolDefinition {
  name: string;
  description: string;
  category: string;
}

export interface ToolsResponse {
  tools: ToolDefinition[];
}

export interface SessionsResponse {
  sessions: unknown[];
  hasMore: boolean;
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
  connected: boolean;
}

export interface ChatRequest {
  message: string;
}

export interface ApiError {
  success: false;
  error: string;
  message?: string;
}
