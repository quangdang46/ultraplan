import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { Conversation } from './Conversation';

const streamContext = {
  sessionId: 'session-1',
  isStreaming: false,
  messages: [
    {
      id: 'assistant-1',
      role: 'assistant' as const,
      content: '',
      toolCalls: [],
      artifacts: [
        {
          id: 'artifact-1',
          type: 'web_search_result',
          label: 'API docs',
          detail: 'Primary reference',
          url: 'https://example.com/docs',
        },
        {
          id: 'artifact-2',
          type: 'document',
          label: 'spec.pdf',
          detail: 'application/pdf · base64',
        },
      ],
    },
  ],
  pendingPermissions: [],
  error: null,
  sendMessage: vi.fn(async () => true),
  respondToPermission: vi.fn(async () => {}),
  attachSession: vi.fn(async () => {}),
  detachSession: vi.fn(),
  executeSlashCommand: vi.fn(async () => {}),
  cancelStream: vi.fn(),
  clearMessages: vi.fn(),
  loadMessages: vi.fn(),
  pendingRouteSync: false,
  acknowledgeRouteSync: vi.fn(),
};

vi.mock('../../hooks/useStreamContext', () => ({
  useStreamContext: () => streamContext,
}));

describe('Conversation transcript artifacts', () => {
  test('renders preserved transcript artifacts for reopened sessions', () => {
    render(<Conversation />);

    expect(screen.getByText('API docs')).toBeInTheDocument();
    expect(screen.getByText('Primary reference')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://example.com/docs' })).toBeInTheDocument();
    expect(screen.getByText('spec.pdf')).toBeInTheDocument();
    expect(screen.getByText('application/pdf · base64')).toBeInTheDocument();
  });
});
