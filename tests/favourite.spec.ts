import { test, expect } from '@playwright/test';

for (const fails of [false, true]) {
  test(`heart updates before AniList responds and ${fails ? 'rolls back on failure' : 'stays saved on success'}`, async ({ page }) => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    let releaseRefresh!: () => void;
    const refresh = new Promise<void>(resolve => { releaseRefresh = resolve; });
    let reads = 0;
    let delayRefresh = false;
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/account')) return route.fulfill({ json: { configured: true, user: { id: 7, name: 'Tester', avatar: '' } } });
      if (path.endsWith('/account/list')) return route.fulfill({ json: { entries: [] } });
      if (path.includes('/account/favourites/')) {
        if (route.request().method() === 'PUT') {
          expect(route.request().postDataJSON()).toEqual({ isFavourite: true });
          await pending;
          return fails
            ? route.fulfill({ status: 502, json: { error: { message: 'Could not sync favourite with AniList' } } })
            : route.fulfill({ json: { isFavourite: true, isFavouriteBlocked: false } });
        }
        if (delayRefresh) { reads++; await refresh; }
        return route.fulfill({ json: { isFavourite: false, isFavouriteBlocked: false } });
      }
      return route.abort();
    });
    await page.goto('/anime/1');
    const heart = page.locator('.favourite-control button');
    await expect(heart).toBeEnabled();
    delayRefresh = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => reads).toBeGreaterThan(0);
    await heart.click();
    try {
      await expect(heart).toHaveAttribute('aria-pressed', 'true');
      await expect(heart.locator('svg')).toHaveAttribute('fill', 'currentColor');
      await expect(heart).toHaveCSS('opacity', '1');
      const staleResponse = page.waitForResponse(response => response.url().includes('/account/favourites/') && response.request().method() === 'GET');
      releaseRefresh();
      await staleResponse;
      // Wait for the response body and React update before checking the optimistic state.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(heart).toHaveAttribute('aria-pressed', 'true');
    } finally { releaseRefresh(); release(); }
    await expect(heart).toBeEnabled();
    await expect(heart).toHaveAttribute('aria-pressed', String(!fails));
    if (fails) await expect(page.locator('.favourite-error')).toContainText('Could not sync');
  });
}
