import { log, error as logError } from "../logger";
import { stopHeartbeat, recordHeartbeat, isHeartbeatStale } from "./worker-heartbeat";
import { storeGetSessionWorker, storeUpsertSessionWorker } from "../store";
import { incrementEpoch } from "./session";
import { getEventBus } from "../transport/event-bus";
import { randomUUID } from "node:crypto";

// ---------- Types ----------

export type RestartReason = "manual" | "stale" | "error" | "auto" | "health-check";

export interface RestartRequest {
  workerId: string;
  reason: RestartReason;
  requestedAt: Date;
  status: "pending" | "in-progress" | "completed" | "failed";
  error?: string;
}

// ---------- Restart State ----------

const restartQueue = new Map<string, RestartRequest>();
const restartAttempts = new Map<string, number>();
const autoRestartEnabled = new Set<string>();

const MAX_AUTO_RESTART_ATTEMPTS = 3;

// ---------- Restart Logic ----------

/**
 * Signal a restart request for a worker.
 * The restart is queued and will be executed asynchronously.
 */
export function requestWorkerRestart(workerId: string, reason: RestartReason = "manual"): RestartRequest {
  const request: RestartRequest = {
    workerId,
    reason,
    requestedAt: new Date(),
    status: "pending",
  };

  restartQueue.set(workerId, request);
  log(`[Restart] requested for worker=${workerId} reason=${reason}`);

  // Emit restart_requested event
  const bus = getEventBus(workerId);
  bus.publish({
    id: randomUUID(),
    sessionId: workerId,
    type: "restart_requested",
    payload: { workerId, reason, requestedAt: request.requestedAt.toISOString() },
    direction: "inbound",
  });

  return request;
}

/**
 * Check if a worker should automatically restart based on its configuration.
 */
export function shouldAutoRestart(workerId: string): boolean {
  if (!autoRestartEnabled.has(workerId)) {
    return false;
  }

  const attempts = restartAttempts.get(workerId) ?? 0;
  return attempts < MAX_AUTO_RESTART_ATTEMPTS;
}

/**
 * Enable or disable auto-restart for a worker.
 */
export function setAutoRestart(workerId: string, enabled: boolean): void {
  if (enabled) {
    autoRestartEnabled.add(workerId);
    log(`[Restart] auto-restart enabled for worker=${workerId}`);
  } else {
    autoRestartEnabled.delete(workerId);
    log(`[Restart] auto-restart disabled for worker=${workerId}`);
  }
}

/**
 * Execute the restart sequence for a worker.
 * Sequence: stop heartbeat → cleanup → re-provision → start
 */
export async function performWorkerRestart(workerId: string): Promise<boolean> {
  const request = restartQueue.get(workerId);
  if (request && request.status === "in-progress") {
    log(`[Restart] already in progress for worker=${workerId}`);
    return false;
  }

  const restartRequest: RestartRequest = {
    workerId,
    reason: request?.reason ?? "manual",
    requestedAt: new Date(),
    status: "in-progress",
  };
  restartQueue.set(workerId, restartRequest);

  const bus = getEventBus(workerId);
  bus.publish({
    id: randomUUID(),
    sessionId: workerId,
    type: "restarting",
    payload: { workerId, reason: restartRequest.reason },
    direction: "inbound",
  });

  try {
    log(`[Restart] starting sequence for worker=${workerId}`);

    // Step 1: Stop heartbeat
    stopHeartbeat(workerId);
    log(`[Restart] step 1/3: heartbeat stopped for worker=${workerId}`);

    // Step 2: Cleanup - mark worker as stopped in store
    storeUpsertSessionWorker(workerId, { workerStatus: "stopped" });
    log(`[Restart] step 2/3: cleanup completed for worker=${workerId}`);

    // Step 3: Re-provision - increment epoch to signal new worker
    try {
      incrementEpoch(workerId);
      log(`[Restart] step 3/3: re-provisioned (epoch incremented) for worker=${workerId}`);
    } catch {
      log(`[Restart] epoch increment failed (session may not exist) for worker=${workerId}`);
    }

    // Mark restart as completed
    restartRequest.status = "completed";
    restartQueue.set(workerId, restartRequest);

    // Track restart attempt for auto-restart
    const attempts = (restartAttempts.get(workerId) ?? 0) + 1;
    restartAttempts.set(workerId, attempts);

    bus.publish({
      id: randomUUID(),
      sessionId: workerId,
      type: "restarted",
      payload: { workerId, attempts },
      direction: "inbound",
    });

    log(`[Restart] completed for worker=${workerId} (attempts=${attempts})`);
    return true;
  } catch (err) {
    logError(`[Restart] failed for worker=${workerId}:`, err);
    restartRequest.status = "failed";
    restartRequest.error = err instanceof Error ? err.message : String(err);
    restartQueue.set(workerId, restartRequest);

    bus.publish({
      id: randomUUID(),
      sessionId: workerId,
      type: "restart_failed",
      payload: { workerId, error: restartRequest.error },
      direction: "inbound",
    });

    return false;
  }
}

/**
 * Get the restart request for a worker.
 */
export function getRestartRequest(workerId: string): RestartRequest | undefined {
  return restartQueue.get(workerId);
}

/**
 * Get the number of restart attempts for a worker.
 */
export function getRestartAttempts(workerId: string): number {
  return restartAttempts.get(workerId) ?? 0;
}

/**
 * Reset restart attempts counter for a worker.
 */
export function resetRestartAttempts(workerId: string): void {
  restartAttempts.set(workerId, 0);
  log(`[Restart] attempts reset for worker=${workerId}`);
}

/**
 * Check if a worker is currently restarting.
 */
export function isWorkerRestarting(workerId: string): boolean {
  const request = restartQueue.get(workerId);
  return request?.status === "in-progress";
}

/**
 * Clear restart state for a worker.
 */
export function clearRestartState(workerId: string): void {
  restartQueue.delete(workerId);
  autoRestartEnabled.delete(workerId);
}
