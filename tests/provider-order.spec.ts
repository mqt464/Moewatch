import { test, expect } from '@playwright/test';

test('provider drag saves priority and survives reload', async ({ page }) => {
  await page.goto('/settings/playback');
  const first = page.locator('[data-provider-id="reanime"]');
  const second = page.locator('[data-provider-id="anikoto"]');
  const handle = first.getByRole('button');
  const source = await handle.boundingBox();
  const target = await second.boundingBox();
  if (!source || !target) throw new Error('Provider rows are missing');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2, target.y + target.height / 2, { steps: 10 });
  await expect.poll(async () => (await second.boundingBox())?.y).toBeLessThan(target.y - 20);
  await page.mouse.up();
  await expect(page.locator('[data-provider-id]').first()).toHaveAttribute('data-provider-id', 'anikoto');
  await page.reload();
  await expect(page.locator('[data-provider-id]').first()).toHaveAttribute('data-provider-id', 'anikoto');
});

test('short drags keep position and keyboard reordering works', async ({ page }) => {
  await page.goto('/settings/playback');
  const handle = page.locator('[data-provider-id="reanime"]').getByRole('button');
  const source = await handle.boundingBox();
  if (!source) throw new Error('Provider handle is missing');
  await page.mouse.move(source.x + 16, source.y + 16);
  await page.mouse.down();
  await page.mouse.move(source.x + 16, source.y + 28, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-provider-id]').first()).toHaveAttribute('data-provider-id', 'reanime');
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('[data-provider-id]').first()).toHaveAttribute('data-provider-id', 'anikoto');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('[data-provider-id]').first()).toHaveAttribute('data-provider-id', 'reanime');
});

test('provider card clips corners and status bars have a readable size', async ({ page }) => {
  await page.goto('/settings/playback');
  const list = page.locator('.provider-priority-list');
  await expect(list).toHaveCSS('overflow', 'hidden');
  await expect(list).toHaveCSS('border-radius', '10px');
  const status = page.locator('.provider-status-bars').first();
  await expect(status.locator('i')).toHaveCount(12);
  await expect(status.locator('i').first()).toHaveCSS('height', '17px');
});

test('dragging can reverse direction before release', async ({ page }) => {
  await page.goto('/settings/playback');
  const first = page.locator('[data-provider-id="reanime"]');
  const second = page.locator('[data-provider-id="anikoto"]');
  const source = await first.getByRole('button').boundingBox();
  const target = await second.boundingBox();
  if (!source || !target) throw new Error('Provider rows are missing');
  const x = source.x + source.width / 2;
  const y = source.y + source.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, target.y + target.height / 2 + 4, { steps: 10 });
  await expect.poll(async () => (await second.boundingBox())?.y).toBeLessThan(target.y - 20);
  await page.mouse.move(x, y, { steps: 10 });
  await expect.poll(async () => (await second.boundingBox())?.y).toBeCloseTo(target.y, 0);
  await page.mouse.up();
  await expect(page.locator('[data-provider-id]').first()).toHaveAttribute('data-provider-id', 'reanime');
});
