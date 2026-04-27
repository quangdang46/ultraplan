// src/server/types.ts
// SessionHandle types for process-per-session pattern + original server types

import type { ChildProcess } from 'child_process'
import { z } from 'zod/v4'
import { lazySchema } from '../utils/lazySchema.js'
import type { SessionActivity } from '../bridge/types.js'

// ---------------------------------------------------------------------------
// Original server types (kept for backward compatibility)
// ---------------------------------------------------------------------------

export const connectResponseSchema = lazySchema(() =>
  z.object({
    session_id: z.string(),
    ws_url: z.string(),
    work_dir: z.string().optional(),
  }),
)

export type ServerConfig = {
  port: number
  host: string
  authToken: string
  unix?: string
  /** Idle timeout for detached sessions (ms). 0 = never expire. */
  idleTimeoutMs?: number
  /** Maximum number of concurrent sessions. */
  maxSessions?: number
  /** Default workspace directory for sessions that don't specify cwd. */
  workspace?: string
}

export type SessionState =
  | 'starting'
  | 'running'
  | 'detached'
  | 'stopping'
  | 'stopped'

export type SessionInfo = {
  id: string
  status: SessionState
  createdAt: number
  workDir: string
  process: ChildProcess | null
  sessionKey?: string
}

/**
 * Stable session key → session metadata. Persisted to ~/.claude/server-sessions.json
 * so sessions can be resumed across server restarts.
 */
export type SessionIndexEntry = {
  /** Server-assigned session ID (matches the subprocess's claude session). */
  sessionId: string
  /** The claude transcript session ID for --resume. Same as sessionId for direct sessions. */
  transcriptSessionId: string
  cwd: string
  permissionMode?: string
  createdAt: number
  lastActiveAt: number
}

export type SessionIndex = Record<string, SessionIndexEntry>

// ---------------------------------------------------------------------------
// New process-per-session types
// ---------------------------------------------------------------------------

export interface SessionHandle {
  sessionId: string
  pid: number
  cwd: string
  startedAt: number
  child: ChildProcess
  done: Promise<SessionDoneStatus>
  kill(): void
  forceKill(): void
  waitForReady(timeoutMs?: number): Promise<void>
  writeStdin(data: string): void
  // Subscribe to subprocess events (NO direct stdout access)
  subscribeEvents(cb: (event: unknown) => void): () => void
  // Enqueue a message and wait for result
  enqueueMessage(data: string): Promise<void>
  getActivity(): SessionActivity[]
}

export type SessionDoneStatus = 'completed' | 'failed' | 'interrupted'

export interface SessionManagerLike {
  getOrCreate(sessionId: string, cwd?: string): Promise<SessionHandle>
  getSession?(sessionId: string): SessionHandle | undefined
}

export interface SpawnOptions {
  cwd: string
  env?: Record<string, string>
  permissionMode?: string
  resume?: boolean
}
