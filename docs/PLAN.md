# Ultraplan Web UI + Backend Specification

## Overview

**Goal**: Create a web-based UI that replaces the terminal CLI experience, deployed on Vercel, connecting via tunnel to a local CLI process.

**Principle**: CLI remains unchanged. Backend is an ADDITION. Only `--server` flag and `connect` command are added to CLI.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Vercel (web deployed)                                          │
│  ┌─────────┐    ┌─────────────────────────────────────────────┐│
│  │  React  │───▶│  API Client                                  ││
│  │   UI    │◀───│  - Streaming via SSE                         ││
│  └─────────┘    │  - Auth token management                      ││
│                 │  - Tool permission handling                   ││
│                 └─────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │ HTTPS (tunnel URL)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  User's Local Machine                                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  CLI Process (Bun)                                           ││
│  │  ┌───────────────┐  ┌─────────────┐  ┌──────────────────────┐││
│  │  │ HTTP Server  │──│ QueryEngine │──│ Tool Execution Engine │││
│  │  │ (Hono/Fastify)│ │  (query.ts) │  │ (builtin-tools)       │││
│  │  └───────────────┘  └─────────────┘  └──────────────────────┘││
│  │         ▲                                                   ││
│  │  ┌──────┴──────┐                                            ││
│  │  │ Stream events│───▶ Real-time tool call progress          ││
│  │  │ (SSE)       │    - Tool started                          ││
│  │  │             │    - Output chunks                         ││
│  │  │             │    - Progress updates                      ││
│  │  │             │    - Tool completed                       ││
│  │  └─────────────┘                                            ││
│  └─────────────────────────────────────────────────────────────┘│
│           ▲                                                      │
│  ┌────────┴────────┐                                            │
│  │ ngrok/cloudflare│ (tunnel to expose local port)              │
│  └─────────────────┘                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
ultraplan/
├── src/
│   ├── entrypoints/
│   │   ├── cli.tsx              # Existing - UNCHANGED except --server flag
│   │   └── server.tsx           # NEW - HTTP server entry for backend
│   └── ...
│
├── packages/
│   ├── backend/                 # NEW - Backend HTTP API module
│   │   ├── src/
│   │   │   ├── index.ts         # Server factory (createServer)
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts      # Auth: init, verify, validate
│   │   │   │   ├── chat.ts      # Chat: send, stream, history
│   │   │   │   ├── tools.ts     # Tools: list, execute, approve
│   │   │   │   ├── sessions.ts  # Sessions: CRUD
│   │   │   │   └── state.ts     # State: get, update
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts      # API key validation
│   │   │   │   └── cors.ts      # CORS handling
│   │   │   ├── services/
│   │   │   │   ├── queryService.ts    # Wraps query engine
│   │   │   │   ├── toolService.ts      # Tool execution wrapper
│   │   │   │   ├── sessionService.ts  # Session management
│   │   │   │   └── streamService.ts   # SSE streaming manager
│   │   │   ├── types/
│   │   │   │   └── api.ts      # API type definitions
│   │   │   └── utils/
│   │   │       ├── logger.ts
│   │   │       └── errors.ts
│   │   └── package.json
│   │
│   └── remote-control-server/   # EXISTING - can reuse infrastructure
│
├── web/                        # EXISTING - modified to connect to backend
│   └── src/
│       ├── api/
│       │   ├── client.ts       # API client
│       │   ├── types.ts        # API types (shared with backend)
│       │   └── hooks/
│       │       ├── useChat.ts       # Chat operations
│       │       ├── useStream.ts     # SSE streaming
│       │       ├── useTools.ts      # Tool operations
│       │       ├── useAuth.ts       # Authentication
│       │       └── useSession.ts    # Session management
│       ├── components/
│       │   ├── claude/
│       │   │   ├── Conversation.tsx  # UPDATED: show streaming tool calls
│       │   │   ├── MessageRow.tsx     # UPDATED: tool call detail display
│       │   │   ├── ActionBar.tsx      # UPDATED: reply with streaming
│       │   │   ├── ToolProgress.tsx   # NEW: real-time tool progress UI
│       │   │   └── ToolOutput.tsx     # NEW: streaming output display
│       │   └── ...
│       └── pages/
│           └── Index.tsx        # UPDATED: wire up API
│
├── scripts/
│   └── dev-server.ts           # NEW - Dev mode: start CLI + server
│
└── docs/
    └── PLAN.md                 # This file
