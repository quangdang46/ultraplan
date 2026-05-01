import { log, error as logError } from "../logger";
import {
  buildCanonicalSessionEvent,
  type CanonicalSessionEvent,
  type SessionEvent,
  type SessionEventInput,
} from "../types/messages";

export type { CanonicalSessionEvent, SessionEvent, SessionEventInput } from "../types/messages";

type Subscriber = (event: CanonicalSessionEvent) => void;

const MAX_EVENTS_PER_BUS = 5000;

export class EventBus {
  private subscribers = new Set<Subscriber>();
  private events: CanonicalSessionEvent[] = [];
  private seqNum: number;
  private closed = false;

  constructor(initialSeqNum = 0) {
    this.seqNum = initialSeqNum;
  }

  subscribe(callback: Subscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  subscriberCount(): number {
    return this.subscribers.size;
  }

  publish(event: SessionEventInput): CanonicalSessionEvent {
    if (this.closed) throw new Error("EventBus is closed");
    const seqNum = event.seqNum ?? this.seqNum + 1;
    const createdAt = event.createdAt ?? Date.now();
    const full = buildCanonicalSessionEvent({
      ...event,
      seqNum,
      createdAt,
    });
    this.seqNum = Math.max(this.seqNum, full.seqNum);
    this.events.push(full);
    // Evict oldest events when exceeding limit
    if (this.events.length > MAX_EVENTS_PER_BUS) {
      this.events = this.events.slice(-Math.floor(MAX_EVENTS_PER_BUS / 2));
    }
    log(
      `[RC-DEBUG] bus publish: sessionId=${event.sessionId} type=${event.type} dir=${event.direction} seq=${full.seqNum} subscribers=${this.subscribers.size}`,
      event.type === "error" ? `payload=${JSON.stringify(event.payload)}` : "",
    );
    for (const cb of this.subscribers) {
      try {
        cb(full);
      } catch (err) {
        logError(`[RC-DEBUG] bus subscriber error:`, err);
      }
    }
    return full;
  }

  getLastSeqNum(): number {
    return this.seqNum;
  }

  getEventsSince(seqNum: number): CanonicalSessionEvent[] {
    const idx = this.events.findIndex((e) => e.seqNum > seqNum);
    if (idx === -1) return [];
    return this.events.slice(idx);
  }

  close() {
    this.closed = true;
    this.subscribers.clear();
  }
}

/** Global registry of per-session event buses */
const buses = new Map<string, EventBus>();

export function getEventBus(sessionId: string, initialSeqNum = 0): EventBus {
  let bus = buses.get(sessionId);
  if (!bus) {
    bus = new EventBus(initialSeqNum);
    buses.set(sessionId, bus);
  }
  return bus;
}

export function removeEventBus(sessionId: string) {
  const bus = buses.get(sessionId);
  if (bus) {
    bus.close();
    buses.delete(sessionId);
  }
}

export function getAllEventBuses(): Map<string, EventBus> {
  return buses;
}

/** Global registry of per-channel-group ACP event buses */
const acpBuses = new Map<string, EventBus>();

export function getAcpEventBus(channelGroupId: string): EventBus {
  let bus = acpBuses.get(channelGroupId);
  if (!bus) {
    bus = new EventBus();
    acpBuses.set(channelGroupId, bus);
  }
  return bus;
}

export function removeAcpEventBus(channelGroupId: string) {
  const bus = acpBuses.get(channelGroupId);
  if (bus) {
    bus.close();
    acpBuses.delete(channelGroupId);
  }
}
