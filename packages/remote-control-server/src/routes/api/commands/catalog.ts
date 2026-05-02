import { Hono } from "hono";
import { uuidAuth } from "../../../auth/middleware";
import {
  getVisibleCommandsForWorkspace,
} from "../../../services/command/catalog";
import { resolveOwnedWorkspaceCwd } from "../../../services/workspace-access";

const app = new Hono();

app.get("/", uuidAuth, async (c) => {
  const uuid = c.get("uuid")!;
  const includeAll = c.req.query("all") === "true";
  const resolved = resolveOwnedWorkspaceCwd({
    uuid,
    sessionId: c.req.query("sessionId"),
    cwd: c.req.query("cwd"),
  });
  if (!resolved.ok) {
    return c.json({ error: resolved.error }, resolved.status);
  }

  const entries = await getVisibleCommandsForWorkspace(
    resolved.cwd,
    includeAll,
  );

  return c.json({ commands: entries });
});

export default app;