```

---

## API Specification

### Base URL Structure

```
https://<tunnel-url>/api/
```

### Authentication Flow

```
┌──────────┐                              ┌──────────┐
│ Web UI   │                              │ CLI      │
└────┬─────┘                              └────┬─────┘
     │                                        │
     │  POST /api/auth/init                   │
     │  ─────────────────────────────────▶   │
     │       { tempToken, authUrl }            │
     │                                        │
     │  User runs: claude connect             │
     │  (CLI opens web UI with token)          │
     │                                        │
     │  POST /api/auth/verify                  │
     │  ◀──────────────────────────────────   │
     │       { apiKey, expiresAt }             │
     │                                        │
     │  All subsequent requests include:       │
     │  Authorization: Bearer <apiKey>         │
     └────────────────────────────────────────┘
```

### Endpoints

#### Auth

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/init` | Generate temp token for connection |
| POST | `/api/auth/verify` | Exchange temp token for API key |
| GET | `/api/auth/validate` | Validate existing API key |

#### Chat

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Send message (non-streaming) |
| POST | `/api/chat/stream` | Stream response (SSE) |
| GET | `/api/chat/history` | Get conversation history |

#### Tools

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tools` | List all available tools |
| POST | `/api/tools/:name` | Execute tool directly |
| POST | `/api/tools/:name/approve` | Approve tool permission |

#### Sessions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List all sessions |
| POST | `/api/sessions` | Create new session |
| GET | `/api/sessions/:id` | Get session details |
| DELETE | `/api/sessions/:id` | Delete session |

#### State

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/state` | Get current app state |
| PUT | `/api/state/permission` | Update permission mode |

### Request/Response Types

```typescript
// ============ Chat ============

interface ChatRequest {
  message: string;
  attachments?: Attachment[];
  options?: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
  };
  context?: {
    replyToId?: string;
    parentMessageId?: string;
  };
}

// Streaming events sent via SSE
interface StreamEvent {
  type:
    | 'message_start'
    | 'message_id'
    | 'content_delta'
    | 'content_block_stop'
    | 'tool_call'
    | 'tool_call_delta'
    | 'tool_call_complete'
    | 'tool_result'
    | 'tool_result_delta'
    | 'tool_progress'
    | 'tool_permission_required'
    | 'message_end'
    | 'error';
  data: unknown;
}

// For 'tool_progress' event
interface ToolProgressEvent {
  toolCallId: string;
  toolName: string;
  status: 'started' | 'output' | 'progress' | 'completed' | 'error';
  output?: string;           // Partial output for streaming
  progress?: number;         // 0-100 progress percentage
  totalBytes?: number;       // For file operations
  bytesProcessed?: number;
  metadata?: {
    command?: string;         // For BashTool
    filePath?: string;        // For Read/Edit tools
    linesProcessed?: number;  // For grep
    linesMatched?: number;
  };
}

// For 'tool_call' event (shows in conversation)
interface ToolCallEvent {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  status: 'pending' | 'executing' | 'completed' | 'denied';
}

// For 'tool_result' event
interface ToolResultEvent {
  toolCallId: string;
  result: ContentBlock[];
  isError?: boolean;
}

// For 'tool_permission_required' event
interface ToolPermissionEvent {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  requiresApproval: boolean;
}

// Chat history
interface ChatHistoryResponse {
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor?: string;
}
```

