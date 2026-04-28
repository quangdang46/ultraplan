// src/server/sessionManager.ts
// Session manager with logical-session ownership plus process-per-session runtime

import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { createInterface } from 'readline'
import type {
  Session,
  SessionMessage,
} from '../../packages/contracts/src/index.js'
import type { SessionActivity } from '../bridge/types.js'
import { jsonParse } from '../utils/slowOperations.js'
import { listSessionsImpl, type SessionInfo } from '../utils/listSessionsImpl.js'
import {
  loadTranscriptMessages,
} from './sessionPersistence.js'
import { mergeSessionMessages } from './sessionMessageMerge.js'
import { spawnSessionProcess } from './processStarter.js'
import {
  registerSession,
  unregisterSession,
  listLiveSessions,
} from './sessionRegistry.js'
import type { SessionHandle, SessionDoneStatus } from './types.js'

class SafeEventEmitter extends EventEmitter {
  setMaxListeners(n: number): this {
    return super.setMaxListeners(n)
  }
}

type SessionRecord = {
  session: Session
  messages: SessionMessage[]
  messagesLoaded: boolean
  assistantDraft?: SessionMessage
}

const READY_TIMEOUT_MS = 250
const STDERR_LINE_LIMIT = 50

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defaultTitle(sessionId: string): string {
  return sessionId.slice(0, 8)
}

function toIsoFromEpochMs(value?: number): string | undefined {
  if (!value || Number.isNaN(value)) return undefined
  return new Date(value).toISOString()
}

function laterIso(a?: string, b?: string): string | undefined {
  if (!a) return b
  if (!b) return a
  return a >= b ? a : b
}

function formatFailureMessage(
  status: SessionDoneStatus,
  stderrLines: string[],
  code: number | null,
  signal: NodeJS.Signals | null,
): string {
  const stderr = stderrLines.join('\n').trim()
  if (stderr) {
    return stderr
  }

  if (signal) {
    return `Claude CLI subprocess exited with signal ${signal}`
  }

  if (status === 'completed') {
    return 'Claude CLI subprocess exited before producing a result'
  }

  return `Claude CLI subprocess exited with code ${code ?? 'unknown'}`
}

async function findSessionInfo(
  sessionId: string,
): Promise<SessionInfo | undefined> {
  const sessionInfos = await listSessionsImpl().catch(() => [] as SessionInfo[])
  return sessionInfos.find((info) => info.sessionId === sessionId)
}

function sessionInfoToSession(info: SessionInfo): Session {
  const createdAt =
    toIsoFromEpochMs(info.createdAt) ??
    new Date(info.lastModified).toISOString()

  return {
    id: info.sessionId,
    title: info.customTitle || info.summary || defaultTitle(info.sessionId),
    description: info.cwd || '',
    status: 'archived',
    cwd: info.cwd,
    branch: info.gitBranch,
    tag: info.tag,
    lastMessageAt: new Date(info.lastModified).toISOString(),
    createdAt,
  }
}

class SessionHandleImpl implements SessionHandle {
  sessionId: string
  pid: number
  cwd: string
  startedAt: number
  child: ChildProcess
  done: Promise<SessionDoneStatus>

  private eventEmitter = new SafeEventEmitter()
  private messageChain: Promise<void> = Promise.resolve()
  private stdoutWatcher: ReturnType<typeof createInterface> | null = null
  private stderrWatcher: ReturnType<typeof createInterface> | null = null
  private readonly stderrLines: string[] = []

  constructor(sessionId: string, child: ChildProcess, cwd: string) {
    this.sessionId = sessionId
    this.child = child
    this.cwd = cwd
    this.pid = child.pid ?? 0
    this.startedAt = Date.now()

    this.done = new Promise((resolve) => {
      child.on('close', (code, signal) => {
        const status =
          signal === 'SIGTERM' || signal === 'SIGINT'
            ? 'interrupted'
            : code === 0
              ? 'completed'
              : 'failed'

        if (status !== 'completed') {
          this.eventEmitter.emit('event', {
            type: 'error',
            code: 'SUBPROCESS_EXIT',
            message: formatFailureMessage(status, this.stderrLines, code, signal),
          })
        }

        resolve(status)
      })
      child.on('error', (error) => {
        this.captureStderrLine((error as Error).message)
        this.eventEmitter.emit('event', {
          type: 'error',
          code: 'SUBPROCESS_SPAWN_ERROR',
          message: (error as Error).message,
        })
        resolve('failed')
      })
    })

    this.watchStdout()
    this.watchStderr()
  }

