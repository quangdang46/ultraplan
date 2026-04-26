import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { ActionBar } from './ActionBar';

const streamContext = {
  sendMessage: vi.fn(async () => true),
  executeSlashCommand: vi.fn(async () => {}),
  cancelStream: vi.fn(),
  isStreaming: false,
  messages: [],
  error: null,
  clearMessages: vi.fn(),
};

const apiClient = {
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
      });
    });
    expect(onClearQuote).toHaveBeenCalledTimes(1);
  });

  test('escape clears quote when no suggestion popup', () => {
    const onClearQuote = vi.fn();
    render(<ActionBar quote="quoted text" onClearQuote={onClearQuote} />);

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
      });
    });
    expect(onClearQuote).toHaveBeenCalledTimes(1);
  });
});
