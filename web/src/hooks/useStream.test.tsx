import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { useStream } from './useStream';

const apiClient = {
  hasApiKey: vi.fn(() => true),
  authValidate: vi.fn(async () => ({ valid: true })),
  executeCommand: vi.fn(),
  getSessionHistory: vi.fn(),
  getState: vi.fn(async () => ({
    gitBranch: 'main',
    model: 'sonnet',
    permissionMode: 'default',
    cwd: '/repo',
  })),
};

vi.mock('../api/client', () => ({
  getApiClient: () => apiClient,
}));

vi.mock('../features/chat/streamTransport', () => ({
  ensureApiAuthenticated: vi.fn(async () => {}),
}));

describe('useStream executeSlashCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('rehydrates transcript when backend command execution requests history refresh', async () => {
    apiClient.executeCommand.mockResolvedValue({
      success: true,
      delegated: false,
      executionMode: 'prompt',
      webNative: true,
      sessionId: 'session-1',
      refreshHistory: true,
    });
    apiClient.getSessionHistory.mockResolvedValue({
      messages: [
        {
          role: 'user',
          content: 'restored user turn',
          timestamp: '2026-05-02T00:00:00.000Z',
        },
        {
          role: 'assistant',
          content: 'restored assistant turn',
          timestamp: '2026-05-02T00:00:01.000Z',
        },
      ],
      lastSeqNum: 12,
    });

    const { result } = renderHook(() => useStream());

    await act(async () => {
      await result.current.executeSlashCommand('/rewind', 'session-1');
    });

    await waitFor(() => {
      expect(apiClient.executeCommand).toHaveBeenCalledWith(
        '/rewind',
        undefined,
        'session-1',
        expect.any(String),
      );
      expect(apiClient.getSessionHistory).toHaveBeenCalledWith('session-1');
      expect(result.current.isStreaming).toBe(false);
    });

    expect(result.current.messages).toMatchObject([
      {
        role: 'user',
        content: 'restored user turn',
        toolCalls: [],
      },
      {
        role: 'assistant',
        content: 'restored assistant turn',
        toolCalls: [],
      },
    ]);
  });
});
