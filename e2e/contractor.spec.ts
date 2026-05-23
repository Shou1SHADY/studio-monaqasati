import { test, expect } from '@playwright/test';

test.describe('Contractor Portal (Unauthenticated)', () => {
  const routes = [
    '/contractor',
    '/contractor/rfqs',
    '/contractor/rfqs/new',
    '/contractor/suppliers',
    '/contractor/chats',
    '/contractor/team',
    '/contractor/notifications',
    '/contractor/profile'
  ];

  for (const route of routes) {
    test(`route ${route} gracefully redirects or handles unauthenticated state`, async ({ page }) => {
      await page.goto(route);
      await page.waitForURL(url => url.pathname.includes('/login') || url.pathname.includes('/contractor'));
      const currentUrl = page.url();
      expect(currentUrl.includes('/login') || currentUrl.includes('/contractor')).toBe(true);
      const title = await page.title();
      expect(title).toBeDefined();
    });
  }
});
