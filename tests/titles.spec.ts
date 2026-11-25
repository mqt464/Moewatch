import { test, expect } from '@playwright/test';
import curated from '../src/curated.json' with { type: 'json' };

test('tab titles follow navigation, episodes and browser history', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.abort());
  const anime = curated[0];
  await page.goto('/');
  await expect(page).toHaveTitle('Discover — Moewatch');
  await page.getByRole('link', { name: 'Search', exact: true }).first().click();
  await expect(page).toHaveTitle('Search — Moewatch');
  await page.goto(`/anime/${anime.id}`);
  await expect(page).toHaveTitle(`${anime.title} — Moewatch`);
  await page.getByRole('link', { name: 'Watch episode 1', exact: true }).click();
  await expect(page).toHaveTitle(`${anime.title} · Episode 1 — Moewatch`);
  await page.goto(`/watch/${anime.id}/2`);
  await expect(page).toHaveTitle(`${anime.title} · Episode 2 — Moewatch`);
  await page.goBack();
  await expect(page).toHaveTitle(`${anime.title} · Episode 1 — Moewatch`);
  await page.goBack();
  await expect(page).toHaveTitle(`${anime.title} — Moewatch`);
  await page.goto('/list');
  await expect(page).toHaveTitle('My List — Moewatch');
  await page.goto('/settings/appearance');
  await expect(page).toHaveTitle('Settings — Moewatch');
  await page.goto('/missing-page');
  await expect(page).toHaveTitle('Page not found — Moewatch');
});
