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
    return 'http://localhost:8080';
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

    const data = await response.json();

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
      const error = await response.json();
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
              const event: ServerEvent = {
                type: (currentEventType || parsed.type) as ServerEvent['type'],
                data: parsed.data ?? parsed,
              };
              yield event;
            } catch {
              // Skip invalid JSON
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
  ): AsyncGenerator<ServerEvent> {
    if (!this.apiKey) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(
      `${this.baseUrl}/api/sessions/${sessionId}/stream`,
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
              const event: ServerEvent = {
                type: (currentEventType || parsed.type) as ServerEvent['type'],
                data: parsed.data ?? parsed,
              };
              yield event;
            } catch {
              // Skip invalid JSON
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

  // Other endpoints
  async getTools(): Promise<ToolsResponse> {
    return this.request<ToolsResponse>('/api/tools');
  }

  async getSessions(): Promise<SessionsResponse> {
    return this.request<SessionsResponse>('/api/sessions');
  }

  async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    return this.request<{ messages: SessionMessage[] }>(
      `/api/sessions/${sessionId}/messages`
    ).then((r) => r.messages);
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

  async getState(): Promise<StateResponse> {
    return this.request<StateResponse>('/api/state');
  }

  async suggestFiles(query: string, cwd?: string): Promise<FileSuggestionsResponse> {
    const params = new URLSearchParams({ q: query });
    if (cwd) params.set('cwd', cwd);
    const response = await this.request<
      FileSuggestionsResponse | { suggestions: FileSuggestionsResponse }
    >(`/api/suggest/files?${params.toString()}`);
    return 'suggestions' in response ? response.suggestions : response;
  }

  async suggestCommands(query: string, cwd?: string): Promise<CommandSuggestionsResponse> {
    const params = new URLSearchParams({ q: query });
    if (cwd) params.set('cwd', cwd);
    const response = await this.request<
      CommandSuggestionsResponse | { suggestions: CommandSuggestionsResponse['items'] }
    >(`/api/suggest/commands?${params.toString()}`);
    if ('suggestions' in response) {
      return { items: response.suggestions };
    }
    return response;
  }

  async executeCommand(command: string, cwd?: string): Promise<ExecuteCommandResponse> {
    const payload: ExecuteCommandRequest = { command };
    const params = new URLSearchParams();
    if (cwd) params.set('cwd', cwd);
    const query = params.toString();
    const url = query ? `/api/command/execute?${query}` : '/api/command/execute';
    return this.request<ExecuteCommandResponse>(url, {
      method: 'POST',
      body: JSON.stringify(payload),
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
