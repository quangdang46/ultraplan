// API client for Ultraplan backend
import type {
  AuthInitResponse,
  AuthVerifyResponse,
  AuthValidateResponse,
  ChatControlRequest,
  CommandSuggestionsResponse,
  ExecuteCommandRequest,
  ExecuteCommandResponse,
  FileSuggestionsResponse,
  ChatStreamRequest,
  ServerEvent,
  ReplyQuote,
  StateResponse,
  ToolsResponse,
  SessionsResponse,
  ApiError,
  SessionMessage,
  Session,
} from './types';

function getDefaultBaseUrl(): string {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (typeof window === 'undefined') {
    // Use same origin for API calls (works in dev and production behind RCS)
    return (typeof window !== "undefined" ? window.location.origin : "http://localhost:8080");
  }

  if (import.meta.env.DEV) {
    return '';
  }

  return `${window.location.protocol}//${window.location.hostname}:8080`;
}

const DEFAULT_BASE_URL = getDefaultBaseUrl();

export class ApiClientError extends Error {
  code: string;
  authDomain?: string;

  constructor(code: string, message: string, authDomain?: string) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.authDomain = authDomain;
  }
}

export interface SessionHistoryResponse {
  messages: SessionMessage[];
  lastSeqNum: number;
}

export interface RewindSessionResponse {
  success: boolean;
  userMessageId?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

class ApiClient {
  private baseUrl: string;
  private apiKey: string | null = null;

  constructor(baseUrl: string = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl;
    this.loadApiKey();
  }

  private loadApiKey(): void {
    if (typeof window !== 'undefined') {
      this.apiKey = localStorage.getItem('ultraplan_api_key');
    }
  }

  private saveApiKey(key: string): void {
    this.apiKey = key;
    if (typeof window !== 'undefined') {
      localStorage.setItem('ultraplan_api_key', key);
    }
  }

  clearApiKey(): void {
    this.apiKey = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('ultraplan_api_key');
    }
  }