```typescript
// ============ Messages ============

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: ContentBlock[];
  createdAt: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

interface ContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  source?: { type: 'upload' | 'remote'; url: string };
  toolUseId?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResultContent?: ContentBlock[];
  thinking?: string;         // For extended thinking
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'executing' | 'completed' | 'denied' | 'error';
  progressEvents?: ToolProgressEvent[];  // For display
}

interface ToolResult {
  toolUseId: string;
  toolName: string;
  content: ContentBlock[];
  isError: boolean;
}
```

```typescript
// ============ Tools ============

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  category: 'editor' | 'shell' | 'agent' | 'web' | 'system';
}

interface ToolExecutionRequest {
  input: Record<string, unknown>;
}

interface ToolExecutionResult {
  result: ContentBlock[];
  executionTimeMs: number;
}
```

```typescript
// ============ Sessions ============

interface Session {
  id: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  active: boolean;
}
```

```typescript
// ============ State ============

interface AppState {
  permissionMode: 'bypass-all' | 'per-tool' | 'ask';
  approvedTools: string[];
  pendingTools: ToolPermissionRequest[];
  model: string;
  tokenUsage: {
    inputTokens: number;
    outputTokens: number;
  };
  cwd: string;
  connected: boolean;
  connectionId?: string;
}

interface ToolPermissionRequest {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  timestamp: string;
}
```

```typescript
// ============ Errors ============

interface ApiError {
  success: false;
  error: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

type ErrorCode =
  | 'UNAUTHORIZED'
  | 'EXPIRED'
  | 'INVALID_INPUT'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_ERROR'
  | 'TOOL_PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'SESSION_NOT_FOUND'
  | 'CONNECTION_ERROR';
```

---

## Web UI - Real-time Tool Call Display

### Core Concept

**Tool execution is LIVE and STREAMING** - not just a final result block. The web UI shows tool progress in real-time, just like terminal.

### Tool Call Lifecycle in Web UI

```
1. User sends message
         │
         ▼
2. ASSISTANT_MESSAGE renders with tool call block
   ┌─────────────────────────────────────────┐
   │ 🤖 Assistant                           │
   │                                         │
   │ ┌─────────────────────────────────────┐│
   │ │ 🔧 BashTool                          ││
   │ │ > ls -la /data/projects/ultraplan   ││
   │ │                                      ││
   │ │ Status: Running...                   ││
   │ │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░ 45%     ││
   │ └─────────────────────────────────────┘│
   └─────────────────────────────────────────┘
         │
         ▼
3. STREAMING_OUTPUT - Output streams in real-time
   ┌─────────────────────────────────────────┐
   │ 🤖 Assistant                           │
   │                                         │
   │ ┌─────────────────────────────────────┐│
   │ │ 🔧 BashTool                          ││
   │ │ > ls -la /data/projects/ultraplan   ││
   │ │                                      ││
   │ │ drwxr-xr-x  quangdang  staff   320   ││
   │ │ drwxr-xr-x  quangdang  staff   160   ││
   │ │ -rw-r--r--  quangdang  staff  6144   ││
   │ │ (output streaming as it arrives)    ││
   │ │                                      ││
   │ │ ████████████████████░░░░░░░░░ 85%   ││
   │ └─────────────────────────────────────┘│
   └─────────────────────────────────────────┘
         │
         ▼
4. TOOL_COMPLETED - Final result
   ┌─────────────────────────────────────────┐
   │ 🤖 Assistant                           │
   │                                         │
   │ ┌─────────────────────────────────────┐│
   │ │ ✓ BashTool                           ││
   │ │ > ls -la /data/projects/ultraplan   ││
   │ │                                      ││
   │ │ (full output shown)                  ││
   │ │ Completed in 1.2s                   ││
   │ └─────────────────────────────────────┘│
   └─────────────────────────────────────────┘
```

### Component Structure

```
web/src/components/claude/
├── Conversation.tsx        # Main chat area - updated to show tool streams
├── MessageRow.tsx         # Single message - handles tool call display
├── ToolCallBlock.tsx      # NEW: Tool call with live progress
├── ToolProgress.tsx        # NEW: Progress bar + streaming output
├── ToolOutput.tsx          # NEW: Streaming text output
└── SelectionTooltip.tsx   # Existing - unchanged
```

