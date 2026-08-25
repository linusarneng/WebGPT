import { expect, test } from '@playwright/test';
import { installMockWorker } from '../e2e/mock-worker';

const DESKTOP = { width: 1280, height: 860 };
const MOBILE = { width: 390, height: 844 };

for (const [name, size] of [['desktop', DESKTOP], ['mobile', MOBILE]] as const) {
  test(`shots ${name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => localStorage.setItem('webgpt.model', 'qwen2.5-0.5b-instruct'));
    await page.addInitScript(installMockWorker({}));
    await page.goto('/');
    await expect(page.locator('.plate')).toBeVisible();
    await page.screenshot({ path: `.shots/${name}-1-idle.png`, fullPage: true });

    await page.getByRole('button', { name: /^Load .+$/ }).click();
    await expect(page.locator('.phase')).toHaveCount(4);
    await page.screenshot({ path: `.shots/${name}-2-loading.png`, fullPage: true });

    await expect(page.locator('.status')).toHaveAttribute('data-state', 'ready');
    await page.screenshot({ path: `.shots/${name}-3-ready.png`, fullPage: true });

    await page.getByLabel('Message WebGPT').fill('Show me a debounce helper in JavaScript.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('.message--assistant')).toHaveAttribute('data-status', 'done');
    await page.locator('.message--assistant').hover();
    await page.screenshot({ path: `.shots/${name}-4-chat.png`, fullPage: true });

    if (name === 'mobile') {
      await page.getByRole('button', { name: 'Open conversation history' }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `.shots/${name}-5-drawer.png` });
    }
  });

  test(`shots ${name} failure`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.addInitScript(() => localStorage.setItem('webgpt.model', 'qwen2.5-0.5b-instruct'));
    await page.addInitScript(installMockWorker({ failLoad: true }));
    await page.goto('/');
    await page.getByRole('button', { name: /^Load .+$/ }).click();
    await expect(page.locator('.notice--error')).toBeVisible();
    await page.locator('.notice__details summary').click();
    await page.screenshot({ path: `.shots/${name}-6-error.png`, fullPage: true });
  });
}

test('wasm fallback', async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.addInitScript(() => localStorage.setItem('webgpt.model', 'qwen2.5-0.5b-instruct'));
  await page.addInitScript(installMockWorker({ backend: 'wasm' }));
  await page.goto('/');
  await page.getByRole('button', { name: /^Load .+$/ }).click();
  await expect(page.locator('.notice--warn')).toBeVisible();
  await page.screenshot({ path: '.shots/desktop-7-wasm.png', fullPage: true });
});
