import { expect, test, type Page } from '@playwright/test';
import { installMockWorker } from './mock-worker';

/**
 * The composer is the one control the app exists for. These sizes are the ones
 * that used to push it below the fold: a short laptop window and a phone.
 */
const VIEWPORTS = [
  { name: 'short desktop', width: 1280, height: 600 },
  { name: 'phone', width: 390, height: 667 },
] as const;

async function openIdle(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('webgpt.model', 'qwen2.5-0.5b-instruct'));
  await page.addInitScript(installMockWorker({}));
  await page.goto('/');
  await expect(page.locator('.plate')).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test.describe(`composer on a ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('stays inside the viewport while the model card is shown', async ({ page }) => {
      await openIdle(page);

      const composer = page.locator('.composer__field');
      await expect(composer).toBeInViewport({ ratio: 1 });

      const box = (await composer.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    });

    test('keeps the model card scrollable inside the conversation region', async ({ page }) => {
      await openIdle(page);

      // The card may overflow, but it must overflow *into* the scroller rather
      // than growing the page or displacing the composer.
      const pageOverflow = await page.evaluate(
        () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
      );
      expect(pageOverflow).toBeLessThanOrEqual(0);

      const scrollable = await page.evaluate(() => {
        const region = document.querySelector('.conversation')!;
        return getComputedStyle(region).overflowY;
      });
      expect(['auto', 'scroll']).toContain(scrollable);
      await expect(page.locator('.composer__field')).toBeInViewport({ ratio: 1 });
    });

    test('reaches the bottom of the start card when it overflows', async ({ page }) => {
      await openIdle(page);

      const reach = await page.evaluate(() => {
        const region = document.querySelector('.conversation') as HTMLElement;
        region.scrollTop = region.scrollHeight;
        const cta = document.querySelector('.plate__cta')!.getBoundingClientRect();
        const bounds = region.getBoundingClientRect();
        return {
          overflows: region.scrollHeight > region.clientHeight,
          scrolled: region.scrollTop > 0,
          atBottom: region.scrollHeight - region.scrollTop - region.clientHeight < 2,
          ctaVisible: cta.top >= bounds.top - 1 && cta.bottom <= bounds.bottom + 1,
        };
      });

      // A card too tall for the window must be reachable to its last control.
      if (reach.overflows) {
        expect(reach.scrolled).toBe(true);
        expect(reach.atBottom).toBe(true);
        // The last control of the card must sit inside the scrolled region.
        expect(reach.ctaVisible).toBe(true);
      }
      // The top must stay reachable too, which centring alone would break.
      const top = await page.evaluate(() => {
        const region = document.querySelector('.conversation') as HTMLElement;
        region.scrollTop = 0;
        return document.querySelector('.plate')!.getBoundingClientRect().top;
      });
      const regionTop = await page.evaluate(
        () => document.querySelector('.conversation')!.getBoundingClientRect().top,
      );
      expect(top).toBeGreaterThanOrEqual(regionTop - 1);
    });

    test('does not scroll the page horizontally', async ({ page }) => {
      await openIdle(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