  hasApiKey(): boolean {
    return this.apiKey !== null;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    const text = await response.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: 'INVALID_JSON', message: text || 'Invalid JSON response' };
    }

    if (!response.ok) {
      const payload = data as ApiError & { auth_domain?: string };
      throw new ApiClientError(
        payload.error || 'REQUEST_FAILED',
        payload.message || payload.error || 'Request failed',
        payload.auth_domain,
      );
    }

    return data as T;
  }

  // Auth endpoints
  async authInit(): Promise<AuthInitResponse> {
    return this.request<AuthInitResponse>('/api/auth/init', {
      method: 'POST',
    });
  }

  async authVerify(tempToken: string): Promise<AuthVerifyResponse> {
    const data = await this.request<AuthVerifyResponse>('/api/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ tempToken }),
    });
    this.saveApiKey(data.apiKey);
    return data;
  }

  async authValidate(): Promise<AuthValidateResponse> {
    return this.request<AuthValidateResponse>('/api/auth/validate');
  }

  // Chat endpoint (SSE streaming)
  async *streamChat(
    request: ChatStreamRequest,
    options: { signal?: AbortSignal } = {}
  ): AsyncGenerator<ServerEvent> {
    if (!this.apiKey) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${this.baseUrl}/api/chat/stream`, {
      method: 'POST',
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(async () => {
        const text = await response.text().catch(() => '');
        return { error: text || 'Stream request failed' };
      });
      throw new Error(error.error || 'Stream request failed');
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            try {
              const parsed = JSON.parse(dataStr);
              // Server always sends `event: message`, so we must prioritize parsed.type
              const eventType = (parsed.type || currentEventType) as ServerEvent['type'];
              // RCS SSE sends { type, payload, direction, seqNum }
              // ServerEvent expects { type, data }
              const data = parsed.data ?? parsed.payload ?? parsed;
              const event: ServerEvent & { seqNum?: number } = { type: eventType, data };
              const seqNum = Number(parsed.seqNum ?? parsed.seq_num);
              if (Number.isFinite(seqNum) && seqNum > 0) {
                event.seqNum = seqNum;
              }
              console.log("[streamChat] Yielding event:", eventType, data);
              yield event;
            } catch (err) {
              console.error("[streamChat] JSON parse error on data:", dataStr, err);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async *streamSessionEvents(
    sessionId: string,
    options: { signal?: AbortSignal } = {},
    fromSeqNum?: number,
  ): AsyncGenerator<ServerEvent> {
    if (!this.apiKey) {
      throw new Error('Not authenticated');
    }

    const params = new URLSearchParams();
    if (typeof fromSeqNum === 'number' && fromSeqNum > 0) {
      params.set('from', String(fromSeqNum));
    }
    const query = params.toString();
    const url = query
      ? `${this.baseUrl}/api/sessions/${sessionId}/stream?${query}`
      : `${this.baseUrl}/api/sessions/${sessionId}/stream`;

    const response = await fetch(
      url,
      {
        method: 'GET',
        signal: options.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Session stream request failed');
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEventType = '';
    let currentEventId = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('id: ')) {
            currentEventId = line.slice(4).trim();
            continue;
          }
          if (line.startsWith('event: ')) {
            currentEventType = line.slice(7).trim();
            continue;
          }
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            try {
              const parsed = JSON.parse(dataStr);
              const eventType = (parsed.type || currentEventType) as ServerEvent['type'];
              const data = parsed.data ?? parsed.payload ?? parsed;
              const event: ServerEvent & { seqNum?: number } = { type: eventType, data };
              const seqNum = Number(parsed.seqNum ?? parsed.seq_num ?? currentEventId);
              if (Number.isFinite(seqNum) && seqNum > 0) {
                event.seqNum = seqNum;
              }
              console.log("[streamSessionEvents] Yielding event:", eventType, data);
              yield event;
              currentEventId = '';
            } catch (err) {
              console.error("[streamSessionEvents] JSON parse error on data:", dataStr, err);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // Tool chat message (non-streaming convenience)
  async sendMessage(message: string, quote?: ReplyQuote, sessionId?: string): Promise<void> {
    // This is handled via streamChat - kept for compatibility
    await this.streamChat({ message, quote, sessionId });
  }

  async respondToPermission(request: ChatControlRequest): Promise<void> {
    await this.request<{ success: boolean }>('/api/chat/control', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async interruptSession(sessionId: string): Promise<void> {
    await this.request<{ success: boolean }>('/api/chat/interrupt', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  }

  // Other endpoints
  async getTools(): Promise<ToolsResponse> {
    return this.request<ToolsResponse>('/api/tools');
  }

  async getSessions(): Promise<SessionsResponse> {
    return this.request<SessionsResponse>('/api/sessions');
  }

  async getSessionHistory(sessionId: string): Promise<SessionHistoryResponse> {
    const response = await this.request<
      { messages: SessionMessage[]; lastSeqNum?: number }
    >(`/api/sessions/${sessionId}/messages`);
    return {
      messages: response.messages,
      lastSeqNum:
        typeof response.lastSeqNum === 'number' && response.lastSeqNum > 0
          ? response.lastSeqNum
          : 0,
    };
  }

  async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    return this.getSessionHistory(sessionId).then((r) => r.messages);
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.request<{ session: Session }>(
      `/api/sessions/${sessionId}`
    ).then((r) => r.session);
  }

  async createSession(cwd?: string): Promise<Session> {
    return this.request<{ session: Session }>('/api/sessions', {
      method: 'POST',
      body: cwd ? JSON.stringify({ cwd }) : '{}',
    }).then((r) => r.session);
  }

  async forkSession(sessionId: string): Promise<Session> {
    return this.request<{ session: Session }>(`/api/sessions/${sessionId}/fork`, {
      method: 'POST',
      body: '{}',
    }).then((r) => r.session);
  }

  async killSession(sessionId: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });
  }

  async renameSession(sessionId: string, name: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
  }

  async getState(sessionId?: string): Promise<StateResponse> {
    const params = sessionId
      ? `?sessionId=${encodeURIComponent(sessionId)}`
      : '';
    return this.request<StateResponse>(`/api/state${params}`);
  }

  async updateState(
    patch: {
      sessionId?: string;
      model?: string | null;
      permissionMode?: string | null;
      thinkingEffort?: string | null;
    },
  ): Promise<{
    success: boolean;
    model?: string | null;
    permissionMode?: string | null;
    thinkingEffort?: string | null;
  }> {
    return this.request('/api/state', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  async suggestFiles(query: string, cwd?: string, sessionId?: string): Promise<FileSuggestionsResponse> {
    const params = new URLSearchParams({ q: query });
    if (cwd) params.set('cwd', cwd);
    if (sessionId) params.set('sessionId', sessionId);
    const response = await this.request<
      FileSuggestionsResponse | { suggestions: FileSuggestionsResponse }
    >(`/api/suggest/files?${params.toString()}`);
    return 'suggestions' in response ? response.suggestions : response;
  }

  async suggestCommands(query: string, cwd?: string, sessionId?: string): Promise<CommandSuggestionsResponse> {
    const params = new URLSearchParams({ q: query });
    if (cwd) params.set('cwd', cwd);
    if (sessionId) params.set('sessionId', sessionId);
    const response = await this.request<
      CommandSuggestionsResponse | { suggestions: CommandSuggestionsResponse['items'] }
    >(`/api/suggest/commands?${params.toString()}`);
    if ('suggestions' in response) {
      return { items: response.suggestions };
    }
    return response;
  }

  async executeCommand(
    command: string,
    cwd?: string,
    sessionId?: string,
    userMessageId?: string,
  ): Promise<ExecuteCommandResponse> {
    const payload: ExecuteCommandRequest = {
      command,
      ...(sessionId ? { sessionId } : {}),
      ...(userMessageId ? { userMessageId } : {}),
    };
    const params = new URLSearchParams();
    if (cwd) params.set('cwd', cwd);
    const query = params.toString();
    const url = query ? `/api/command/execute?${query}` : '/api/command/execute';
    return this.request<ExecuteCommandResponse>(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Health check (includes server epoch for restart detection)
  async getHealth(): Promise<{ status: string; version: string; epoch: number }> {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }

  // Context window breakdown
  async getContext(sessionId: string): Promise<{
    maxTokens: number;
    totalInput: number;
    totalOutput: number;
    breakdown: Array<{ category: string; tokens: number; pct: number }>;
    usedPct: number;
  }> {
    return this.request(`/api/context?sessionId=${encodeURIComponent(sessionId)}`);
  }

  // Usage + cost
  async getUsage(): Promise<{
    totalInput: number;
    totalOutput: number;
    cost: { input: number; output: number; total: number };
    rateLimit: {
      sessionLimit: number;
      sessionUsed: number;
      sessionPct: number;
      resetAt: string | null;
    };
  }> {
    return this.request('/api/usage');
  }

  // Prompt history
  async getHistory(limit?: number): Promise<{
    prompts: Array<{ text: string; sessionId: string; timestamp: string }>;
  }> {
    const params = limit ? `?limit=${limit}` : '';
    return this.request(`/api/history${params}`);
  }

  // Workspace search
  async searchWorkspace(query: string, limit?: number, cwd?: string, sessionId?: string): Promise<{
    results: Array<{
      file: string;
      line: number;
      col?: number;
      text: string;
      matchStart?: number;
      matchEnd?: number;
    }>;
  }> {
    const params = new URLSearchParams({ q: query });
    if (limit) params.set('limit', String(limit));
    if (cwd) params.set('cwd', cwd);
    if (sessionId) params.set('sessionId', sessionId);
    return this.request(`/api/search?${params.toString()}`);
  }

  // Rewind last turn
  async rewindSession(sessionId: string): Promise<RewindSessionResponse> {
    return this.request<RewindSessionResponse>(`/api/sessions/${sessionId}/rewind`, {
      method: 'POST',
      body: '{}',
    });
  }

  // Resume interrupted session
  async resumeSession(sessionId: string): Promise<{ success: boolean; status: string }> {
    return this.request<{ success: boolean; status: string }>(`/api/sessions/${sessionId}/resume`, {
      method: 'POST',
    });
  }

  // MCP server management
  async getMcpServers(cwd?: string, sessionId?: string): Promise<{
    servers: Array<{
      name: string;
      command: string;
      args: string[];
      env: Record<string, string>;
      status: string;
    }>;
  }> {
    const params = new URLSearchParams();
    if (cwd) params.set('cwd', cwd);
    if (sessionId) params.set('sessionId', sessionId);
    const query = params.toString();
    const url = query ? `/api/mcp?${query}` : '/api/mcp';
    return this.request(url);
  }

  async addMcpServer(
    name: string,
    command: string,
    cwd: string | undefined,
    args?: string[],
    env?: Record<string, string>,
    sessionId?: string,
  ): Promise<void> {
    await this.request('/api/mcp', {
      method: 'POST',
      body: JSON.stringify({
        name,
        command,
        ...(cwd ? { cwd } : {}),
        ...(sessionId ? { sessionId } : {}),
        args: args ?? [],
        env: env ?? {},
      }),
    });
  }

  async deleteMcpServer(name: string, cwd?: string, sessionId?: string): Promise<void> {
    const params = new URLSearchParams();
    if (cwd) params.set('cwd', cwd);
    if (sessionId) params.set('sessionId', sessionId);
    const query = params.toString();
    const url = query
      ? `/api/mcp/${encodeURIComponent(name)}?${query}`
      : `/api/mcp/${encodeURIComponent(name)}`;
    await this.request(url, {
      method: 'DELETE',
    });
  }

  // Memory files (CLAUDE.md)
  async getMemoryFiles(cwd?: string, sessionId?: string): Promise<{
    files: Array<{ path: string; content: string }>;
  }> {
    const params = new URLSearchParams();
    if (cwd) params.set('cwd', cwd);
    if (sessionId) params.set('sessionId', sessionId);
    const query = params.toString();
    const url = query ? `/api/memory?${query}` : '/api/memory';
    return this.request(url);
  }

  async saveMemoryFile(path: string, content: string, cwd?: string, sessionId?: string): Promise<void> {
    await this.request('/api/memory', {
      method: 'PUT',
      body: JSON.stringify({
        path,
        content,
        ...(cwd ? { cwd } : {}),
        ...(sessionId ? { sessionId } : {}),
      }),
    });
  }
}

// Singleton instance
let clientInstance: ApiClient | null = null;

export function getApiClient(baseUrl?: string): ApiClient {
  if (!clientInstance) {
    clientInstance = new ApiClient(baseUrl);
  }
  return clientInstance;
}

export type { ApiClient };
