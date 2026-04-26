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

export type StreamToolUseEvent = {
  type: 'tool_use'
  data: { id: string; name: string; input: Record<string, unknown> }
}

export type StreamToolProgressEvent = {
  type: 'tool_progress'
  data: { toolCallId: string; output?: string; elapsedMs?: number }
}

export type StreamToolResultEvent = {
  type: 'tool_result'
  data: { toolCallId: string; result: string; exitCode?: number; timeDisplay?: string }
}

export type ServerEvent =
  | { type: 'message_start'; data: { id: string } }
  | { type: 'content_delta'; data: { delta: { type: 'text_delta'; text: string } } }
  | { type: 'content_block_stop'; data: unknown }
  | { type: 'message_end'; data: unknown }
  | StreamToolUseEvent
  | StreamToolProgressEvent
  | StreamToolResultEvent
  | { type: 'error'; data: { message: string } }
