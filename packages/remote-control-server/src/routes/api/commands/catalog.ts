import { Hono } from "hono";
import { uuidAuth } from "../../../auth/middleware";
import {
  STATIC_COMMAND_CATALOG,
  getVisibleCommands,
  isCommandAvailable,
  commandToCatalogEntry,
} from "../../../services/command/catalog";

const app = new Hono();

app.get("/", uuidAuth, async (c) => {
  const includeAll = c.req.query("all") === "true";

  const entries = getVisibleCommands(includeAll);

  return c.json({ commands: entries });
});

export default app;