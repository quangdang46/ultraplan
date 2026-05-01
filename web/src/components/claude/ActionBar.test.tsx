import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { ActionBar } from './ActionBar';

const streamContext = {
  sessionId: null,
  sendMessage: vi.fn(async () => true),
  respondToPermission: vi.fn(async () => {}),
  executeSlashCommand: vi.fn(async () => {}),
  cancelStream: vi.fn(),
  isStreaming: false,
  messages: [],
  pendingPermissions: [],
  error: null,
  clearMessages: vi.fn(),
  loadMessages: vi.fn(),
};

const apiClient = {
  hasApiKey: vi.fn(() => true),
  authValidate: vi.fn(async () => ({ valid: true })),
  clearApiKey: vi.fn(),
  authInit: vi.fn(async () => ({ tempToken: 'temp-token' })),
  authVerify: vi.fn(async () => {}),
  getState: vi.fn(async () => ({
    gitBranch: "main",
    model: "sonnet",
    permissionMode: "default",
    cwd: "/repo",
  })),
  suggestFiles: vi.fn(async () => ({ items: [] })),
  suggestCommands: vi.fn(async () => ({ items: [] })),
};

vi.mock('../../hooks/useStreamContext', () => ({
  useStreamContext: () => streamContext,
}));

vi.mock('../../api/client', () => ({
  getApiClient: () => apiClient,
}));

describe('ActionBar quote submit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('sends quote payload and clears quote after success', async () => {
    const onClearQuote = vi.fn();
    render(<ActionBar quote="quoted text" onClearQuote={onClearQuote} />);

    const input = screen.getByPlaceholderText('Reply…');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(streamContext.sendMessage).toHaveBeenCalledWith('hello', {
        text: 'quoted text',
      }, undefined);
    });
    expect(onClearQuote).toHaveBeenCalledTimes(1);
  });

  test('escape clears quote when no suggestion popup', async () => {
    const onClearQuote = vi.fn();
    render(<ActionBar quote="quoted text" onClearQuote={onClearQuote} />);

    await waitFor(() => {
      expect(apiClient.getState).toHaveBeenCalled();
    });

    const input = screen.getByPlaceholderText('Reply…');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClearQuote).toHaveBeenCalledTimes(1);
  });

  test('submits quote-only reply without message text', async () => {
    const onClearQuote = vi.fn();
    render(<ActionBar quote="quote only" onClearQuote={onClearQuote} />);

    const input = screen.getByPlaceholderText('Reply…');
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(streamContext.sendMessage).toHaveBeenCalledWith('', {
        text: 'quote only',
      }, undefined);
    });
    expect(onClearQuote).toHaveBeenCalledTimes(1);
  });

  test('handles /clear locally without delegating to the stream', async () => {
    render(<ActionBar quote={null} onClearQuote={vi.fn()} sessionId="session-1" />);

    const input = screen.getByPlaceholderText('Reply…');
    fireEvent.change(input, { target: { value: '/clear' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(streamContext.clearMessages).toHaveBeenCalledWith('session-1');
    });
    expect(streamContext.sendMessage).not.toHaveBeenCalled();
    expect(streamContext.executeSlashCommand).not.toHaveBeenCalled();
  });
});
