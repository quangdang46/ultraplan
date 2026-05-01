import { log } from "../logger";
import {
  storeGetSessionState,
  storeGetSessionWorker,
  storeGetWorkspaceBySession,
  storeUpsertSessionState,
  storeUpsertWorkspace,
  type SessionStateRecord,
  type SessionWorkerRecord,
  type WorkspaceRecord,
} from "../store";
import type { AutomationStateResponse, SessionResponse } from "../types/api";
import { getAutomationStateSnapshot } from "./automationState";
import {
  getSession,
  isSessionClosedStatus,
  resolveExistingWebSessionId,
  resolveOwnedWebSessionId,
  toWebSessionId,
} from "./session";

type SessionWorkspacePatch = Parameters<typeof storeUpsertWorkspace>[1];
type SessionStatePatch = Parameters<typeof storeUpsertSessionState>[1];

export interface WebSessionRuntimeContext {
  requestedSessionId: string;
  sessionId: string;
  webSessionId: string;
  ownerUuid: string;
  session: SessionResponse;
  workspace: WorkspaceRecord | null;
  sessionState: SessionStateRecord | null;
  worker: SessionWorkerRecord | null;
  automationState: AutomationStateResponse | undefined;
  selectedRepos: string[];
  effectivePermissionMode: string | null;
}

export interface WebSessionRuntimeAccessError {
  status: 403 | 404 | 409;
  type:
    | "forbidden"
    | "missing_state"
    | "missing_workspace"
    | "not_found"
    | "session_closed";
  message: string;
}

export type WebSessionRuntimeAccessResult =
  | { ok: true; context: WebSessionRuntimeContext }
  | { ok: false; error: WebSessionRuntimeAccessError };

function requireSession(sessionId: string): SessionResponse {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  return session;
}

function normalizeSelectedRepos(selectedRepos: string[] | null | undefined): string[] | undefined {
  if (selectedRepos === undefined) {
    return undefined;
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of selectedRepos ?? []) {
    if (typeof entry !== "string") {
      continue;
    }

    const trimmed = entry.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function buildWebSessionRuntimeContext(
  requestedSessionId: string,
  sessionId: string,
  ownerUuid: string,
  session: SessionResponse,
): WebSessionRuntimeContext {
  const workspace = storeGetWorkspaceBySession(sessionId) ?? null;
  const sessionState = storeGetSessionState(sessionId) ?? null;
  const worker = storeGetSessionWorker(sessionId) ?? null;
  const automationState = getAutomationStateSnapshot(worker?.externalMetadata);
  const selectedRepos = sessionState?.selectedRepos ?? [];
  const effectivePermissionMode = sessionState?.permissionMode ?? session.permission_mode;

  log(
    `[RCS] resolved session runtime requested=${requestedSessionId} resolved=${sessionId} owner=${ownerUuid} workspace=${workspace?.id ?? "none"} workspacePath=${workspace?.workspacePath ?? "none"} workspaceStrategy=${workspace?.strategy ?? "none"} sessionState=${sessionState ? "present" : "missing"} selectedRepos=${selectedRepos.length} worker=${worker ? "present" : "missing"}`,
  );

  return {
    requestedSessionId,
    sessionId,
    webSessionId: toWebSessionId(sessionId),
    ownerUuid,
    session,
    workspace,
    sessionState,
    worker,
    automationState,
    selectedRepos,
    effectivePermissionMode,
  };
}

export function getSessionWorkspace(sessionId: string): WorkspaceRecord | null {
  requireSession(sessionId);
  return storeGetWorkspaceBySession(sessionId) ?? null;
}

export function upsertSessionWorkspace(
  sessionId: string,
  patch: SessionWorkspacePatch,
): WorkspaceRecord {
  const session = requireSession(sessionId);
  const workspace = storeUpsertWorkspace(sessionId, {
    ...patch,
    environmentId:
      patch.environmentId === undefined
        ? session.environment_id
        : patch.environmentId,
  });

  log(
    `[RCS] upserted session workspace sessionId=${sessionId} workspaceId=${workspace.id} strategy=${workspace.strategy} workspacePath=${workspace.workspacePath}`,
  );

  return workspace;
}

export function getSessionRuntimeState(sessionId: string): SessionStateRecord | null {
  requireSession(sessionId);
  return storeGetSessionState(sessionId) ?? null;
}

export function upsertSessionRuntimeState(
  sessionId: string,
  patch: SessionStatePatch,
): SessionStateRecord {
  const session = requireSession(sessionId);
  const existing = storeGetSessionState(sessionId);
  const state = storeUpsertSessionState(sessionId, {
    ...patch,
    permissionMode:
      patch.permissionMode === undefined && !existing
        ? session.permission_mode
        : patch.permissionMode,
    selectedRepos: normalizeSelectedRepos(patch.selectedRepos),
  });

  log(
    `[RCS] upserted session runtime state sessionId=${sessionId} model=${state.model ?? "none"} permissionMode=${state.permissionMode ?? "none"} selectedRepos=${state.selectedRepos.length}`,
  );

  return state;
}

export function getSessionSelectedRepos(sessionId: string): string[] {
  return getSessionRuntimeState(sessionId)?.selectedRepos ?? [];
}

export function setSessionSelectedRepos(
  sessionId: string,
  selectedRepos: string[] | null | undefined,
): SessionStateRecord {
  return upsertSessionRuntimeState(sessionId, { selectedRepos });
}

export function resolveOwnedWebSessionRuntimeContext(
  requestedSessionId: string,
  ownerUuid: string,
  options: {
    allowClosed?: boolean;
    requireSessionState?: boolean;
    requireWorkspace?: boolean;
  } = {},
): WebSessionRuntimeAccessResult {
  const existingSessionId = resolveExistingWebSessionId(requestedSessionId);
  if (!existingSessionId) {
    return {
      ok: false,
      error: {
        status: 404,
        type: "not_found",
        message: "Session not found",
      },
    };
  }

  const sessionId = resolveOwnedWebSessionId(requestedSessionId, ownerUuid);
  if (!sessionId) {
    return {
      ok: false,
      error: {
        status: 403,
        type: "forbidden",
        message: "Not your session",
      },
    };
  }

  const session = getSession(sessionId);
  if (!session) {
    return {
      ok: false,
      error: {
        status: 404,
        type: "not_found",
        message: "Session not found",
      },
    };
  }

  if (!options.allowClosed && isSessionClosedStatus(session.status)) {
    return {
      ok: false,
      error: {
        status: 409,
        type: "session_closed",
        message: `Session is ${session.status}`,
      },
    };
  }

  const context = buildWebSessionRuntimeContext(
    requestedSessionId,
    sessionId,
    ownerUuid,
    session,
  );

  if (options.requireWorkspace && !context.workspace?.workspacePath) {
    return {
      ok: false,
      error: {
        status: 409,
        type: "missing_workspace",
        message: "Session workspace is not initialized",
      },
    };
  }

  if (options.requireSessionState && !context.sessionState) {
    return {
      ok: false,
      error: {
        status: 409,
        type: "missing_state",
        message: "Session state is not initialized",
      },
    };
  }

  return {
    ok: true,
    context,
  };
}
