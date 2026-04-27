// src/server/sessionManager.ts
// Session manager with process isolation - each session = 1 CLI subprocess

import type { ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { createInterface } from 'readline'
import { jsonParse } from '../utils/slowOperations.js'
import { spawnSessionProcess } from './processStarter.js'
import { registerSession, unregisterSession, listLiveSessions } from './sessionRegistry.js'
import type { SessionHandle, SessionDoneStatus } from './types.js'
import type { SessionActivity } from '../bridge/types.js'
import type { Session } from '../../packages/contracts/src/index.js'
import { listSessionsImpl, type SessionInfo } from '../utils/listSessionsImpl.js'

// Extend EventEmitter to support setMaxListeners
class SafeEventEmitter extends EventEmitter {
  setMaxListeners(n: number): this {
    return super.setMaxListeners(n)
  }
}

const READY_TIMEOUT_MS = 250
const STDERR_LINE_LIMIT = 50

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function toIsoFromEpochMs(value?: number): string | undefined {
  if (!value || Number.isNaN(value)) return undefined
  return new Date(value).toISOString()
}

async function findSessionInfo(
  sessionId: string,
): Promise<SessionInfo | undefined> {
  const sessionInfos = await listSessionsImpl().catch(() => [] as SessionInfo[])
  return sessionInfos.find((info) => info.sessionId === sessionId)
}

function sessionInfoToSession(
  info: SessionInfo,
  live?: {
    sessionId: string
    cwd: string
    startedAt: number
    name?: string
  },
): Session {
  const createdAt =
    toIsoFromEpochMs(info.createdAt) ??
    (live ? new Date(live.startedAt).toISOString() : new Date(info.lastModified).toISOString())

  return {
    id: info.sessionId,
    title: live?.name || info.customTitle || info.summary || info.sessionId.slice(0, 8),
    description: info.cwd || live?.cwd || '',
    status: live ? 'active' : 'archived',
    cwd: info.cwd || live?.cwd,
    branch: info.gitBranch,
    tag: info.tag,
    lastMessageAt:
      toIsoFromEpochMs(info.lastModified) ??
      (live ? new Date(live.startedAt).toISOString() : createdAt),
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

    this._watchStdout()
    this._watchStderr()
  }

  // CRITICAL: Own stdout completely, emit events to subscribers
  private _watchStdout(): void {
    if (!this.child.stdout || this.stdoutWatcher) return

    const rl = createInterface({ input: this.child.stdout })
    this.stdoutWatcher = rl

    rl.on('line', (line) => {
      try {
        const parsed = jsonParse(line)
        if (parsed && typeof parsed === 'object') {
          // Emit to all subscribers
          this.eventEmitter.emit('event', parsed)

          // Resolve waitForResult when 'result' type arrives
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

  private _watchStderr(): void {
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

  // Public: chat.ts subscribes here - NO direct stdout access
  subscribeEvents(cb: (event: unknown) => void): () => void {
    this.eventEmitter.on('event', cb)
    return () => this.eventEmitter.off('event', cb)
  }

  // Internal: wait for 'result' event
  private _waitForResult(): Promise<void> {
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

  // Write message and wait for result (serialized per session)
  async enqueueMessage(data: string): Promise<void> {
    const previous = this.messageChain
    const run = previous.then(async () => {
      if (this.child.killed || this.child.exitCode !== null) {
        throw new Error(
          formatFailureMessage('failed', this.stderrLines, this.child.exitCode, null),
        )
      }

      const waitForResult = this._waitForResult()
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

  // Cleanup
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
  private capacity = 8

  init(opts: { capacity?: number } = {}): void {
    this.capacity = opts.capacity ?? 8
  }

  async createSession(
    sessionId: string,
    cwd: string,
    opts: { resume?: boolean; name?: string } = {},
  ): Promise<SessionHandle> {
    if (this.sessions.size >= this.capacity) {
      throw new Error(`Session capacity reached: ${this.capacity}`)
    }

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
      handle.kill()
      handle.destroy()
      await unregisterSession(sessionId)
      throw error
    }

    // Cleanup on exit
    void handle.done.then(() => {
      this.sessions.delete(sessionId)
      void unregisterSession(sessionId)
      handle.destroy()
    })

    return handle
  }

  getSession(sessionId: string): SessionHandle | undefined {
    return this.sessions.get(sessionId)
  }

  async killSession(sessionId: string): Promise<boolean> {
    const handle = this.sessions.get(sessionId)
    if (!handle) return false

    handle.kill()
    await handle.done

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
    const liveById = new Map(liveEntries.map((entry) => [entry.sessionId, entry]))
    const sessionInfos = await listSessionsImpl().catch(() => [] as SessionInfo[])
    const sessions = new Map<string, Session>()

    for (const info of sessionInfos) {
      sessions.set(info.sessionId, sessionInfoToSession(info, liveById.get(info.sessionId)))
    }

    for (const entry of liveEntries) {
      if (!sessions.has(entry.sessionId)) {
        sessions.set(entry.sessionId, {
          id: entry.sessionId,
          title: entry.name || entry.sessionId.slice(0, 8),
          description: entry.cwd,
          status: 'active',
          cwd: entry.cwd,
          createdAt: new Date(entry.startedAt).toISOString(),
          lastMessageAt: new Date(entry.startedAt).toISOString(),
        })
      }
    }

    return Array.from(sessions.values()).sort((a, b) =>
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

    const sessionInfo = await findSessionInfo(sessionId)
    if (sessionInfo) {
      return this.createSession(
        sessionId,
        sessionInfo.cwd || cwd || process.cwd(),
        {
          resume: true,
          name: sessionInfo.customTitle,
        },
      )
    }

    return this.createSession(sessionId, cwd || process.cwd())
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

// Export SessionManagerClass as ProcessSessionManager for new server code
export { SessionManagerClass as ProcessSessionManager }

// ---------------------------------------------------------------------------
// Backward compatibility stub for existing claude server command (main.tsx)
// This stub is used by the DIRECT_CONNECT feature's "claude server" command
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SessionManager: new (...args: any[]) => { destroyAll(): Promise<void>; [key: string]: any } =
  SessionManagerClass as unknown as new (...args: any[]) => {
    destroyAll(): Promise<void>
    [key: string]: any
  }
