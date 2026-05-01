import { Hono } from "hono";
import { sessionIngressAuth, acceptCliHeaders } from "../../auth/middleware";
import { createWorkerEventStream, resolveReplayCursor } from "../../transport/sse-writer";
import { getSession } from "../../services/session";

const app = new Hono();

/** SSE /v1/code/sessions/:id/worker/events/stream — SSE event stream */
app.get("/:id/worker/events/stream", acceptCliHeaders, sessionIngressAuth, async (c) => {
  const sessionId = c.req.param("id")!;
  const session = getSession(sessionId);
  if (!session) {
    return c.json({ error: { type: "not_found", message: "Session not found" } }, 404);
  }

  // Support Last-Event-ID / from_sequence_num for reconnection
const fromSeqNum = resolveReplayCursor(new URL(c.req.url).searchParams, c.req.raw.headers);
  return createWorkerEventStream(c, sessionId, fromSeqNum);
});

export default app;
