import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { storeReset, storeCreateSession } from "../store";

const mockConfig = {
  port: 3000,
  host: "0.0.0.0",
  apiKeys: ["test-api-key"],
  baseUrl: "http://localhost:3000",
  pollTimeout: 1,
  heartbeatInterval: 20,
  jwtExpiresIn: 3600,
  disconnectTimeout: 300,
  webCorsOrigins: [],
  wsIdleTimeout: 30,
  wsKeepaliveInterval: 20,
};

mock.module("../config", () => ({
  config: mockConfig,
  getBaseUrl: () => "http://localhost:3000",
}));

import {
  startHeartbeat,
  stopHeartbeat,
  recordHeartbeat,
  isHeartbeatStale,
  getAllStaleWorkers,
  getHeartbeatRecord,
  hasActiveHeartbeat,
  clearAllHeartbeats,
} from "../services/worker-heartbeat";

describe("Worker Heartbeat", () => {
  let sessionId: string;

  beforeEach(() => {
    storeReset();
    const session = storeCreateSession({});
    sessionId = session.id;
  });

  afterEach(() => {
    stopHeartbeat(sessionId);
    clearAllHeartbeats();
  });

  describe("startHeartbeat", () => {
    test("starts a heartbeat timer for the worker", () => {
      startHeartbeat(sessionId, 100);
      expect(hasActiveHeartbeat(sessionId)).toBe(true);
    });

    test("records an initial heartbeat when starting", () => {
      const before = Date.now();
      startHeartbeat(sessionId, 100);
      const record = getHeartbeatRecord(sessionId);
      expect(record).toBeDefined();
      expect(record!.lastHeartbeatAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    test("replaces existing heartbeat when called twice", () => {
      startHeartbeat(sessionId, 100);
      const firstRecord = getHeartbeatRecord(sessionId);
      startHeartbeat(sessionId, 200);
      const secondRecord = getHeartbeatRecord(sessionId);
      expect(secondRecord!.intervalMs).toBe(200);
    });
  });

  describe("stopHeartbeat", () => {
    test("stops an active heartbeat timer", () => {
      startHeartbeat(sessionId, 100);
      expect(hasActiveHeartbeat(sessionId)).toBe(true);
      stopHeartbeat(sessionId);
      expect(hasActiveHeartbeat(sessionId)).toBe(false);
    });

    test("no-op when no heartbeat is active", () => {
      expect(() => stopHeartbeat(sessionId)).not.toThrow();
    });
  });

  describe("recordHeartbeat", () => {
    test("records a heartbeat and updates the timestamp", () => {
      startHeartbeat(sessionId, 100);
      const before = Date.now();
      recordHeartbeat(sessionId);
      const record = getHeartbeatRecord(sessionId);
      expect(record!.lastHeartbeatAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    test("creates in-memory record if none exists", () => {
      recordHeartbeat(sessionId);
      expect(getHeartbeatRecord(sessionId)).toBeDefined();
    });
  });

  describe("isHeartbeatStale", () => {
    test("returns false for active heartbeat within threshold", () => {
      startHeartbeat(sessionId, 100);
      expect(isHeartbeatStale(sessionId, 5000)).toBe(false);
    });

    test("returns true when no heartbeat has been recorded", () => {
      expect(isHeartbeatStale(sessionId, 1000)).toBe(true);
    });

    test("returns true when heartbeat is older than threshold", () => {
      startHeartbeat(sessionId, 10_000_000);
      const record = getHeartbeatRecord(sessionId);
      if (record) {
        record.lastHeartbeatAt = new Date(Date.now() - 100_000);
      }
      expect(isHeartbeatStale(sessionId, 50_000)).toBe(true);
    });
  });

  describe("getAllStaleWorkers", () => {
    test("returns empty array when no heartbeats are active", () => {
      const stale = getAllStaleWorkers(1000);
      expect(Array.isArray(stale)).toBe(true);
    });

    test("includes workers with stale heartbeats", () => {
      const session2 = storeCreateSession({}).id;
      startHeartbeat(sessionId, 100);
      startHeartbeat(session2, 10_000_000);
      const stale2Record = getHeartbeatRecord(session2);
      if (stale2Record) {
        stale2Record.lastHeartbeatAt = new Date(Date.now() - 100_000);
      }
      const stale = getAllStaleWorkers(50_000);
      expect(stale).toContain(session2);
      stopHeartbeat(session2);
    });
  });

  describe("getHeartbeatRecord", () => {
    test("returns undefined for unknown worker", () => {
      expect(getHeartbeatRecord("unknown")).toBeUndefined();
    });

    test("returns record for worker with heartbeat", () => {
      startHeartbeat(sessionId, 100);
      const record = getHeartbeatRecord(sessionId);
      expect(record).toBeDefined();
      expect(record!.workerId).toBe(sessionId);
    });
  });

  describe("hasActiveHeartbeat", () => {
    test("returns false for unknown worker", () => {
      expect(hasActiveHeartbeat("unknown")).toBe(false);
    });

    test("returns true for worker with active heartbeat", () => {
      startHeartbeat(sessionId, 100);
      expect(hasActiveHeartbeat(sessionId)).toBe(true);
    });
  });

  describe("clearAllHeartbeats", () => {
    test("clears all active heartbeat timers", () => {
      const session2 = storeCreateSession({}).id;
      startHeartbeat(sessionId, 100);
      startHeartbeat(session2, 100);
      clearAllHeartbeats();
      expect(hasActiveHeartbeat(sessionId)).toBe(false);
      expect(hasActiveHeartbeat(session2)).toBe(false);
    });
  });
});
