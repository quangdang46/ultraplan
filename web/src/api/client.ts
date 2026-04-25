// API client for Ultraplan backend
import type {
  AuthInitResponse,
  AuthVerifyResponse,
  AuthValidateResponse,
  ChatRequest,
  ServerEvent,
  StateResponse,
  ToolsResponse,
  SessionsResponse,
  ApiError,
} from './types';

const DEFAULT_BASE_URL = 'http://localhost:8080';

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
      throw new Error((data as ApiError).error || 'Request failed');
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
    message: string,
    onEvent: (event: ServerEvent) => void
  ): AsyncGenerator<ServerEvent> {
    if (!this.apiKey) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${this.baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ message }),
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

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            const eventType = line.slice(7).trim();
            continue;
          }
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (!dataStr) continue;

            try {
              const parsed = JSON.parse(dataStr);
              // The SSE data format is: event: <type>\ndata: {"type":"...",...}
              // We need to extract the type from the parsed object
              const event = parsed as ServerEvent;
              if (event.type) {
                onEvent(event);
                yield event;
              }
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
  async sendMessage(message: string): Promise<void> {
    // This is handled via streamChat - kept for compatibility
    await this.streamChat(message, () => {});
  }

  // Other endpoints
  async getTools(): Promise<ToolsResponse> {
    return this.request<ToolsResponse>('/api/tools');
  }

  async getSessions(): Promise<SessionsResponse> {
    return this.request<SessionsResponse>('/api/sessions');
  }

  async getState(): Promise<StateResponse> {
    return this.request<StateResponse>('/api/state');
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
