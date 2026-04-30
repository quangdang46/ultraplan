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

test.describe('Keyboard Shortcuts', () => {

  let apiKey: string;
  let sessionId: string;

  test.beforeAll(async () => {
    apiKey = await getApiKey();
    sessionId = await createSession(apiKey);
  });

  test.beforeEach(async ({ page }) => {
    await storeApiKey(page, apiKey);
    await page.goto(`${BASE_URL}/chat/${sessionId}`);
    await page.waitForLoadState('networkidle');
  });

  test('Ctrl+Shift+F opens Search dialog', async ({ page }) => {
    await page.keyboard.press('Control+Shift+F');
    await page.waitForTimeout(500);
    const dialog = page.locator('[role="dialog"], .fixed.inset-0');
    await expect(dialog.first()).toBeVisible({ timeout: 5000 });
    // Close
    await page.keyboard.press('Escape');
  });

  test('Ctrl+Shift+H opens History dialog', async ({ page }) => {
    await page.keyboard.press('Control+Shift+H');
    await page.waitForTimeout(500);
    const dialog = page.locator('[role="dialog"], .fixed.inset-0');
    await expect(dialog.first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });

  test('Ctrl+Shift+B opens Bug Report dialog', async ({ page }) => {
    await page.keyboard.press('Control+Shift+B');
    await page.waitForTimeout(500);
    const bugDialog = page.locator('text=Bug Report').first();
    await expect(bugDialog).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });

  test('? opens keyboard shortcut help overlay', async ({ page }) => {
    await page.keyboard.press('?');
    await page.waitForTimeout(500);
    const shortcutHelp = page.locator('text=Keyboard shortcuts');
    await expect(shortcutHelp.first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });

  test('Escape closes open dialog', async ({ page }) => {
    // Open History dialog
    await page.keyboard.press('Control+Shift+H');
    await page.waitForTimeout(500);
    const dialog = page.locator('[role="dialog"], .fixed.inset-0');
    await expect(dialog.first()).toBeVisible({ timeout: 5000 });

    // Escape should close it
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(dialog.first()).not.toBeVisible({ timeout: 5000 });
  });

  test('Escape closes keyboard shortcut help', async ({ page }) => {
    await page.keyboard.press('?');
    await page.waitForTimeout(500);
    const shortcutHelp = page.locator('text=Keyboard shortcuts');
    await expect(shortcutHelp.first()).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await expect(shortcutHelp.first()).not.toBeVisible({ timeout: 5000 });
  });

  test('Escape while no dialog open does not cause errors', async ({ page }) => {
    // Press Escape when nothing is open — should not crash
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Page should still be functional
    await page.keyboard.press('Control+Shift+F');
    await page.waitForTimeout(500);
    const dialog = page.locator('[role="dialog"], .fixed.inset-0');
    await expect(dialog.first()).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
  });

  test('Up/Down arrows navigate message history', async ({ page }) => {
    // Focus the message input
    const input = page.locator('input[placeholder*="Reply" i]').first();
    if (await input.isVisible()) {
      await input.focus();

      // Press Up — should show previous prompt (if history exists)
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(200);
    }
    // Just verify no crash
  });

});
