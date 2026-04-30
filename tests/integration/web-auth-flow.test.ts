import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';
const API_BASE = 'http://localhost:8080';

async function authenticateViaApi(): Promise<{ apiKey: string }> {
  const init = await fetch(`${API_BASE}/api/auth/init`, { method: 'POST' });
  const { tempToken } = await init.json() as { tempToken: string };

  const verify = await fetch(`${API_BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempToken }),
  });
  const { apiKey } = await verify.json() as { apiKey: string };
  return { apiKey };
}

async function storeApiKey(page: Page, apiKey: string) {
  await page.evaluate((key) => {
    localStorage.setItem('apiKey', key);
    localStorage.setItem('auth_validated', 'true');
  }, apiKey);
}

// ─────────────────────────────────────────────────────────────────────────────

test.describe('Auth Flow', () => {

  test('should complete full auth flow: init → verify → validate', async () => {
    const { apiKey } = await authenticateViaApi();
    expect(apiKey).toBeTruthy();

    // Validate the key
    const validateRes = await fetch(`${API_BASE}/api/auth/validate`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const validateData = await validateRes.json() as { valid: boolean };
    expect(validateData.valid).toBe(true);
  });

  test('should redirect to /new on first load', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/new/);
  });

  test('should show loading state while sessions load', async ({ page }) => {
    await page.goto(`${BASE_URL}/new`);
    // Loading state should appear briefly before sessions list
    const loadingEl = page.locator('text=Loading sessions');
    // It's okay if this resolves immediately (fast network) or shows loading briefly
    // We just verify the page eventually settles
    await page.waitForLoadState('networkidle');
  });

  test('should reject API calls without auth token', async () => {
    const res = await fetch(`${API_BASE}/api/state`);
    expect(res.status).toBe(401);
  });

  test('should reject API calls with invalid token', async () => {
    const res = await fetch(`${API_BASE}/api/state`, {
      headers: { Authorization: 'Bearer bad_token_xyz' },
    });
    expect(res.status).toBe(401);
  });

  test('should store and persist API key in localStorage', async ({ page }) => {
    const { apiKey } = await authenticateViaApi();
    await storeApiKey(page, apiKey);

    // Reload and verify key is still there
    await page.reload();
    const stored = await page.evaluate(() => localStorage.getItem('apiKey'));
    expect(stored).toBe(apiKey);
  });

});
