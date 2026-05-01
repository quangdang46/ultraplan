/**
 * Worker interface and lifecycle type definitions.
 *
 * Provides a clean abstraction for wrapping different worker implementations
 * (subprocess, runtime-core, remote-control, etc.) under a common interface.
 */

import type { PermissionMode } from './permissions.js'

// ============================================================================
// Worker Lifecycle
// ============================================================================

/**
 * Worker lifecycle states.
 */
export type WorkerLifecycleState =
  | 'spawning' // Worker is being created
  | 'running' // Worker is active and processing
  | 'idle' // Worker is alive but not processing
  | 'crashed' // Worker has crashed (can be restarted)
  | 'stopping' // Worker is being shut down
  | 'stopped' // Worker has cleanly stopped

// ============================================================================
// Worker Kinds
// ============================================================================

/**
 * Supported worker implementation kinds.
 */
export type WorkerKind = 'subprocess' | 'runtime-core' | 'remote-control'

// ============================================================================
// Worker Handle & Config
// ============================================================================

/**
 * Opaque reference to a worker instance.
 * Used as the primary handle for all worker operations.
 */
export interface WorkerHandle {
  workerId: string
  sessionId?: string
  kind: WorkerKind
}

/**
 * Configuration passed to Worker.spawn().
 */
export interface WorkerConfig {
  sessionId: string
  kind: WorkerKind
  workspacePath?: string
  permission?: PermissionMode
  [key: string]: unknown
}

// ============================================================================
// Heartbeat & Metadata
// ============================================================================

/**
 * Heartbeat info for monitoring worker health.
 */
export interface HeartbeatInfo {
  lastSeenAt: Date
  restartCount: number
  crashReason?: string
  currentState: WorkerLifecycleState
}

/**
 * Worker metadata persisted across restarts.
 */
export interface WorkerMetadata {
  workerId: string
  sessionId: string
  kind: WorkerKind
  startedAt: Date
  endedAt?: Date
  restartCount: number
}

// ============================================================================
// Worker Interface
// ============================================================================

/**
 * Control signals that can be sent to a worker.
 */
export type WorkerControlSignal = 'interrupt' | 'resume' | 'cancel'

/**
 * Worker abstraction interface.
 *
 * Defines the contract for spawning and managing worker instances
 * regardless of the underlying implementation (subprocess, runtime-core, etc.).
 */
export interface Worker {
  spawn(config: WorkerConfig): WorkerHandle
  sendInput(handle: WorkerHandle, input: unknown): void
  sendControl(handle: WorkerHandle, signal: WorkerControlSignal): void
  status(handle: WorkerHandle): WorkerLifecycleState
  heartbeat(handle: WorkerHandle): HeartbeatInfo
  shutdown(handle: WorkerHandle): void
}