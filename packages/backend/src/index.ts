// Backend HTTP server using native Bun APIs
// For web UI to connect via tunnel to local CLI

const HEADER_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...HEADER_CORS },
  });
}

// Auth state (in-memory for now)
const apiKeys = new Map<string, { expiresAt: number }>();

function generateApiKey(): string {
  return `sk_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function validateApiKey(auth: string | null): boolean {
  if (!auth) return false;
  const key = auth.replace('Bearer ', '');
  const entry = apiKeys.get(key);
  if (!entry) return false;
  return entry.expiresAt > Date.now();
}

export interface ServerOptions {
  port?: number;
}

export function createServer(options: ServerOptions = {}) {
  const port = options.port ?? parseInt(process.env.CLAUDE_CODE_SERVER_PORT || '8080');

  const server = {
    port,

    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: HEADER_CORS });
      }

      // Auth check for /api/* routes
      if (path.startsWith('/api/') && path !== '/api/auth/init' && path !== '/api/auth/verify') {
        if (!validateApiKey(req.headers.get('Authorization'))) {
          return createJsonResponse({ success: false, error: 'UNAUTHORIZED' }, 401);
        }
      }

      try {
        // GET /health
        if (req.method === 'GET' && path === '/health') {
          return createJsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
        }

        // POST /api/auth/init
        if (req.method === 'POST' && path === '/api/auth/init') {
          const tempToken = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
          return createJsonResponse({
            tempToken,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          });
        }

        // POST /api/auth/verify
        if (req.method === 'POST' && path === '/api/auth/verify') {
          const body = await req.json().catch(() => null) as { tempToken?: string } | null;
          if (!body?.tempToken?.startsWith('tmp_')) {
            return createJsonResponse({ success: false, error: 'INVALID_INPUT', message: 'Invalid token' }, 400);
          }
          const apiKey = generateApiKey();
          apiKeys.set(apiKey, { expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
          return createJsonResponse({
            apiKey,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          });
        }

        // GET /api/auth/validate
        if (req.method === 'GET' && path === '/api/auth/validate') {
          const auth = req.headers.get('Authorization');
          const valid = validateApiKey(auth);
          return createJsonResponse({ valid });
        }

        // POST /api/chat/stream (SSE)
        if (req.method === 'POST' && path === '/api/chat/stream') {
          const body = await req.json().catch(() => null) as { message?: string } | null;

          if (!body?.message) {
            return createJsonResponse({ success: false, error: 'NO_MESSAGE' }, 400);
          }

          const userMessage: string = body.message;

          const stream = new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();

              const send = (type: string, data: unknown) => {
                controller.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`));
              };

              try {
                // Import streamQuery dynamically to avoid circular deps
                const { streamQuery } = await import('./queryService.js');

                await streamQuery({
                  message: userMessage,
                  onEvent: (event) => send(event.type, event),
                });
              } catch (error) {
                send('error', { message: (error as Error).message });
              } finally {
                controller.close();
              }
            },
          });

          return new Response(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              ...HEADER_CORS,
            },
          });
        }

        // GET /api/tools
        if (req.method === 'GET' && path === '/api/tools') {
          return createJsonResponse({
            tools: [
              { name: 'Bash', description: 'Execute shell commands', category: 'shell' },
              { name: 'Read', description: 'Read file contents', category: 'editor' },
              { name: 'Edit', description: 'Edit file contents', category: 'editor' },
              { name: 'Grep', description: 'Search file contents', category: 'editor' },
            ],
          });
        }

        // GET /api/sessions
        if (req.method === 'GET' && path === '/api/sessions') {
          return createJsonResponse({ sessions: [], hasMore: false });
        }

        // GET /api/state
        if (req.method === 'GET' && path === '/api/state') {
          return createJsonResponse({
            permissionMode: 'per-tool',
            approvedTools: [],
            pendingTools: [],
            model: 'claude-3-5-sonnet-20241022',
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
            cwd: process.cwd(),
            connected: true,
          });
        }

        return createJsonResponse({ success: false, error: 'NOT_FOUND' }, 404);
      } catch (error) {
        return createJsonResponse({
          success: false,
          error: 'INTERNAL_ERROR',
          message: (error as Error).message
        }, 500);
      }
    },
  };

  return server;
}