  private watchStdout(): void {
    if (!this.child.stdout || this.stdoutWatcher) return

    const rl = createInterface({ input: this.child.stdout })
    this.stdoutWatcher = rl

    rl.on('line', (line) => {
      try {
        const parsed = jsonParse(line)
        if (parsed && typeof parsed === 'object') {
          this.eventEmitter.emit('event', parsed)
          if ((parsed as Record<string, unknown>).type === 'result') {
            this.eventEmitter.emit('result')
          }
        }
      } catch {
        // skip non-JSON lines
      }
    })

    rl.on('close', () => {
      this.stdoutWatcher = null
    })
  }

  private watchStderr(): void {
    if (!this.child.stderr || this.stderrWatcher) return

    const rl = createInterface({ input: this.child.stderr })
    this.stderrWatcher = rl

    rl.on('line', (line) => {
      this.captureStderrLine(line)
    })

    rl.on('close', () => {
      this.stderrWatcher = null
    })
  }

  private captureStderrLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return

    this.stderrLines.push(trimmed)
    if (this.stderrLines.length > STDERR_LINE_LIMIT) {
      this.stderrLines.shift()
    }
  }

  subscribeEvents(cb: (event: unknown) => void): () => void {
    this.eventEmitter.on('event', cb)
    return () => this.eventEmitter.off('event', cb)
  }

  private waitForResult(): Promise<void> {
    return new Promise((resolve) => {
      this.eventEmitter.once('result', resolve)
    })
  }

  async waitForReady(timeoutMs = READY_TIMEOUT_MS): Promise<void> {
    await Promise.race([
      sleep(timeoutMs),
      this.done.then((status) => {
        throw new Error(
          formatFailureMessage(status, this.stderrLines, this.child.exitCode, null),
        )
      }),
    ])
  }

  async enqueueMessage(data: string): Promise<void> {
    const previous = this.messageChain
    const run = previous.then(async () => {
      if (this.child.killed || this.child.exitCode !== null) {
        throw new Error(
          formatFailureMessage('failed', this.stderrLines, this.child.exitCode, null),
        )
      }

      const waitForResult = this.waitForResult()
      this.writeStdin(data)
      const outcome = await Promise.race([
        waitForResult.then(() => 'result' as const),
        this.done,
      ])
      if (outcome !== 'result') {
        throw new Error(
          formatFailureMessage(
            outcome,
            this.stderrLines,
            this.child.exitCode,
            this.child.signalCode,
          ),
        )
      }
    })

    this.messageChain = run.catch(() => undefined)
    await run
  }

  kill(): void {
    if (!this.child.killed) this.child.kill('SIGTERM')
  }

  forceKill(): void {
    if (this.child.pid) process.kill(this.child.pid, 'SIGKILL')
  }

  writeStdin(data: string): void {
    if (this.child.stdin && !this.child.stdin.destroyed) {
      this.child.stdin.write(data + '\n')
    }
  }

  getActivity(): SessionActivity[] {
    return []
  }

  destroy(): void {
    if (this.stdoutWatcher) {
      this.stdoutWatcher.close()
      this.stdoutWatcher = null
    }
    if (this.stderrWatcher) {
      this.stderrWatcher.close()
      this.stderrWatcher = null
    }
    this.eventEmitter.removeAllListeners()
  }
}

class SessionManagerClass {
  private sessions = new Map<string, SessionHandle>()
  private records = new Map<string, SessionRecord>()
  private capacity = 8

  init(opts: { capacity?: number } = {}): void {
    this.capacity = opts.capacity ?? 8
  }