### ToolCallBlock Component

```typescript
// web/src/components/claude/ToolCallBlock.tsx

interface ToolCallBlockProps {
  toolCall: ToolCall;
  isStreaming?: boolean;  // If currently streaming output
}

export function ToolCallBlock({ toolCall, isStreaming }: ToolCallBlockProps) {
  const status = toolCall.status;
  const isPending = status === 'pending';
  const isExecuting = status === 'executing' || isStreaming;
  const isCompleted = status === 'completed';
  const isError = status === 'error';
  const isDenied = status === 'denied';

  return (
    <div className={cn(
      "tool-call-block",
      "rounded-lg border p-3",
      isPending && "border-yellow-500 bg-yellow-50",
      isExecuting && "border-blue-500 bg-blue-50",
      isCompleted && "border-green-500 bg-green-50",
      isError && "border-red-500 bg-red-50",
      isDenied && "border-gray-500 bg-gray-50 opacity-60"
    )}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <ToolIcon name={toolCall.name} className="w-4 h-4" />
        <span className="font-medium text-sm">{toolCall.name}</span>
        <StatusBadge status={status} />
      </div>

      {/* Command/Input */}
      <div className="text-sm font-mono bg-black/5 p-2 rounded mb-2">
        {formatToolInput(toolCall)}
      </div>

      {/* Progress/Streaming Output */}
      {isExecuting && (
        <div className="space-y-2">
          {/* Progress bar */}
          {toolCall.progress !== undefined && (
            <ProgressBar percent={toolCall.progress} />
          )}

          {/* Streaming output */}
          <div className="tool-output font-mono text-xs bg-black/80 text-green-400 p-2 rounded overflow-x-auto">
            {toolCall.outputStream ?? ''}
            <BlinkingCursor />
          </div>
        </div>
      )}

      {/* Final output (after completed) */}
      {isCompleted && toolCall.output && (
        <div className="tool-output font-mono text-xs bg-black/80 text-green-400 p-2 rounded overflow-x-auto">
          {toolCall.output}
        </div>
      )}

      {/* Error message */}
      {isError && toolCall.error && (
        <div className="text-xs text-red-600">
          Error: {toolCall.error}
        </div>
      )}

      {/* Execution time */}
      {isCompleted && toolCall.executionTimeMs && (
        <div className="text-xs text-gray-500 mt-2">
          Completed in {toolCall.executionTimeMs}ms
        </div>
      )}
    </div>
  );
}
```

### Streaming Output Component

```typescript
// web/src/components/claude/ToolOutput.tsx

interface ToolOutputProps {
  output: string;
  isStreaming: boolean;
  className?: string;
}

export function ToolOutput({ output, isStreaming, className }: ToolOutputProps) {
  // Auto-scroll to bottom as output streams
  const containerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (isStreaming && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [output, isStreaming]);

  return (
    <div 
      ref={containerRef}
      className={cn(
        "font-mono text-xs bg-black/80 text-green-400 p-2 rounded overflow-x-auto whitespace-pre",
        className
      )}
    >
      {output}
      {isStreaming && <BlinkingCursor />}
    </div>
  );
}

function BlinkingCursor() {
  return (
    <span className="animate-pulse">▋</span>
  );
}
```

### Progress Bar Component

```typescript
// web/src/components/claude/ProgressBar.tsx

interface ProgressBarProps {
  percent: number;  // 0-100
  showLabel?: boolean;
}

export function ProgressBar({ percent, showLabel = true }: ProgressBarProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div 
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-gray-500 w-12 text-right">
          {percent}%
        </span>
      )}
    </div>
  );
}
```

### SSE Stream Handler

