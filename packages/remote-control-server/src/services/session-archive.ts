import { log } from "../logger";
import {
  storeGetSession,
  storeGetWorkspaceBySession,
  storeUpdateSession,
  storeListSessions,
  type SessionRecord,
} from "../store";
import { dematerializeWorkspace, type DematerializeResult } from "./materialize";
import { getEventBus, removeEventBus } from "../transport/event-bus";

export interface ArchiveResult {
  success: boolean;
  sessionId: string;
  dematerialized: boolean;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  sessionId: string;
  error?: string;
}

export async function archiveSession(sessionId: string): Promise<ArchiveResult> {
  log(`[session-archive] archiving session=${sessionId}`);

  const session = storeGetSession(sessionId);
  if (!session) {
    return { success: false, sessionId, dematerialized: false, error: "Session not found" };
  }

  if (session.status === "archived") {
    return { success: false, sessionId, dematerialized: false, error: "Session is already archived" };
  }

  const workspace = storeGetWorkspaceBySession(sessionId);
  let dematerialized = false;

  if (workspace?.materializationStrategy && workspace.workspacePath) {
    log(`[session-archive] dematerializing workspace=${workspace.id} strategy=${workspace.materializationStrategy}`);

    const dematerializeResult: DematerializeResult = await dematerializeWorkspace(
      workspace.workspacePath,
      workspace.materializationStrategy,
      workspace.repoRoot ?? undefined,
    );

    if (dematerializeResult.success) {
      dematerialized = true;
      log(`[session-archive] workspace dematerialized successfully`);
    } else {
      log(`[session-archive] workspace dematerialization failed: ${dematerializeResult.error}`);
    }
  }

  storeUpdateSession(sessionId, { status: "archived" });

  removeEventBus(sessionId);

  log(`[session-archive] session archived successfully`);

  return {
    success: true,
    sessionId,
    dematerialized,
  };
}

export async function restoreArchivedSession(sessionId: string): Promise<RestoreResult> {
  log(`[session-archive] restoring archived session=${sessionId}`);

  const session = storeGetSession(sessionId);
  if (!session) {
    return { success: false, sessionId, error: "Session not found" };
  }

  if (session.status !== "archived") {
    return { success: false, sessionId, error: "Session is not archived" };
  }

  storeUpdateSession(sessionId, { status: "idle" });

  log(`[session-archive] session restored successfully`);

  return { success: true, sessionId };
}

export function listArchivedSessions(environmentId?: string): SessionRecord[] {
  log(`[session-archive] listing archived sessions environmentId=${environmentId ?? "all"}`);

  const allSessions = storeListSessions();

  const archivedSessions = allSessions.filter((session) => {
    if (session.status !== "archived") {
      return false;
    }
    if (environmentId && session.environmentId !== environmentId) {
      return false;
    }
    return true;
  });

  log(`[session-archive] found ${archivedSessions.length} archived sessions`);

  return archivedSessions;
}

export function isSessionArchived(sessionId: string): boolean {
  const session = storeGetSession(sessionId);
  return session?.status === "archived";
}