  private getOrCreateRecord(
    sessionId: string,
    patch: Partial<Session> = {},
    options: {
      messages?: SessionMessage[]
      messagesLoaded?: boolean
    } = {},
  ): SessionRecord {
    const existing = this.records.get(sessionId)
    const nowIso = new Date().toISOString()

    const baseSession: Session = existing?.session ?? {
      id: sessionId,
      title: defaultTitle(sessionId),
      description: patch.cwd || '',
      status: 'active',
      cwd: patch.cwd,
      createdAt: patch.createdAt ?? nowIso,
      lastMessageAt: patch.lastMessageAt ?? patch.createdAt ?? nowIso,
    }

    const nextSession: Session = {
      ...baseSession,
      ...patch,
      id: sessionId,
      title: patch.title ?? baseSession.title,
      description:
        patch.description ??
        patch.cwd ??
        baseSession.description,
      cwd: patch.cwd ?? baseSession.cwd,
      createdAt: patch.createdAt ?? baseSession.createdAt,
      lastMessageAt: patch.lastMessageAt ?? baseSession.lastMessageAt,
      status: patch.status ?? baseSession.status,
    }

    const record: SessionRecord = {
      session: nextSession,
      messages: options.messages ?? existing?.messages ?? [],
      messagesLoaded:
        options.messagesLoaded ?? existing?.messagesLoaded ?? false,
      assistantDraft: existing?.assistantDraft,
    }

    this.records.set(sessionId, record)
    return record
  }

  private hydrateFromSessionInfo(info: SessionInfo): SessionRecord {
    const current = this.records.get(info.sessionId)
    const transcriptSession = sessionInfoToSession(info)

    return this.getOrCreateRecord(
      info.sessionId,
      {
        title:
          current && current.session.title !== defaultTitle(info.sessionId)
            ? current.session.title
            : transcriptSession.title,
        description: current?.session.description || transcriptSession.description,
        cwd: current?.session.cwd || transcriptSession.cwd,
        branch: info.gitBranch ?? current?.session.branch,
        tag: info.tag ?? current?.session.tag,
        createdAt: current?.session.createdAt || transcriptSession.createdAt,
        lastMessageAt: laterIso(
          current?.session.lastMessageAt,
          transcriptSession.lastMessageAt,
        ) ?? transcriptSession.lastMessageAt,
        status: current?.session.status ?? 'archived',
      },
      {
        messages: current?.messages,
        messagesLoaded: current?.messagesLoaded,
      },
    )
  }

  private async ensureRecord(
    sessionId: string,
    cwd?: string,
  ): Promise<SessionRecord | undefined> {
    const existing = this.records.get(sessionId)
    if (existing) return existing

    const sessionInfo = await findSessionInfo(sessionId)
    if (sessionInfo) return this.hydrateFromSessionInfo(sessionInfo)

    if (!cwd) return undefined

    return this.getOrCreateRecord(
      sessionId,
      {
        cwd,
        description: cwd,
        status: 'active',
      },
      {
        messages: [],
        messagesLoaded: true,
      },
    )
  }

  private async ensureMessagesLoaded(record: SessionRecord): Promise<void> {
    if (record.messagesLoaded) return

    const messages = await loadTranscriptMessages(
      record.session.id,
      record.session.cwd,
    )

    record.messages = messages
    record.messagesLoaded = true

    const latestMessage = messages.at(-1)
    if (latestMessage?.timestamp) {
      record.session = {
        ...record.session,
        lastMessageAt: laterIso(record.session.lastMessageAt, latestMessage.timestamp),
      }
    }
  }