```typescript
// web/src/api/hooks/useStream.ts

interface UseStreamOptions {
  onToolCall?: (event: ToolCallEvent) => void;
  onToolProgress?: (event: ToolProgressEvent) => void;
  onToolResult?: (event: ToolResultEvent) => void;
  onMessageEnd?: (event: MessageEndEvent) => void;
}

export function useStream(options: UseStreamOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeToolCalls, setActiveToolCalls] = useState<Map<string, ToolCall>>(new Map());

  const sendMessage = async (data: ChatRequest) => {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(data),
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    // Create initial message
    const messageId = createId();
    const newMessage: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: [],
      toolCalls: [],
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, newMessage]);

    // Process SSE stream
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n');

      for (const line of lines) {
        if (!line.startsWith('event: ') && !line.startsWith('data: ')) continue;

        const type = line.startsWith('event: ') 
          ? line.slice(7).trim() 
          : null;
        const dataLine = lines.find(l => l.startsWith('data: '));
        const data = dataLine ? JSON.parse(dataLine.slice(5)) : null;

        if (!type || !data) continue;

        switch (type) {
          case 'tool_call':
            // New tool call started
            handleToolCall(data as ToolCallEvent);
            break;

          case 'tool_progress':
            // Streaming output/progress update
            handleToolProgress(data as ToolProgressEvent);
            break;

          case 'tool_result':
            // Tool completed
            handleToolResult(data as ToolResultEvent);
            break;

          case 'content_delta':
            // Text streaming
            handleContentDelta(data);
            break;

          case 'message_end':
            // Finalize message
            handleMessageEnd(data);
            break;
        }
      }
    }
  };

  const handleToolCall = (event: ToolCallEvent) => {
    setActiveToolCalls(prev => {
      const next = new Map(prev);
      next.set(event.toolCallId, {
        id: event.toolCallId,
        name: event.toolName,
        input: event.input,
        status: 'executing',
      });
      return next;
    });
  };

  const handleToolProgress = (event: ToolProgressEvent) => {
    setActiveToolCalls(prev => {
      const toolCall = prev.get(event.toolCallId);
      if (!toolCall) return prev;

      const next = new Map(prev);
      next.set(event.toolCallId, {
        ...toolCall,
        status: 'executing',
        outputStream: (toolCall.outputStream ?? '') + (event.output ?? ''),
        progress: event.progress,
        metadata: event.metadata,
      });
      return next;
    });
  };

  const handleToolResult = (event: ToolResultEvent) => {
    setActiveToolCalls(prev => {
      const toolCall = prev.get(event.toolCallId);
      if (!toolCall) return prev;

      const next = new Map(prev);
      next.set(event.toolCallId, {
        ...toolCall,
        status: 'completed',
        output: toolCall.outputStream,
      });
      return next;
    });
  };

  return { sendMessage, messages, activeToolCalls };
}
```

---

## CLI Changes (MINIMAL)

### 1. New `server.tsx` entry point

```typescript
// src/entrypoints/server.tsx

// This file ONLY loads when --server flag is passed
// Does NOT affect normal CLI operation

import { createServer } from 'packages/backend/src/index.js';

export async function serve(options: { port?: number }) {
  const port = options.port ?? 8080;
  const app = createServer();

  console.log(`🔌 Ultraplan API server running on http://localhost:${port}`);
  console.log(`   API docs: http://localhost:${port}/health`);

  Bun.serve({
    port,
    fetch: app.fetch,
    websocket: app.websocket,
  });
}
```

### 2. Modify `src/entrypoints/cli.tsx`

Add server flag handling (ONLY this change to CLI core):

```typescript
// Near the top, before existing fast paths
if (process.argv.includes('--server')) {
  const { serve } = await import('./server-entry.js');
  await serve({ port: parsePortArg() });
  process.exit(0);
}

// Rest of existing code unchanged...
```

### 3. New `connect` command

```typescript
// src/commands/connect.ts

import { Command } from 'commander';

