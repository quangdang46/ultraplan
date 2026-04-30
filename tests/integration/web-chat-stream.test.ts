import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const API_BASE = 'http://localhost:8080';

async function getApiKey(): Promise<string> {
  const init = await fetch(`${API_BASE}/api/auth/init`, { method: 'POST' });
  const { tempToken } = await init.json() as { tempToken: string };
  const verify = await fetch(`${API_BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempToken }),
  });
  const { apiKey } = await verify.json() as { apiKey: string };
  return apiKey;
}

async function createSession(apiKey: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ cwd: '/tmp' }),
  });
  const data = await res.json() as Record<string, unknown>;
  return (data.session as Record<string, unknown>)?.id as string
    ?? data.id as string
    ?? '';
}

async function storeApiKey(page: Page, apiKey: string) {
  await page.evaluate((key) => {
    localStorage.setItem('apiKey', key);
    localStorage.setItem('auth_validated', 'true');
  }, apiKey);
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Chat Stream', () => {

  let apiKey: string;
  let sessionId: string;

  test.beforeAll(async () => {
    apiKey = await getApiKey();
    sessionId = await createSession(apiKey);
  });

  test('should send a message and receive SSE stream', async () => {
    // Use AbortController to limit stream to 2 seconds
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ message: 'Hello Claude!', sessionId }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  test('should interrupt an active session', async () => {
    const res = await fetch(`${API_BASE}/api/chat/interrupt`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId }),
    });
    const data = await res.json() as { success?: boolean };
    // Returns 200 even if nothing to interrupt
    expect(res.status).toBe(200);
    expect(data.success ?? true).toBe(true);
  });

  test('should respond to a permission request', async () => {
    // Send an approval for a non-existent request (should still return 200)
    const res = await fetch(`${API_BASE}/api/chat/control`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        request_id: 'test-perm-001',
        approved: true,
      }),
    });
    expect(res.status).toBe(200);
  });

  test('should return session messages', async () => {
    const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/messages`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json() as { messages: unknown[] };
    expect(Array.isArray(data.messages)).toBe(true);
  });

  test('should stream session events via SSE', async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/stream?from=0`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'text/event-stream',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  test('should rewind last turn', async () => {
    const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/rewind`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const data = await res.json() as { success?: boolean };
    expect(res.status).toBe(200);
    expect(data.success ?? true).toBe(true);
  });

  test('should show empty state on new session in UI', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    // Empty session should show the empty state message
    const emptyState = page.locator('text=Send a message to start a conversation');
    await expect(emptyState).toBeVisible({ timeout: 10000 });
  });

  test('should show message input in conversation', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    const input = page.locator('input[placeholder*="Reply" i]');
    await expect(input).toBeVisible({ timeout: 10000 });
  });

});
