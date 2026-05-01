/**
 * Worker heartbeat service — manages periodic heartbeat signals for workers.
 *
 * Uses setInterval/clearInterval for heartbeat tracking and persists heartbeat
 * timestamps to SQLite via the store layer.
 */

import { log, error as logError } from "../logger";
import { storeGetSessionWorker, storeUpsertSessionWorker } from "../store";
import { getEventBus } from "../transport/event-bus";
import { randomUUID } from "node:crypto";

// ---------- Types ----------

export type WorkerStatus = "idle" | "running" | "requires_action" | "stopped" | "error" | "interrupted";

export interface WorkerState {
  sessionId: string;
  status: WorkerStatus;
  lastHeartbeatAt: Date | null;
  externalMetadata: Record<string, unknown> | null;
  requiresActionDetails: Record<string, unknown> | null;
}

export type ExecutionMode = "fork" | "bridge" | "daemon" | " subprocess";

export interface HeartbeatRecord {
  workerId: string;
  lastHeartbeatAt: Date;
  intervalMs: number;
}

// ---------- Heartbeat State ----------

const heartbeatTimers = new Map<string, Timer>();
const heartbeatRecords = new Map<string, HeartbeatRecord>();

interface Timer {
  id: ReturnType<typeof setInterval>;
}

// ---------- Config ----------

const DEFAULT_HEARTBEAT_THRESHOLD_MS = 60_000; // 60 seconds default staleness threshold

// ---------- Heartbeat Management ----------

/**
 * Start a periodic heartbeat for a worker.
 * Records an initial heartbeat and schedules recurring heartbeats.
 */
export function startHeartbeat(workerId: string, intervalMs = 20_000): void {
  if (heartbeatTimers.has(workerId)) {
    stopHeartbeat(workerId);
  }

  recordHeartbeat(workerId);

  const timer = setInterval(() => {
    try {
      recordHeartbeat(workerId);
      log(`[Heartbeat] worker=${workerId} beat`);
    } catch (err) {
      logError(`[Heartbeat] error for worker=${workerId}:`, err);
    }
  }, intervalMs);

  heartbeatTimers.set(workerId, { id: timer });
  heartbeatRecords.set(workerId, {
    workerId,
    lastHeartbeatAt: new Date(),
    intervalMs,
  });

  log(`[Heartbeat] started for worker=${workerId} interval=${intervalMs}ms`);
}

/**
 * Stop the periodic heartbeat for a worker.
 */
export function stopHeartbeat(workerId: string): void {
  const entry = heartbeatTimers.get(workerId);
  if (entry) {
    clearInterval(entry.id);
    heartbeatTimers.delete(workerId);
    heartbeatRecords.delete(workerId);
    log(`[Heartbeat] stopped for worker=${workerId}`);
  }
}

/**
 * Record a heartbeat with the current timestamp.
 * Updates both the in-memory record and the SQLite store.
 */
export function recordHeartbeat(workerId: string): Date {
  const now = new Date();

  // Persist to SQLite
  storeUpsertSessionWorker(workerId, { lastHeartbeatAt: now });

  // Update in-memory record
  const record = heartbeatRecords.get(workerId);
  if (record) {
    record.lastHeartbeatAt = now;
  } else {
    heartbeatRecords.set(workerId, {
      workerId,
      lastHeartbeatAt: now,
      intervalMs: 20_000,
    });
  }

  // Publish heartbeat event to the session's event bus
  const bus = getEventBus(workerId);
  bus.publish({
    id: randomUUID(),
    sessionId: workerId,
    type: "heartbeat",
    payload: { workerId, timestamp: now.toISOString() },
    direction: "inbound",
  });

  return now;
}

/**
 * Check if a worker's heartbeat is stale (hasn't received a heartbeat within the threshold).
 */
export function isHeartbeatStale(workerId: string, thresholdMs = DEFAULT_HEARTBEAT_THRESHOLD_MS): boolean {
  const record = heartbeatRecords.get(workerId);
  if (!record) {
    // No in-memory record — check SQLite
    const worker = storeGetSessionWorker(workerId);
    if (!worker || !worker.lastHeartbeatAt) {
      return true; // Never had a heartbeat = stale
    }
    return Date.now() - worker.lastHeartbeatAt.getTime() > thresholdMs;
  }

  return Date.now() - record.lastHeartbeatAt.getTime() > thresholdMs;
}

/**
 * Get all workers that have stale heartbeats.
 */
export function getAllStaleWorkers(thresholdMs = DEFAULT_HEARTBEAT_THRESHOLD_MS): string[] {
  const stale: string[] = [];

  for (const [workerId, record] of heartbeatRecords) {
    if (Date.now() - record.lastHeartbeatAt.getTime() > thresholdMs) {
      stale.push(workerId);
    }
  }

  return stale;
}

/**
 * Get the current heartbeat record for a worker.
 */
export function getHeartbeatRecord(workerId: string): HeartbeatRecord | undefined {
  return heartbeatRecords.get(workerId);
}

/**
 * Check if a worker has an active heartbeat timer.
 */
export function hasActiveHeartbeat(workerId: string): boolean {
  return heartbeatTimers.has(workerId);
}

/**
 * Clear all heartbeat timers. Used during shutdown.
 */
export function clearAllHeartbeats(): void {
  for (const [workerId] of heartbeatTimers) {
    stopHeartbeat(workerId);
  }
}