export const connectCommand = new Command('connect')
  .description('Connect web UI to this CLI session')
  .option('-p, --port <port>', 'Port for local server', '8080')
  .action(async (options) => {
    // 1. Start local server on specified port
    // 2. Generate connection URL with token
    // 3. Open browser with web UI + token
    // 4. Handle auth handshake
    // 5. Show status
  });
```

Register in `main.tsx` (1 line add).

---

## Backend Implementation

### Server Setup (Hono)

```typescript
// packages/backend/src/index.ts

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth.js';
import { chatRoutes } from './routes/chat.js';
import { toolsRoutes } from './routes/tools.js';
import { sessionsRoutes } from './routes/sessions.js';
import { stateRoutes } from './routes/state.js';
import { authMiddleware } from './middleware/auth.js';

export function createServer() {
  const app = new Hono();

  // CORS
  app.use('*', cors({
    origin: (origin) => {
      // Allow Vercel domains and localhost in dev
      if (!origin || origin.startsWith('http://localhost')) return origin;
      if (origin.includes('.vercel.app') || origin.includes('vercel')) return origin;
      return origin;
    },
    credentials: true,
  }));

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

  // Auth routes (no auth required)
  app.route('/api/auth', authRoutes);

  // Protected routes
  app.use('/api/*', authMiddleware);
  app.route('/api/chat', chatRoutes);
  app.route('/api/tools', toolsRoutes);
  app.route('/api/sessions', sessionsRoutes);
  app.route('/api/state', stateRoutes);

  return app;
}
```

### Chat Streaming Implementation

```typescript
// packages/backend/src/routes/chat.ts

// POST /api/chat/stream - SSE for real-time streaming

chatRoutes.post('/stream', async (c) => {
  const body = await c.req.json<ChatRequest>();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (type: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        // This calls into the actual query engine
        await queryService.sendMessageStreaming({
          message: body.message,
          attachments: body.attachments,
          options: body.options,
          
          // Callbacks for streaming events
          onEvent: (event) => {
            sendEvent(event.type, event.data);
          },
          
          // Special handler for tool progress
          onToolProgress: (toolCallId, progress) => {
            sendEvent('tool_progress', {
              toolCallId,
              ...progress,
            });
          },
        });
      } catch (error) {
        sendEvent('error', { message: error.message });
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
    },
  });
});
```

### Tool Service with Progress Streaming

```typescript
// packages/backend/src/services/toolService.ts

// Wraps tool execution with progress callbacks

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  onProgress: (progress: ToolProgressEvent) => void
) {
  const tool = findToolByName(toolName);
  if (!tool) throw new Error(`Tool ${toolName} not found`);

  const toolCallId = generateId();
  
  // Start tool
  onProgress({
    toolCallId,
    toolName,
    status: 'started',
    metadata: extractMetadata(toolName, input),
  });

  // Execute with streaming output
  if (isStreamingTool(toolName)) {
    return executeStreamingTool(tool, input, (chunk) => {
      onProgress({
        toolCallId,
        toolName,
        status: 'output',
        output: chunk,
      });
    });
  }

  // Regular tool execution
  const result = await tool.execute(input);
  return result;
}

