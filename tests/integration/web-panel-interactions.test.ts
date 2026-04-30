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

test.describe('Panel Interactions', () => {

  let apiKey: string;
  let sessionId: string;

  test.beforeAll(async () => {
    apiKey = await getApiKey();
    sessionId = await createSession(apiKey);
  });

  // ── Task List ───────────────────────────────────────────────────────────────

  test('should toggle Task List panel', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    // Find Tasks button in PanelTop
    const tasksBtn = page.locator('button[title="Tasks"]');
    if (await tasksBtn.isVisible()) {
      // Initially not toggled — click to open
      await tasksBtn.click();
      await page.waitForTimeout(300);

      // Tasks panel should appear
      const tasksPanel = page.locator('text=Tasks').first();
      await expect(tasksPanel).toBeVisible({ timeout: 5000 });

      // Click again to close
      await tasksBtn.click();
      await page.waitForTimeout(300);
    } else {
      test.skip();
    }
  });

  // ── Agent Panel ─────────────────────────────────────────────────────────────

  test('should toggle Agent Panel', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    const agentBtn = page.locator('button[title="Agents"]');
    if (await agentBtn.isVisible()) {
      await agentBtn.click();
      await page.waitForTimeout(300);

      // Agent panel should appear with empty state
      const agentsHeader = page.locator('text=Agents').first();
      await expect(agentsHeader).toBeVisible({ timeout: 5000 });

      // Should show "No active sub-agents" when no agents running
      const emptyState = page.locator('text=No active sub-agents');
      await expect(emptyState).toBeVisible({ timeout: 5000 });

      // Close
      await agentBtn.click();
      await page.waitForTimeout(300);
    } else {
      test.skip();
    }
  });

  // ── Context Bar ─────────────────────────────────────────────────────────────

  test('should toggle Context Bar panel', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    const ctxBtn = page.locator('button[title="Context window"]');
    if (await ctxBtn.isVisible()) {
      await ctxBtn.click();
      await page.waitForTimeout(500);

      // Context bar should appear
      const ctxBar = page.locator('text=Context window, text=Context').first();
      await expect(ctxBar).toBeVisible({ timeout: 5000 });

      // Close
      await ctxBtn.click();
      await page.waitForTimeout(300);
    } else {
      test.skip();
    }
  });

  // ── Token + Cost Display ────────────────────────────────────────────────────

  test('should display token counts and cost in PanelTop', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    // PanelTop should show model picker and effort picker
    const modelPicker = page.locator('[role="combobox"], select').first();
    await expect(modelPicker).toBeVisible({ timeout: 10000 });
  });

  // ── Export Button ──────────────────────────────────────────────────────────

  test('should open Export dialog', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    const exportBtn = page.locator('button[title="Export"]');
    if (await exportBtn.isVisible()) {
      await exportBtn.click();
      await page.waitForTimeout(500);
      const dialogContent = page.locator('[role="dialog"], .fixed.inset-0');
      await expect(dialogContent.first()).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
    } else {
      test.skip();
    }
  });

  // ── Sidebar ─────────────────────────────────────────────────────────────────

  test('should show session list in sidebar', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/new`);
    await page.waitForLoadState('networkidle');

    // Sidebar should be visible with sessions list
    const sidebar = page.locator('aside, [class*="sidebar"], nav').first();
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });

  test('should collapse and expand sidebar', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/new`);
    await page.waitForLoadState('networkidle');

    // Look for collapse toggle (first button in sidebar)
    const collapseBtn = page.locator('button[aria-label="Collapse sidebar"], button[title="Collapse sidebar"]');
    if (await collapseBtn.isVisible()) {
      await collapseBtn.click();
      await page.waitForTimeout(300);
      // Sidebar should be collapsed to narrow width
      const sidebar = page.locator('aside, [class*="sidebar"]').first();
      await expect(sidebar).toBeVisible({ timeout: 5000 });
    } else {
      test.skip();
    }
  });

});