  async createLogicalSession(
    cwd: string,
    sessionId = crypto.randomUUID(),
  ): Promise<Session> {
    if (this.records.has(sessionId) || this.sessions.has(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`)
    }
    if (await findSessionInfo(sessionId)) {
      throw new Error(`Session ${sessionId} already exists`)
    }

    const nowIso = new Date().toISOString()
    const record = this.getOrCreateRecord(
      sessionId,
      {
        title: defaultTitle(sessionId),
        description: cwd,
        status: 'active',
        cwd,
        createdAt: nowIso,
        lastMessageAt: nowIso,
      },
      {
        messages: [],
        messagesLoaded: true,
      },
    )

    return { ...record.session }
  }

  async createSession(
    sessionId: string,
    cwd: string,
    opts: { resume?: boolean; name?: string } = {},
  ): Promise<SessionHandle> {
    if (this.sessions.size >= this.capacity) {
      throw new Error(`Session capacity reached: ${this.capacity}`)
    }

    const record = this.getOrCreateRecord(sessionId, {
      title: opts.name || this.records.get(sessionId)?.session.title || defaultTitle(sessionId),
      description: cwd,
      status: 'active',
      cwd,
      lastMessageAt: this.records.get(sessionId)?.session.lastMessageAt ?? new Date().toISOString(),
    })

    const child = spawnSessionProcess(sessionId, {
      cwd,
      resume: opts.resume,
    }) as ChildProcess
    const handle = new SessionHandleImpl(sessionId, child, cwd)

    this.sessions.set(sessionId, handle)

    try {
      await handle.waitForReady()
      await registerSession({
        pid: child.pid ?? 0,
        sessionId,
        cwd,
        startedAt: handle.startedAt,
        kind: 'server',
        ...(opts.name ? { name: opts.name } : {}),
      })
    } catch (error) {
      this.sessions.delete(sessionId)
      record.session = { ...record.session, status: 'error' }
      handle.kill()
      handle.destroy()
      await unregisterSession(sessionId)
      throw error
    }

    void handle.done.then((status) => {
      const currentRecord = this.records.get(sessionId)
      if (currentRecord) {
        const nextStatus =
          status === 'failed'
            ? 'error'
            : currentRecord.messagesLoaded && currentRecord.messages.length > 0
              ? 'archived'
              : 'active'
        currentRecord.session = {
          ...currentRecord.session,
          status: nextStatus,
        }
      }

      this.sessions.delete(sessionId)
      void unregisterSession(sessionId)
      handle.destroy()
    })

    return handle
  }

  getSession(sessionId: string): SessionHandle | undefined {
    return this.sessions.get(sessionId)
  }

  async getSessionInfo(sessionId: string): Promise<Session | undefined> {
    const record = await this.ensureRecord(sessionId)
    return record ? { ...record.session } : undefined
  }

  async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    const record = await this.ensureRecord(sessionId)
    if (!record) return []

    await this.ensureMessagesLoaded(record)
    const transcriptMessages = await loadTranscriptMessages(
      record.session.id,
      record.session.cwd,
    )
    const mergedMessages = mergeSessionMessages(
      transcriptMessages,
      record.messages,
    )
    const messages = mergedMessages.map((message) => ({ ...message }))
    if (
      record.assistantDraft?.content &&
      !(
        messages.at(-1)?.role === 'assistant' &&
        messages.at(-1)?.content === record.assistantDraft.content
      )
    ) {
      messages.push({ ...record.assistantDraft })
    }
    if (mergedMessages.length > 0) {
      record.messages = mergedMessages
      record.messagesLoaded = true
    }
    return messages
  }

  async recordSessionMessage(
    sessionId: string,
    message: SessionMessage,
    cwd?: string,
  ): Promise<void> {
    const record =
      (await this.ensureRecord(sessionId, cwd)) ??
      this.getOrCreateRecord(
        sessionId,
        {
          cwd,
          description: cwd || '',
          status: 'active',
          createdAt: message.timestamp,
          lastMessageAt: message.timestamp,
        },
        {
          messages: [],
          messagesLoaded: true,
        },
      )

    await this.ensureMessagesLoaded(record)
    record.messages.push(message)
    record.messagesLoaded = true
    record.session = {
      ...record.session,
      status: 'active',
      cwd: cwd ?? record.session.cwd,
      description: cwd ?? record.session.description,
      lastMessageAt: laterIso(record.session.lastMessageAt, message.timestamp),
    }
  }

  async beginAssistantMessage(
    sessionId: string,
    cwd?: string,
  ): Promise<void> {
    const record =
      (await this.ensureRecord(sessionId, cwd)) ??
      this.getOrCreateRecord(
        sessionId,
        {
          cwd,
          description: cwd || '',
          status: 'active',
        },
        {
          messages: [],
          messagesLoaded: true,
        },
      )

    await this.ensureMessagesLoaded(record)
    if (!record.assistantDraft) {
      record.assistantDraft = {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      }
    }
  }

  async appendAssistantMessage(
    sessionId: string,
    content: string,
    mode: 'append' | 'replace' = 'append',
    cwd?: string,
  ): Promise<void> {
    const record = await this.ensureRecord(sessionId, cwd)
    if (!record) return

    await this.ensureMessagesLoaded(record)
    if (!record.assistantDraft) {
      record.assistantDraft = {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      }
    }

    record.assistantDraft = {
      ...record.assistantDraft,
      content:
        mode === 'replace'
          ? content
          : `${record.assistantDraft.content}${content}`,
      timestamp: new Date().toISOString(),
    }
    record.session = {
      ...record.session,
      status: 'active',
      lastMessageAt: laterIso(
        record.session.lastMessageAt,
        record.assistantDraft.timestamp,
      ),
    }
  }

  async finalizeAssistantMessage(
    sessionId: string,
    cwd?: string,
  ): Promise<void> {
    const record = await this.ensureRecord(sessionId, cwd)
    if (!record?.assistantDraft) return

    await this.ensureMessagesLoaded(record)
    if (record.assistantDraft.content.trim()) {
      record.messages.push({
        ...record.assistantDraft,
        content: record.assistantDraft.content.trim(),
      })
      record.session = {
        ...record.session,
        status: 'active',
        lastMessageAt: laterIso(
          record.session.lastMessageAt,
          record.assistantDraft.timestamp,
        ),
      }
    }
    record.assistantDraft = undefined
  }

  updateSessionName(sessionId: string, name: string): void {
    const record = this.records.get(sessionId)
    if (!record) return
    record.session = {
      ...record.session,
      title: name,
    }
  }

  async killSession(sessionId: string): Promise<boolean> {
    const handle = this.sessions.get(sessionId)
    if (!handle) {
      const record = this.records.get(sessionId)
      if (!record) return false

      if (record.messagesLoaded && record.messages.length === 0) {
        this.records.delete(sessionId)
      } else {
        record.session = { ...record.session, status: 'archived' }
      }
      return true
    }

    handle.kill()
    await handle.done

    const record = this.records.get(sessionId)
    if (record) {
      if (record.messagesLoaded && record.messages.length === 0) {
        this.records.delete(sessionId)
      } else if (record.session.status !== 'error') {
        record.session = { ...record.session, status: 'archived' }
      }
    }

    this.sessions.delete(sessionId)
    await unregisterSession(sessionId)
    return true
  }

  async restartSession(sessionId: string, cwd: string): Promise<SessionHandle> {
    await this.killSession(sessionId)
    return this.createSession(sessionId, cwd, { resume: true })
  }

  async listAllSessions(): Promise<Session[]> {
    const liveEntries = await listLiveSessions()
    const sessionInfos = await listSessionsImpl().catch(() => [] as SessionInfo[])

    for (const info of sessionInfos) {
      this.hydrateFromSessionInfo(info)
    }

    for (const entry of liveEntries) {
      this.getOrCreateRecord(entry.sessionId, {
        title:
          entry.name ||
          this.records.get(entry.sessionId)?.session.title ||
          defaultTitle(entry.sessionId),
        description: entry.cwd,
        status: 'active',
        cwd: entry.cwd,
        createdAt:
          this.records.get(entry.sessionId)?.session.createdAt ||
          new Date(entry.startedAt).toISOString(),
        lastMessageAt: laterIso(
          this.records.get(entry.sessionId)?.session.lastMessageAt,
          new Date(entry.startedAt).toISOString(),
        ) ?? new Date(entry.startedAt).toISOString(),
      })
    }

    return Array.from(this.records.values())
      .map((record) => ({ ...record.session }))
      .sort((a, b) =>
        (b.lastMessageAt || b.createdAt).localeCompare(a.lastMessageAt || a.createdAt),
      )
  }

  async getOrCreate(sessionId: string, cwd?: string): Promise<SessionHandle> {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing

    const liveSessions = await listLiveSessions()
    const live = liveSessions.find((s) => s.sessionId === sessionId)
    if (live) {
      throw new Error(
        `Session ${sessionId} is already active in another server process`,
      )
    }

    const record = await this.ensureRecord(sessionId, cwd)
    const sessionInfo = await findSessionInfo(sessionId)
    const resolvedCwd =
      cwd ||
      record?.session.cwd ||
      sessionInfo?.cwd ||
      process.cwd()

    return this.createSession(
      sessionId,
      resolvedCwd,
      {
        resume: Boolean(sessionInfo),
        name: record?.session.title,
      },
    )
  }

  async destroyAll(): Promise<void> {
    const handles = Array.from(this.sessions.values())
    for (const handle of handles) {
      handle.kill()
    }
    await Promise.all(handles.map((handle) => handle.done.catch(() => 'failed')))
  }
}

export const sessionManager = new SessionManagerClass()

export { SessionManagerClass as ProcessSessionManager }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SessionManager: new (...args: any[]) => { destroyAll(): Promise<void>; [key: string]: any } =
  SessionManagerClass as unknown as new (...args: any[]) => {
    destroyAll(): Promise<void>
    [key: string]: any
  }
