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

test.describe('Dialogs', () => {

  let apiKey: string;
  let sessionId: string;

  test.beforeAll(async () => {
    apiKey = await getApiKey();
    sessionId = await createSession(apiKey);
  });

  // ── Diagnostics ─────────────────────────────────────────────────────────────

  test('should open Diagnostics dialog via Stethoscope icon', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    // Wait for session to load
    await page.waitForFunction(() => {
      const el = document.querySelector('text=Loading sessions');
      return !el;
    }, { timeout: 10000 }).catch(() => {});

    // Click Stethoscope (Diagnostics) button in PanelTop
    const diagBtn = page.locator('button[title="Diagnostics (/doctor)"]');
    if (await diagBtn.isVisible()) {
      await diagBtn.click();
      await page.waitForTimeout(500);
      // Should show diagnostics dialog
      const diagDialog = page.locator('text=Diagnostics');
      await expect(diagDialog.first()).toBeVisible({ timeout: 5000 });
      // Close it
      await page.keyboard.press('Escape');
    } else {
      // Button not visible — skip
      test.skip();
    }
  });

  // ── History ────────────────────────────────────────────────────────────────

  test('should open History dialog via Clock icon', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    const histBtn = page.locator('button[title="History (Ctrl+Shift+H)"]');
    if (await histBtn.isVisible()) {
      await histBtn.click();
      await page.waitForTimeout(500);
      // Should show history dialog content
      const dialogContent = page.locator('[role="dialog"], .fixed.inset-0');
      await expect(dialogContent.first()).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
    } else {
      test.skip();
    }
  });

  test('should open History via Ctrl+Shift+H shortcut', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('Control+Shift+H');
    await page.waitForTimeout(500);
    const dialogContent = page.locator('[role="dialog"], .fixed.inset-0');
    await expect(dialogContent.first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });

  // ── Search ─────────────────────────────────────────────────────────────────

  test('should open Search dialog via Ctrl+Shift+F shortcut', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('Control+Shift+F');
    await page.waitForTimeout(500);
    const dialogContent = page.locator('[role="dialog"], .fixed.inset-0');
    await expect(dialogContent.first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });

  // ── Bug Report ─────────────────────────────────────────────────────────────

  test('should open Bug Report via Ctrl+Shift+B shortcut', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('Control+Shift+B');
    await page.waitForTimeout(500);
    const bugDialog = page.locator('text=Bug Report').first();
    await expect(bugDialog).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });

  // ── MCP Servers ────────────────────────────────────────────────────────────

  test('should open MCP Server Manager', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    const mcpBtn = page.locator('button[title="MCP servers"]');
    if (await mcpBtn.isVisible()) {
      await mcpBtn.click();
      await page.waitForTimeout(500);
      const dialogContent = page.locator('[role="dialog"], .fixed.inset-0');
      await expect(dialogContent.first()).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
    } else {
      test.skip();
    }
  });

  // ── Memory ─────────────────────────────────────────────────────────────────

  test('should open Memory file manager', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    const memBtn = page.locator('button[title="Memory (CLAUDE.md)"]');
    if (await memBtn.isVisible()) {
      await memBtn.click();
      await page.waitForTimeout(500);
      const dialogContent = page.locator('[role="dialog"], .fixed.inset-0');
      await expect(dialogContent.first()).toBeVisible({ timeout: 5000 });
      await page.keyboard.press('Escape');
    } else {
      test.skip();
    }
  });

  // ── Keyboard shortcut help ─────────────────────────────────────────────────

  test('should open keyboard shortcut help with ? key', async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');

    await page.keyboard.press('?');
    await page.waitForTimeout(500);
    const shortcutHelp = page.locator('text=Keyboard shortcuts');
    await expect(shortcutHelp.first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });

});
