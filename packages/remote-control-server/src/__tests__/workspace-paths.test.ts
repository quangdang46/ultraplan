import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createConfig, resolveManagedSessionPaths } from "../config";
import {
  resolveSessionWorkspacePaths,
  resolveWorkspaceLayout,
  validateWorkspaceSessionId,
} from "../workspace-paths";
import {
  DEFAULT_WORKSPACE_ROOT_NAME,
  REMOTE_CONTROL_SERVER_ROOT,
  resolveWorkspaceRoot,
} from "../workspace-root";

describe("workspace root resolution", () => {
  test("defaults to a repo-anchored .workspace root", () => {
    expect(resolveWorkspaceRoot(undefined)).toBe(
      join(REMOTE_CONTROL_SERVER_ROOT, DEFAULT_WORKSPACE_ROOT_NAME),
    );
  });

  test("resolves relative overrides from the repo root", () => {
    expect(resolveWorkspaceRoot("var/managed-web")).toBe(
      join(REMOTE_CONTROL_SERVER_ROOT, "var/managed-web"),
    );
  });
});

describe("workspace layout", () => {
  test("builds the canonical .workspace artifact roots", () => {
    const layout = resolveWorkspaceLayout("/tmp/rcs-workspace");

    expect(layout).toEqual({
      root: "/tmp/rcs-workspace",
      sessionsRoot: "/tmp/rcs-workspace/sessions",
      worktreesRoot: "/tmp/rcs-workspace/worktrees",
      workdirsRoot: "/tmp/rcs-workspace/workdirs",
      indexDbPath: "/tmp/rcs-workspace/index.sqlite",
    });
  });
});

describe("session workspace paths", () => {
  test("resolves inspectable session artifacts and default worktree materialization", () => {
    const paths = resolveSessionWorkspacePaths({
      root: "/tmp/rcs-workspace",
      sessionId: "session_deadbeef",
    });

    expect(paths.sessionRoot).toBe("/tmp/rcs-workspace/sessions/session_deadbeef");
    expect(paths.sessionJsonPath).toBe(
      "/tmp/rcs-workspace/sessions/session_deadbeef/session.json",
    );
    expect(paths.stateJsonPath).toBe(
      "/tmp/rcs-workspace/sessions/session_deadbeef/state.json",
    );
    expect(paths.workerJsonPath).toBe(
      "/tmp/rcs-workspace/sessions/session_deadbeef/worker.json",
    );
    expect(paths.transcriptPath).toBe(
      "/tmp/rcs-workspace/sessions/session_deadbeef/transcript.ndjson",
    );
    expect(paths.logsRoot).toBe(
      "/tmp/rcs-workspace/sessions/session_deadbeef/logs",
    );
    expect(paths.eventsRoot).toBe(
      "/tmp/rcs-workspace/sessions/session_deadbeef/events",
    );
    expect(paths.worktreePath).toBe("/tmp/rcs-workspace/worktrees/session_deadbeef");
    expect(paths.workdirPath).toBe("/tmp/rcs-workspace/workdirs/session_deadbeef");
    expect(paths.workspacePath).toBe(paths.worktreePath);
    expect(paths.materializationStrategy).toBe("worktree");
  });

  test("switches workspacePath when workdir materialization is requested", () => {
    const paths = resolveSessionWorkspacePaths({
      root: "/tmp/rcs-workspace",
      sessionId: "cse_deadbeef",
      materializationStrategy: "workdir",
    });

    expect(paths.workspacePath).toBe("/tmp/rcs-workspace/workdirs/cse_deadbeef");
    expect(paths.materializationStrategy).toBe("workdir");
  });

  test("rejects unsafe session IDs", () => {
    expect(() => validateWorkspaceSessionId("")).toThrow(
      "sessionId must not be empty",
    );
    expect(() => validateWorkspaceSessionId("../escape")).toThrow(
      "sessionId must not contain path separators",
    );
    expect(() => validateWorkspaceSessionId("..")).toThrow(
      'sessionId must not be "." or ".."',
    );
    expect(() => validateWorkspaceSessionId("session\\nested")).toThrow(
      "sessionId must not contain path separators",
    );
  });
});

describe("config integration", () => {
  test("keeps the workspace root configurable without scattering callers", () => {
    const customConfig = createConfig({
      RCS_WORKSPACE_ROOT: "tmp/custom-state",
      RCS_PORT: "9999",
    });

    expect(customConfig.workspaceRoot).toBe(
      join(REMOTE_CONTROL_SERVER_ROOT, "tmp/custom-state"),
    );
    expect(customConfig.workspace.root).toBe(customConfig.workspaceRoot);
    expect(customConfig.workspace.sessionsRoot).toBe(
      join(customConfig.workspaceRoot, "sessions"),
    );
  });

  test("keeps absolute overrides stable", () => {
    const customConfig = createConfig({
      RCS_WORKSPACE_ROOT: "/var/lib/rcs-state",
    });

    expect(customConfig.workspaceRoot).toBe("/var/lib/rcs-state");
    expect(customConfig.workspace.root).toBe("/var/lib/rcs-state");
  });

  test("resolves managed session paths from config in one place", () => {
    const customConfig = createConfig({
      RCS_WORKSPACE_ROOT: "/var/lib/rcs-state",
    });

    const paths = resolveManagedSessionPaths(
      "session_1234",
      "workdir",
      customConfig,
    );

    expect(paths.sessionRoot).toBe("/var/lib/rcs-state/sessions/session_1234");
    expect(paths.workspacePath).toBe("/var/lib/rcs-state/workdirs/session_1234");
  });
});
