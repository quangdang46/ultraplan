import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { PendingPermission } from '../../features/chat/types';
import { PermissionPanel } from './PermissionPanel';

function buildExitPlanRequest(
  overrides?: Partial<PendingPermission>,
): PendingPermission {
  return {
    requestId: 'req-exit-plan',
    toolName: 'ExitPlanModeV2',
    description: 'Review the plan before execution.',
    toolInput: {
      plan: '1. Inspect current flow\n2. Add coverage\n3. Ship fix',
      planFilePath: '/tmp/superplan.md',
      allowedPrompts: [
        { tool: 'Bash', prompt: 'Run focused tests' },
        { tool: 'Edit', prompt: 'Patch the affected files' },
      ],
    },
    ...overrides,
  };
}

describe('PermissionPanel exit-plan requests', () => {
  test('renders plan details and requested execution permissions', () => {
    render(
      <PermissionPanel
        requests={[buildExitPlanRequest()]}
        onRespond={vi.fn(async () => {})}
      />,
    );

    expect(screen.getByText('Review plan')).toBeInTheDocument();
    expect(screen.getByText('Requested execution permissions')).toBeInTheDocument();
    expect(screen.getByText('/tmp/superplan.md')).toBeInTheDocument();
    expect(screen.getByLabelText('Plan draft')).toHaveValue(
      '1. Inspect current flow\n2. Add coverage\n3. Ship fix',
    );
    expect(screen.getByText('Run focused tests')).toBeInTheDocument();
    expect(screen.getByText('Patch the affected files')).toBeInTheDocument();
    expect(screen.getByText('Inspect current flow')).toBeInTheDocument();
  });

  test('approves an edited plan by returning updatedInput.plan', async () => {
    const onRespond = vi.fn(async () => {});

    render(
      <PermissionPanel
        requests={[buildExitPlanRequest()]}
        onRespond={onRespond}
      />,
    );

    fireEvent.change(screen.getByLabelText('Plan draft'), {
      target: {
        value:
          '# Updated plan\n1. Validate streaming state\n2. Approve after review',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Approve plan' }));

    await waitFor(() => {
      expect(onRespond).toHaveBeenCalledWith(
        'req-exit-plan',
        true,
        expect.objectContaining({
          updatedInput: expect.objectContaining({
            plan:
              '# Updated plan\n1. Validate streaming state\n2. Approve after review',
          }),
        }),
      );
    });
  });

  test('requests changes with revision feedback', async () => {
    const onRespond = vi.fn(async () => {});

    render(
      <PermissionPanel
        requests={[buildExitPlanRequest()]}
        onRespond={onRespond}
      />,
    );

    fireEvent.change(screen.getByLabelText('Revision feedback'), {
      target: { value: 'Need a rollback step and success criteria.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));

    await waitFor(() => {
      expect(onRespond).toHaveBeenCalledWith('req-exit-plan', false, {
        message: 'Need a rollback step and success criteria.',
      });
    });
  });
});
