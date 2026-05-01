import { join } from "node:path";
import { resolveWorkspaceRoot } from "./workspace-root";

export type WorkspaceMaterializationStrategy = "worktree" | "workdir";

export type WorkspaceLayout = {
  root: string;
  sessionsRoot: string;
  worktreesRoot: string;
  workdirsRoot: string;
  indexDbPath: string;
};

export type SessionWorkspacePaths = WorkspaceLayout & {
  sessionId: string;
  sessionSlug: string;
  sessionRoot: string;
  sessionJsonPath: string;
  stateJsonPath: string;
  workerJsonPath: string;
  transcriptPath: string;
  logsRoot: string;
  eventsRoot: string;
  worktreePath: string;
  workdirPath: string;
  workspacePath: string;
  materializationStrategy: WorkspaceMaterializationStrategy;
};

const PATH_SEPARATOR_PATTERN = /[\\/]/;

export function validateWorkspaceSessionId(sessionId: string): string {
  if (sessionId.length === 0) {
    throw new Error("sessionId must not be empty");
  }
  if (sessionId === "." || sessionId === "..") {
    throw new Error('sessionId must not be "." or ".."');
  }
  if (PATH_SEPARATOR_PATTERN.test(sessionId)) {
    throw new Error("sessionId must not contain path separators");
  }
  if (sessionId.includes("\0")) {
    throw new Error("sessionId must not contain NUL bytes");
  }
  return sessionId;
}

export function resolveWorkspaceLayout(root = resolveWorkspaceRoot()): WorkspaceLayout {
  const workspaceRoot = resolveWorkspaceRoot(root);
  return {
    root: workspaceRoot,
    sessionsRoot: join(workspaceRoot, "sessions"),
    worktreesRoot: join(workspaceRoot, "worktrees"),
    workdirsRoot: join(workspaceRoot, "workdirs"),
    indexDbPath: join(workspaceRoot, "index.sqlite"),
  };
}

export function resolveSessionWorkspacePaths(input: {
  sessionId: string;
  root?: string;
  materializationStrategy?: WorkspaceMaterializationStrategy;
}): SessionWorkspacePaths {
  const layout = resolveWorkspaceLayout(input.root);
  const sessionSlug = validateWorkspaceSessionId(input.sessionId);
  const materializationStrategy = input.materializationStrategy ?? "worktree";
  const sessionRoot = join(layout.sessionsRoot, sessionSlug);
  const worktreePath = join(layout.worktreesRoot, sessionSlug);
  const workdirPath = join(layout.workdirsRoot, sessionSlug);

  return {
    ...layout,
    sessionId: input.sessionId,
    sessionSlug,
    sessionRoot,
    sessionJsonPath: join(sessionRoot, "session.json"),
    stateJsonPath: join(sessionRoot, "state.json"),
    workerJsonPath: join(sessionRoot, "worker.json"),
    transcriptPath: join(sessionRoot, "transcript.ndjson"),
    logsRoot: join(sessionRoot, "logs"),
    eventsRoot: join(sessionRoot, "events"),
    worktreePath,
    workdirPath,
    workspacePath: materializationStrategy === "workdir" ? workdirPath : worktreePath,
    materializationStrategy,
  };
}
