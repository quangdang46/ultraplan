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
import { switchSession } from 'src/bootstrap/state'
import type { ReplyQuote, ServerEvent } from '../../contracts/src/index'
import type { SessionId } from 'src/types/ids'
import type { Tools } from 'src/Tool'
import type { Command } from 'src/commands'
import { mapQueryEventToServerEvents } from './features/chat/streamMapper'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => any
let runtimeInitPromise: Promise<void> | null = null

async function ensureRuntimeInit(): Promise<void> {
  if (!runtimeInitPromise) {
    runtimeInitPromise = init()
  }
  await runtimeInitPromise
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
  quote?: ReplyQuote
  sessionId?: string
  onEvent: (event: ServerEvent) => void
  signal?: AbortSignal
}

function composeUserMessage(message: string, quote?: ReplyQuote): string {
  if (!quote?.text) return message
  const quotedLines = quote.text.split('\n').map((line) => `> ${line}`).join('\n')
  const userRequest = message.trim() || 'Please reply to the quoted context.'
  return `Quoted context:\n${quotedLines}\n\nUser request:\n${userRequest}`
}

export async function streamQuery(options: StreamingOptions): Promise<void> {
  const { message, quote, sessionId, onEvent, signal } = options
  const abortController = createAbortController()

  if (signal) {
    signal.addEventListener('abort', () => abortController.abort())
  }

  try {
    await ensureRuntimeInit()

    if (sessionId && sessionId.trim()) {
      switchSession(sessionId as SessionId, null)
    }

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

    let emittedMessageEnd = false
    const composedMessage = composeUserMessage(message, quote)
    for await (const event of engine.submitMessage(composedMessage)) {
      const mappedEvents = mapQueryEventToServerEvents(event)
      for (const mappedEvent of mappedEvents) {
        if (mappedEvent.type === 'message_end') {
          if (emittedMessageEnd) continue
          emittedMessageEnd = true
        }
        onEvent(mappedEvent)
      }
    }

    if (!emittedMessageEnd) {
      onEvent({ type: 'message_end', data: {} })
    }
  } catch (error) {
    onEvent({ type: 'error', data: { message: (error as Error).message } })
  }
}
