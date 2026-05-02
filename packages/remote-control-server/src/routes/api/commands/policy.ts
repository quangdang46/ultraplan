import { Hono } from "hono";
import { uuidAuth } from "../../../auth/middleware";
import {
  getCommandForWorkspace,
  getCommandPolicy,
  isCommandAvailable,
} from "../../../services/command/catalog";
import type { CommandPolicy } from "../../../services/command/catalog";
import { resolveOwnedWorkspaceCwd } from "../../../services/workspace-access";

const app = new Hono();

app.get("/:id/policy", uuidAuth, async (c) => {
  const commandId = c.req.param("id");

  if (!commandId) {
    return c.json({ error: "command id is required" }, 400);
  }

  const uuid = c.get("uuid")!;
  const resolved = resolveOwnedWorkspaceCwd({
    uuid,
    sessionId: c.req.query("sessionId"),
    cwd: c.req.query("cwd"),
  });
  if (!resolved.ok) {
    return c.json({ error: resolved.error }, resolved.status);
  }

  const cmd = await getCommandForWorkspace(commandId, resolved.cwd);

  if (!cmd) {
    return c.json({ error: "Command not found" }, 404);
  }

  if (!isCommandAvailable(cmd)) {
    return c.json({ error: "Command not available due to feature flag" }, 403);
  }

  const policy: CommandPolicy = getCommandPolicy(cmd);

  return c.json({ policy });
});

export default app;
