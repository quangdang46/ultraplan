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

async function storeApiKey(page: Page, apiKey: string) {
  await page.evaluate((key) => {
    localStorage.setItem('apiKey', key);
    localStorage.setItem('auth_validated', 'true');
  }, apiKey);
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

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Session CRUD', () => {

  let apiKey: string;

  test.beforeAll(async () => {
    apiKey = await getApiKey();
  });

  test('should create a new session via API', async () => {
    const id = await createSession(apiKey);
    expect(id).toBeTruthy();
    expect(id.length).toBeGreaterThan(0);
  });

  test('should list sessions', async () => {
    const res = await fetch(`${API_BASE}/api/sessions`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json() as { sessions: unknown[] };
    expect(Array.isArray(data.sessions)).toBe(true);
  });

  test('should rename a session', async () => {
    const id = await createSession(apiKey);
    const patchRes = await fetch(`${API_BASE}/api/sessions/${id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: 'Renamed Test Session' }),
    });
    expect(patchRes.status).toBe(200);
  });

  test('should get a session by ID', async () => {
    const id = await createSession(apiKey);
    const res = await fetch(`${API_BASE}/api/sessions/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await res.json() as { id: string };
    expect(data.id).toBe(id);
  });

  test('should return 404 for non-existent session', async () => {
    const res = await fetch(`${API_BASE}/api/sessions/nonexistent-id-xyz`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(404);
  });

  test('should kill a session', async () => {
    const id = await createSession(apiKey);
    const delRes = await fetch(`${API_BASE}/api/sessions/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(delRes.status).toBe(200);
  });

  test('should navigate to a session via URL', async ({ page }) => {
    await storeApiKey(page, apiKey);
    const id = await createSession(apiKey);

    await page.goto(`${BASE_URL}/chat/${id}`);
    await page.waitForLoadState('networkidle');

    // Should show the session title or loading state
    const heading = page.locator('h1');
    await expect(heading).toBeVisible({ timeout: 10000 });
  });

  test('should create session via UI', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/new`);
    await page.waitForLoadState('networkidle');

    const newBtn = page.locator('button[title="New session"]').first();
    await newBtn.click();

    await page.waitForFunction(() => {
      const h = document.querySelector('h1');
      return h?.textContent !== 'Select a session' && h?.textContent !== '';
    }, { timeout: 10000 });

    await expect(page).toHaveURL(/\/chat\/.+/, { timeout: 5000 });
  });

});
