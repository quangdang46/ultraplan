import { resolveOwnedWebSessionRuntimeContext } from "./session-runtime-context";

function resolveRequestedSessionId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function resolveWorkspaceCwdFromContext(
  runtime: ReturnType<typeof resolveOwnedWebSessionRuntimeContext>,
): string | null {
  if (!runtime.ok) {
    return null;
  }

  return (
    runtime.context.workspace?.workspacePath ||
    runtime.context.workspace?.sourceRoot ||
    null
  );
}

export function resolveOwnedWorkspaceCwd(input: {
  uuid: string;
  sessionId?: string | null;
  cwd?: string | null;
}): { ok: true; cwd: string } | { ok: false; status: number; error: string } {
  const requestedSessionId = resolveRequestedSessionId(input.sessionId);
  if (requestedSessionId) {
    const runtime = resolveOwnedWebSessionRuntimeContext(
      requestedSessionId,
      input.uuid,
      { allowClosed: true, requireWorkspace: true },
    );
    if (!runtime.ok) {
      return {
        ok: false,
        status: runtime.error.status,
        error: runtime.error.message,
      };
    }

    const workspaceCwd = resolveWorkspaceCwdFromContext(runtime);
    if (workspaceCwd) {
      return { ok: true, cwd: workspaceCwd };
    }
  }

  const requestedCwd = input.cwd?.trim();
  if (requestedCwd) {
    return { ok: true, cwd: requestedCwd };
  }

  // Final fallback: use DEFAULT_WORKSPACE env var or process.cwd()
  const defaultWorkspace = process.env.DEFAULT_WORKSPACE;
  return { ok: true, cwd: defaultWorkspace || process.cwd() };
}
