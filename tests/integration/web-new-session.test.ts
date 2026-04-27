import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:5173';

/**
 * Test: New Session creates a truly empty session
 * Bug: When clicking "New Session", the old messages still appeared
 * because createSession -> onSelect -> refetch() race condition caused
 * StreamProvider to remount with key='none' briefly.
 */
test('new session should be truly empty - no messages from previous session', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Wait for sessions to load (stop showing "Loading sessions...")
  await page.waitForFunction(() => {
    const el = document.querySelector('text=Loading sessions');
    return !el;
  }, { timeout: 10000 }).catch(() => {});

  // Get initial heading to detect change
  const initialHeading = await page.locator('h1').first().textContent().catch(() => '');

  // Click the "+ New Session" button in the sidebar
  const newSessionBtn = page.locator('button[title="New session"]').first();
  await newSessionBtn.click();

  // Wait for heading to change (indicates new session loaded)
  await page.waitForFunction(
    (initial) => {
      const h = document.querySelector('h1');
      return h?.textContent !== initial && h?.textContent !== 'Select a session';
    },
    initialHeading,
    { timeout: 10000 }
  );

  // Verify we're on a chat URL
  await expect(page).toHaveURL(/\/chat\/.+/, { timeout: 5000 });

  // Verify no messages from previous session appear
  const emptyState = page.locator('text=Send a message to start a conversation');
  await expect(emptyState).toBeVisible({ timeout: 5000 });

  // Verify the message input is present
  const messageInput = page.locator('input[placeholder*="Reply" i]').first();
  await expect(messageInput).toBeVisible({ timeout: 5000 });
});

test('stream provider key should change on new session', async ({ page }) => {
  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  // Wait for sessions to load
  await page.waitForFunction(() => {
    const el = document.querySelector('text=Loading sessions');
    return !el;
  }, { timeout: 10000 }).catch(() => {});

  // Get initial heading
  const initialHeading = await page.locator('h1').first().textContent().catch(() => '');

  // Click new session
  const newSessionBtn = page.locator('button[title="New session"]').first();
  await newSessionBtn.click();

  // Wait for heading to change to a different session identifier
  await page.waitForFunction(
    (initial) => {
      const h = document.querySelector('h1');
      return h?.textContent !== initial && h?.textContent !== 'Select a session';
    },
    initialHeading,
    { timeout: 10000 }
  );

  // The new heading should be different from initial
  const newHeading = await page.locator('h1').first().textContent();
  expect(newHeading).not.toBe(initialHeading);
  expect(newHeading).not.toBe('Select a session');
});
