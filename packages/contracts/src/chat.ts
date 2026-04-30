export type ReplyQuote = {
  text: string
  sourceMessageId?: string
  sourceRole?: 'user' | 'assistant'
}

export type ChatStreamRequest = {
  message?: string
  quote?: ReplyQuote
  sessionId?: string
}

export type ChatControlRequest = {
  sessionId: string
  request_id: string
  approved: boolean
  updatedInput?: Record<string, unknown>
  message?: string
}

export interface UsageStats {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  content?: unknown
  tool_use_id?: string
  is_error?: boolean
  summary?: string
  title?: string
  url?: string
  mimeType?: string
  sourceType?: string
}

export type ServerEvent =
  | { type: 'session_created'; data: { sessionId: string; cwd: string; createdAt: string } }
  | { type: 'session_ended'; data: { sessionId: string; reason: 'completed' | 'killed' | 'error' } }
  | { type: 'message_start'; data: { id: string } }
  | { type: 'content_delta'; data: { delta: { type: 'text_delta'; text: string } } }
  | {
      type: 'thinking_delta'
      data: { delta: { type: 'thinking_delta'; thinking: string } }
    }
  | { type: 'content_block'; data: { block: ContentBlock } }
  | { type: 'message_end'; data: { id: string; usage: UsageStats } }
  | { type: 'tool_start'; data: { id: string; name: string; input: Record<string, unknown> } }
  | { type: 'tool_input_delta'; data: { id: string; partialJson: string } }
  | {
      type: 'tool_output_delta'
      data: {
        id?: string
        toolCallId?: string
        stream?: 'stdout' | 'stderr'
        chunk: string
        outputLine?: string
      }
    }
  | { type: 'tool_end'; data: { id: string } }
  | {
      type: 'tool_result'
      data: {
        id?: string
        toolCallId?: string
        content?: string
        result?: string
        isError?: boolean
        exitCode?: number
        timeDisplay?: string
      }
    }
  | { type: 'mcp_call'; data: { tool: string; args: Record<string, unknown> } }
  | { type: 'mcp_result'; data: { tool: string; result: Record<string, unknown> } }
  | { type: 'permission_request'; data: { request_id: string; request: unknown } }
  | { type: 'control_response'; data: { request_id: string; approved: boolean } }
  | { type: 'error'; data: { code: string; message: string } }