function isStreamingTool(toolName: string) {
  return ['Bash', 'Grep', 'Read'].includes(toolName);
}
```

---

## Implementation Phases

| Phase | Task | Key Files | Notes |
|-------|------|----------|-------|
| **Phase 1** | **Backend scaffold** | | Foundation |
| 1.1 | Create backend package structure | `packages/backend/src/` | |
| 1.2 | Implement Hono server with CORS | `packages/backend/src/index.ts` | |
| 1.3 | Auth routes (init, verify, validate) | `packages/backend/src/routes/auth.ts` | |
| 1.4 | Auth middleware | `packages/backend/src/middleware/auth.ts` | |
| 1.5 | Error handling utilities | `packages/backend/src/utils/errors.ts` | |
| **Phase 2** | **Tool execution** | | |
| 2.1 | Tool service wrapper | `packages/backend/src/services/toolService.ts` | |
| 2.2 | Tool routes (list, execute, approve) | `packages/backend/src/routes/tools.ts` | |
| 2.3 | Progress streaming for tools | In toolService | Streaming output |
| **Phase 3** | **Chat + streaming** | | |
| 3.1 | Query service wrapper | `packages/backend/src/services/queryService.ts` | |
| 3.2 | Chat routes with SSE | `packages/backend/src/routes/chat.ts` | |
| 3.3 | Stream service for real-time events | `packages/backend/src/services/streamService.ts` | |
| 3.4 | Tool progress → SSE events | In chat route | Real-time tool display |
| **Phase 4** | **Session management** | | |
| 4.1 | Session service | `packages/backend/src/services/sessionService.ts` | |
| 4.2 | Session routes | `packages/backend/src/routes/sessions.ts` | |
| 4.3 | State routes | `packages/backend/src/routes/state.ts` | |
| **Phase 5** | **CLI integration** | | Minimal changes |
| 5.1 | Server entry point | `src/entrypoints/server.tsx` | |
| 5.2 | `--server` flag parsing | `src/entrypoints/cli.tsx` | Only add flag |
| 5.3 | `connect` command | `src/commands/connect.ts` | New command |
| **Phase 6** | **Web API client** | | |
| 6.1 | API client setup | `web/src/api/client.ts` | |
| 6.2 | Auth hook | `web/src/api/hooks/useAuth.ts` | |
| 6.3 | Stream hook | `web/src/api/hooks/useStream.ts` | SSE handling |
| 6.4 | Tool hooks | `web/src/api/hooks/useTools.ts` | |
| **Phase 7** | **Web UI updates** | | |
| 7.1 | ToolCallBlock component | `web/src/components/claude/ToolCallBlock.tsx` | Real-time display |
| 7.2 | ToolProgress component | `web/src/components/claude/ProgressBar.tsx` | Progress bar |
| 7.3 | ToolOutput component | `web/src/components/claude/ToolOutput.tsx` | Streaming text |
| 7.4 | Update Conversation.tsx | `web/src/components/claude/Conversation.tsx` | Wire up streams |
| 7.5 | Update Index.tsx | `web/src/pages/Index.tsx` | Connect to API |

---

## Key Technical Decisions

### 1. SSE for Streaming
- HTTP POST to `/api/chat/stream` with request body
- Server responds with `text/event-stream`
- Client uses `fetch` + `ReadableStream` to parse events
- Events: `content_delta`, `tool_call`, `tool_progress`, `tool_result`, etc.

### 2. Tool Progress Events
```typescript
// Client receives these as SSE events
event: tool_progress
data: {"toolCallId":"tc_123","toolName":"Bash","status":"output","output":"drwxr-xr-x"}
data: {"toolCallId":"tc_123","toolName":"Bash","status":"output","output":"drwxr-xr-x  quangdang"}
data: {"toolCallId":"tc_123","toolName":"Bash","status":"progress","progress":45}
```

### 3. Authentication
- Temp token generated at `/api/auth/init`
- User runs `claude connect` in CLI (opens web UI)
- Token exchanged for API key
- API key stored in web UI localStorage
- All requests include `Authorization: Bearer <apiKey>`

### 4. No CLI Core Changes
- All new code in separate `packages/backend/`
- `--server` flag only loads when explicitly invoked
- Normal CLI operation completely unchanged

---

## Security Considerations

1. **API key expiration** - 24 hours default, can be refreshed
2. **CORS** - Only configured domains allowed
3. **Rate limiting** - 60 req/min per API key
4. **Tool permissions** - Must approve dangerous tools
5. **Tunnel security** - User is responsible for tunnel access control

---

## Future Enhancements (Out of Scope)

1. **Persistent API key storage** - Currently in-memory only
2. **Multi-user support** - Currently single user per CLI instance
3. **File upload via web** - Need special handling for large files
4. **Voice input** - Web speech API integration
5. **Mobile-optimized UI** - Responsive improvements
