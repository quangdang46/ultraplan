import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_WORKSPACE_ROOT_NAME = ".workspace";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SRC_DIR, "../../..");

/**
 * Anchor workspace state to the repo root, not the caller's launch cwd.
 * This keeps sessionId -> workspacePath deterministic across process restarts.
 */
export const REMOTE_CONTROL_SERVER_ROOT = REPO_ROOT;

export function resolveWorkspaceRoot(root = process.env.RCS_WORKSPACE_ROOT): string {
  const candidate = root?.trim() ? root.trim() : DEFAULT_WORKSPACE_ROOT_NAME;
  return resolve(REMOTE_CONTROL_SERVER_ROOT, candidate);
}
