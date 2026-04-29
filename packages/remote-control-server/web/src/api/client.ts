import type { Session, Environment, ControlResponse, SessionEvent } from "../types";
import { generateMessageUuid } from "../lib/utils";

const BASE = "";
const UUID_STORAGE_KEY = "rcs_uuid";

let inMemoryUuid: string | null = null;

export function getUuid(): string {
  let uuid = inMemoryUuid;

  try {
    uuid ??= localStorage.getItem(UUID_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable in privacy-restricted contexts
  }

  if (!uuid) {
    uuid = generateUuid();
    try {
      localStorage.setItem(UUID_STORAGE_KEY, uuid);
    } catch {
      // Fall back to in-memory UUID when storage is unavailable.
    }
  }

  inMemoryUuid = uuid;
  return uuid;
}

export function setUuid(uuid: string): void {
  inMemoryUuid = uuid;
  try {
    localStorage.setItem(UUID_STORAGE_KEY, uuid);
  } catch {
    // localStorage may be unavailable in privacy-restricted contexts
  }
}

/** Active API token for Authorization header (set by useTokens) */
let _activeToken: string | null = null;

export function setActiveApiToken(token: string | null): void {
  _activeToken = token;
}

export function getActiveApiToken(): string | null {
  return _activeToken;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (_activeToken) {
    headers["Authorization"] = `Bearer ${_activeToken}`;
  }

  const uuid = getUuid();
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}uuid=${encodeURIComponent(uuid)}`;
  const opts: RequestInit = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) {
    const err = data.error || { type: "unknown", message: res.statusText };
    throw new Error(err.message || err.type);
  }
  return data as T;
}

export function apiBind(sessionId: string) {
  return api<void>("POST", "/web/bind", { sessionId });
}

export function apiFetchSessions() {
  return api<Session[]>("GET", "/web/sessions");
}

export function apiFetchAllSessions() {
  return api<Session[]>("GET", "/web/sessions/all");
}

export function apiFetchSession(id: string) {
  return api<Session>("GET", `/web/sessions/${id}`);
}

export function apiFetchSessionHistory(id: string) {
  return api<{ events: SessionEvent[] }>("GET", `/web/sessions/${id}/history`);
}

export function apiFetchEnvironments() {
  return api<Environment[]>("GET", "/web/environments");
}

export function apiSendEvent(sessionId: string, body: Record<string, unknown>) {
  return api<void>("POST", `/web/sessions/${sessionId}/events`, body);
}

export function apiSendControl(sessionId: string, body: ControlResponse) {
  return api<void>("POST", `/web/sessions/${sessionId}/control`, body);
}

export function apiInterrupt(sessionId: string) {
  return api<void>("POST", `/web/sessions/${sessionId}/interrupt`);
}

export function apiCreateSession(body: { title?: string; environment_id?: string }) {
  return api<Session>("POST", "/web/sessions", body);
}
