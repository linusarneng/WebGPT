import { expect, test, type Page } from '@playwright/test';
import { installMockWorker } from './mock-worker';

async function open(page: Page, options: Parameters<typeof installMockWorker>[0] = {}): Promise<void> {
  // The chosen model is intentionally persisted for people. E2E starts from a
  // known preference so visual and behavior assertions never inherit a choice.
  await page.addInitScript(() => localStorage.setItem('webgpt.model', 'qwen2.5-0.5b-instruct'));
  await page.addInitScript(installMockWorker(options));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Run .+ in this browser/i })).toBeVisible();
}

async function loadModel(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Load .+$/ }).click();
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'ready');
}

test.describe('WebGPT shell', () => {
  test('shows the empty state, starter prompts and a load action', async ({ page }) => {
    await open(page);
    await expect(page.locator('.starter')).toHaveCount(4);
    await expect(page.getByRole('button', { name: /^Load .+$/ })).toBeVisible();
    await expect(page.locator('.status')).toHaveAttribute('data-state', 'idle');
    await expect(page.getByLabel('Message WebGPT')).toBeDisabled();
  });

  test('names the model, its runtime and the download cost before loading', async ({ page }) => {
    await open(page);
    const plate = page.locator('.plate');
    await expect(plate).toContainText('onnx-community/Qwen2.5-0.5B-Instruct');
    await expect(plate).toContainText('No account, no API key, no server');
    await expect(plate).toContainText('About 500 MB');
    await expect(page.locator('.phase')).toHaveCount(0);
  });

  test('walks named load phases and then retires the plate', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: /^Load .+$/ }).click();
    await expect(page.locator('.phase')).toHaveCount(4);
    await expect(page.locator('.phase[data-state="active"]')).toHaveCount(1);
    await expect(page.locator('.plate')).toHaveCount(0);
    await expect(page.locator('.status')).toHaveAttribute('data-phase', 'ready');
  });

  test('reports load progress and then a ready WebGPU runtime', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: /^Load .+$/ }).click();
    await expect(page.locator('.status')).toHaveAttribute('data-state', 'loading');
    await expect(page.locator('.status')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('.status__label')).toContainText('WebGPU');
    await expect(page.getByLabel('Message WebGPT')).toBeEnabled();
  });

  test('streams a reply token by token and keeps it after completion', async ({ page }) => {
    await open(page);
    await loadModel(page);
    await page.getByLabel('Message WebGPT').fill('Why is the sky blue?');
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page.locator('.message--user')).toContainText('Why is the sky blue?');
    await expect(page.locator('.message--assistant')).toHaveAttribute('data-status', 'streaming');
    await expect(page.locator('.message--assistant')).toHaveAttribute('data-status', 'done');
    await expect(page.locator('.message--assistant')).toContainText('Sunlight scatters');
    await expect(page.getByRole('button', { name: 'Copy this response' })).toBeVisible();
  });

  test('Enter sends and Shift+Enter inserts a newline', async ({ page }) => {
    await open(page);
    await loadModel(page);
    const input = page.getByLabel('Message WebGPT');
    await input.fill('first line');
    await input.press('Shift+Enter');
    await expect(page.locator('.message')).toHaveCount(0);
    await expect(input).toHaveValue(/first line\n/);

    await input.press('Enter');
    await expect(page.locator('.message')).toHaveCount(2);
  });

  test('stop keeps the partial response', async ({ page }) => {
    await open(page);
    await loadModel(page);
    await page.getByLabel('Message WebGPT').fill('tell me a long story');
    await page.getByRole('button', { name: 'Send message' }).click();
    await page.getByRole('button', { name: 'Stop generating the response' }).click();

    await expect(page.locator('.message--assistant')).toHaveAttribute('data-status', 'stopped');
    await expect(page.locator('.message--assistant')).toContainText('Sunlight');
    await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  });

  test('a failed model load is recoverable', async ({ page }) => {
    await open(page, { failLoad: true });
    await page.getByRole('button', { name: /^Load .+$/ }).click();
    await expect(page.locator('.status')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('.notice--error')).toContainText('Check your connection');
    await expect(page.getByRole('button', { name: 'Try loading again' })).toBeVisible();

    // The raw cause stays available, but folded away by default.
    const details = page.locator('.notice__details');
    await expect(details.locator('.notice__cause')).toBeHidden();
    await details.getByText('Technical details').click();
    await expect(details.locator('.notice__cause')).toContainText('Mock download failed.');
  });

  test('states the CPU fallback honestly when WebGPU is missing', async ({ page }) => {
    await open(page, { backend: 'wasm' });
    await loadModel(page);
    await expect(page.locator('.status__label')).toContainText('CPU / WASM');
    await expect(page.locator('.notice--warn')).toContainText('WebGPU is unavailable');
  });

  test('conversations persist across a page reload', async ({ page }) => {
    await open(page);
    await loadModel(page);
    await page.getByLabel('Message WebGPT').fill('Remember this conversation');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('.message--assistant')).toHaveAttribute('data-status', 'done');

    await page.reload();
    await expect(page.locator('.message--user')).toContainText('Remember this conversation');
    await expect(page.locator('.message--assistant')).toContainText('Sunlight scatters');
    await expect(page.locator('.chat-item__title').first()).toContainText('Remember this conversation');
  });

  test('new chat, rename and delete work from the sidebar', async ({ page, isMobile }) => {
    await open(page);
    await loadModel(page);
    if (isMobile) await page.getByRole('button', { name: 'Open conversation history' }).click();

    await page.getByLabel('Message WebGPT').fill('Topic number one');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('.message--assistant')).toHaveAttribute('data-status', 'done');

    if (isMobile) await page.getByRole('button', { name: 'Open conversation history' }).click();
    await expect(page.locator('.chat-item__title').first()).toHaveText('Topic number one');

    await page.getByRole('button', { name: /Rename “Topic number one”/ }).click();
    const field = page.locator('.chat-item__rename-input');
    await field.fill('My renamed chat');
    await field.press('Enter');
    await expect(page.locator('.chat-item__title').first()).toHaveText('My renamed chat');

    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: /Delete “My renamed chat”/ }).click();
    await expect(page.locator('.chat-item')).toHaveCount(1);
    await expect(page.locator('.message')).toHaveCount(0);
  });

  test('does not contact any application backend', async ({ page }) => {
    const external: string[] = [];
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (route.request().method() !== 'GET' && !url.startsWith('http://localhost')) external.push(url);
      await route.continue();
    });
    await open(page);
    await loadModel(page);
    await page.getByLabel('Message WebGPT').fill('Anything private');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('.message--assistant')).toHaveAttribute('data-status', 'done');
    expect(external).toEqual([]);
  });
});

test.describe('desktop layout', () => {
  test.skip(({ isMobile }) => Boolean(isMobile), 'desktop-only layout assertions');

  test('shows a persistent sidebar and no menu button', async ({ page }) => {
    await open(page);
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open conversation history' })).toBeHidden();
  });
});

test.describe('mobile layout', () => {
  test.skip(({ isMobile }) => !isMobile, 'mobile-only drawer assertions');

  test('hides the sidebar behind an accessible drawer', async ({ page }) => {
    await open(page);
    const menu = page.getByRole('button', { name: 'Open conversation history' });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');

    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.sidebar')).toBeInViewport();

    await page.keyboard.press('Escape');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
  });

  test('does not scroll horizontally', async ({ page }) => {
    await open(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
