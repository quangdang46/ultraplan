// src/server/eventProtocol.ts
// Event types for server <-> client communication
//
// Canonical Event Model: see docs/features/event-model.md (bd-3fg.3.1.2)
// - CanonicalEvent envelope with id, sessionId, seqNum, type, direction, timestamp, payload, turnId, turnPhase
// - afterSeq replay cursor semantics (query param, legacy alias, Last-Event-ID header)
// - Deduplication via deliveredSeqNums Set
// - Turn lifecycle state machine (pending_input → processing → awaiting_permission/output → complete/interrupted)
// NOTE: This file defines CC CLI IPC event types. The RCS SSE implementation is in
// packages/remote-control-server/src/transport/sse-writer.ts and packages/remote-control-server/src/types/messages.ts
// which align with the canonical model.

import type { ReplyQuote as ContractReplyQuote } from '../../packages/contracts/src/chat.js'

export type ServerEvent =
  | { type: 'session_created'; data: { sessionId: string; cwd: string; createdAt: string } }
  | { type: 'session_ended'; data: { sessionId: string; reason: 'completed' | 'killed' | 'error' } }
  | { type: 'message_start'; data: { id: string } }
  | { type: 'message_end'; data: { id: string; usage: UsageStats } }
  | { type: 'content_delta'; data: { delta: { type: 'text_delta'; text: string } } }
  | {
      type: 'thinking_delta'
      data: { delta: { type: 'thinking_delta'; thinking: string } }
    }
  | { type: 'content_block'; data: { block: ContentBlock } }
  | { type: 'tool_start'; data: { id: string; name: string; input: Record<string, unknown> } }
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
  | { type: 'error'; data: { code: string; message: string } }
  | { type: 'permission_request'; data: { request_id: string; request: unknown } }
  | { type: 'control_response'; data: { request_id: string; approved: boolean } }

export interface UsageStats {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface ContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result'
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  content?: string
}

export type ClientMessage =
  | { type: 'user_message'; message: string; quote?: ReplyQuote }
  | { type: 'control_response'; request_id: string; approved: boolean }

export type ReplyQuote = ContractReplyQuote
