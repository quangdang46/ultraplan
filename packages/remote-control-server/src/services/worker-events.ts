import { log, error as logError } from "../logger";
import { getEventBus } from "../transport/event-bus";
import { publishSessionEvent } from "./transport";
import { getSession } from "./session";
import { randomUUID } from "node:crypto";
import type { SessionEventType } from "../types/messages";

const MAX_BUFFERED_EVENTS = 100;

interface BufferedEvent {
  event: ReturnType<typeof publishSessionEvent>;
  receivedAt: Date;
}

const eventBuffers = new Map<string, BufferedEvent[]>();
const logSubscribers = new Map<string, Set<(log: string, meta?: Record<string, unknown>) => void>>();

/**
 * Forward a worker event to the session's event bus via publishSessionEvent.
 */
export function forwardWorkerEvent(
  workerId: string,
  event: { type: SessionEventType; payload: unknown },
): ReturnType<typeof publishSessionEvent> {
  const session = getSession(workerId);
  if (!session) {
    logError(`[WorkerEvents] forwardWorkerEvent: session not found for workerId=${workerId}`);
    throw new Error(`Session not found for workerId=${workerId}`);
  }

  const result = publishSessionEvent(workerId, event.type, event.payload, "inbound");
  log(`[WorkerEvents] forwarded event type=${event.type} workerId=${workerId}`);

  return result;
}

/**
 * Stream worker logs via a callback function.
 * Returns an unsubscribe function.
 */
export function streamWorkerLogs(
  workerId: string,
  callback: (log: string, meta?: Record<string, unknown>) => void,
): () => void {
  let subscriberSet = logSubscribers.get(workerId);
  if (!subscriberSet) {
    subscriberSet = new Set();
    logSubscribers.set(workerId, subscriberSet);
  }

  subscriberSet.add(callback);

  return () => {
    subscriberSet?.delete(callback);
    if (subscriberSet && subscriberSet.size === 0) {
      logSubscribers.delete(workerId);
    }
  };
}

/**
 * Emit a log message to all subscribers for a worker.
 */
export function emitWorkerLog(workerId: string, message: string, meta?: Record<string, unknown>): void {
  const subscribers = logSubscribers.get(workerId);
  if (subscribers) {
    for (const cb of subscribers) {
      try {
        cb(message, meta);
      } catch (err) {
        logError(`[WorkerEvents] log subscriber error for workerId=${workerId}:`, err);
      }
    }
  }
}

/**
 * Buffer events for replay capability.
 */
export function bufferWorkerEvents(workerId: string, events: Array<{ type: SessionEventType; payload: unknown }>): void {
  let buffer = eventBuffers.get(workerId);
  if (!buffer) {
    buffer = [];
    eventBuffers.set(workerId, buffer);
  }

  for (const evt of events) {
    const result = forwardWorkerEvent(workerId, evt);
    buffer.push({ event: result, receivedAt: new Date() });
  }

  if (buffer.length > MAX_BUFFERED_EVENTS) {
    const overflow = buffer.length - MAX_BUFFERED_EVENTS;
    eventBuffers.set(workerId, buffer.slice(overflow));
  }
}

/**
 * Get buffered events for a worker.
 */
export function getBufferedEvents(workerId: string): BufferedEvent[] {
  return eventBuffers.get(workerId) ?? [];
}

/**
 * Clear buffered events for a worker.
 */
export function clearBufferedEvents(workerId: string): void {
  eventBuffers.delete(workerId);
}

/**
 * Flush buffered events for a worker by replaying them to the current bus.
 */
export function flushBufferedEvents(workerId: string): number {
  const buffer = eventBuffers.get(workerId);
  if (!buffer || buffer.length === 0) {
    return 0;
  }

  const bus = getEventBus(workerId);
  for (const { event } of buffer) {
    bus.publish({
      id: randomUUID(),
      sessionId: workerId,
      type: event.type,
      payload: event.payload,
      direction: event.direction,
      seqNum: event.seqNum,
      createdAt: event.createdAt,
    });
  }

  const count = buffer.length;
  clearBufferedEvents(workerId);
  log(`[WorkerEvents] flushed ${count} buffered events for workerId=${workerId}`);
  return count;
}

/**
 * Subscribe to worker events for a session.
 * Returns an unsubscribe function.
 */
export function subscribeToWorkerEvents(
  workerId: string,
  callback: (event: Parameters<ReturnType<typeof getEventBus>["subscribe"]>[0]) => void,
): () => void {
  const bus = getEventBus(workerId);
  return bus.subscribe(callback);
}

/**
 * Get the number of log subscribers for a worker.
 */
export function getLogSubscriberCount(workerId: string): number {
  return logSubscribers.get(workerId)?.size ?? 0;
}

/**
 * Clear all event buffers and log subscribers. Used during shutdown.
 */
export function clearAllWorkerEventState(): void {
  eventBuffers.clear();
  logSubscribers.clear();
}
