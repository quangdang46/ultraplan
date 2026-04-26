// Backend query service - integrates with CLI's QueryEngine
import { randomUUID } from 'crypto'
import { QueryEngine } from 'src/QueryEngine'
import { init } from 'src/entrypoints/init'
import { createAbortController } from 'src/utils/abortController'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache'
import { getCwd } from 'src/utils/cwd'
import { getTools } from 'src/tools'
import { getEmptyToolPermissionContext } from 'src/Tool'
import { getCommands } from 'src/commands'
import { getDefaultAppState } from 'src/state/AppStateStore'
import type { Tools } from 'src/Tool'
import type { Command } from 'src/commands'

export type ServerEvent =
  | { type: 'message_start'; data: { id: string } }
  | { type: 'content_delta'; data: { delta: { type: 'text_delta'; text: string } } }
  | { type: 'content_block_stop'; data: unknown }
  | { type: 'message_end'; data: unknown }
  | { type: 'tool_use'; data: { id: string; name: string; input: Record<string, unknown> } }
  | { type: 'tool_progress'; data: { toolCallId: string; output?: string; elapsedMs?: number } }
  | { type: 'tool_result'; data: { toolCallId: string; result: string; exitCode?: number; timeDisplay?: string } }
  | { type: 'error'; data: { message: string } }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => any
let runtimeInitPromise: Promise<void> | null = null

async function ensureRuntimeInit(): Promise<void> {
  if (!runtimeInitPromise) {
    runtimeInitPromise = init()
  }
  await runtimeInitPromise
}

function extractToolResultText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (!raw) return ''

  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item
        if (
          item &&
          typeof item === 'object' &&
          'text' in item &&
          typeof (item as { text?: unknown }).text === 'string'
        ) {
          return (item as { text: string }).text
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  if (typeof raw === 'object') {
    const maybe = raw as { text?: unknown; content?: unknown }
    if (typeof maybe.text === 'string') return maybe.text
    if (maybe.content !== undefined) return extractToolResultText(maybe.content)
  }

  return String(raw)
}

// Wrap canUseTool to always allow (permissions handled by CLI)
async function defaultCanUseTool(): Promise<{ behavior: 'allow' }> {
  return { behavior: 'allow' }
}

// Get minimal tools list
async function getMinimalTools(): Promise<Tools> {
  try {
    const ctx = getEmptyToolPermissionContext()
    return getTools(ctx)
  } catch {
    return [] as unknown as Tools
  }
}

// Get minimal commands list
async function getMinimalCommands(): Promise<Command[]> {
  try {
    return getCommands(getCwd())
  } catch {
    return [] as Command[]
  }
}

export interface StreamingOptions {
  message: string
  onEvent: (event: ServerEvent) => void
  signal?: AbortSignal
}

export async function streamQuery(options: StreamingOptions): Promise<void> {
  const { message, onEvent, signal } = options
  const abortController = createAbortController()

  if (signal) {
    signal.addEventListener('abort', () => abortController.abort())
  }

  try {
    await ensureRuntimeInit()

    // Get tools and commands
    const [tools, commands] = await Promise.all([
      getMinimalTools(),
      getMinimalCommands(),
    ])

    // Initialize QueryEngine with proper AppState
    const engine = new QueryEngine({
      cwd: getCwd(),
      tools,
      commands,
      mcpClients: [],
      agents: [],
      canUseTool: defaultCanUseTool as unknown as AnyFunction,
      getAppState: () => getDefaultAppState(),
      setAppState: () => {},
      readFileCache: createFileStateCacheWithSizeLimit(1000),
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      abortController,
    })

    // Stream response
    const messageId = `msg_${Date.now()}`
    onEvent({ type: 'message_start', data: { id: messageId } })

    for await (const event of engine.submitMessage(message)) {
      const e = event as Record<string, unknown>

      // Handle assistant messages with content
      if (e.type === 'assistant') {
        const assistant = e as { message?: { content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; content?: Array<{ type: string; text?: string; source?: string; tool_use_id?: string }> }> } }
        if (assistant.message?.content) {
          for (const block of assistant.message.content) {
            if (block.type === 'text' && block.text) {
              onEvent({
                type: 'content_delta',
                data: { delta: { type: 'text_delta', text: block.text } },
              })
            }
            // Handle tool_use blocks
            if (block.type === 'tool_use') {
              const toolUse = block as unknown as { id: string; name: string; input: Record<string, unknown> }
              onEvent({
                type: 'tool_use',
                data: { id: toolUse.id, name: toolUse.name, input: toolUse.input },
              })
            }
            // Handle tool_result blocks embedded in assistant message content
            if (block.type === 'tool_result') {
              const toolResult = block as unknown as { tool_use_id?: string; content?: unknown; text?: unknown }
              const text = extractToolResultText(toolResult.content ?? toolResult.text)
              onEvent({
                type: 'tool_result',
                data: {
                  toolCallId: toolResult.tool_use_id ?? '',
                  result: text,
                  exitCode: 0,
                  timeDisplay: '',
                },
              })
            }
          }
        }
      }

      // Handle user messages containing tool_result content (from getCompletedResults)
      if (e.type === 'user') {
        const userMsg = e as { message?: { content?: Array<{ type: string; text?: string; source?: string; tool_use_id?: string; content?: Array<{ type: string; text?: string }> }> } }
        if (userMsg.message?.content) {
          for (const block of userMsg.message.content) {
            if (block.type === 'tool_result') {
              const text = extractToolResultText(
                (block as { content?: unknown; text?: unknown }).content ??
                  (block as { content?: unknown; text?: unknown }).text,
              )
              const toolCallId = block.tool_use_id || ''
              onEvent({
                type: 'tool_result',
                data: {
                  toolCallId,
                  result: text,
                  exitCode: 0,
                  timeDisplay: '',
                },
              })
            }
          }
        }
      }

      // Handle stream_done event (end of response stream)
      if (e.type === 'stream_done') {
        onEvent({ type: 'message_end', data: {} })
      }
    }

    onEvent({ type: 'message_end', data: {} })
  } catch (error) {
    onEvent({ type: 'error', data: { message: (error as Error).message } })
  }
}
