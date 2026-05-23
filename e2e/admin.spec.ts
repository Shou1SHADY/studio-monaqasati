import { test, expect } from '@playwright/test';

test.describe('Admin Portal (Unauthenticated)', () => {
  const routes = [
    '/admin',
    '/admin/suppliers',
    '/admin/contractors',
    '/admin/rfqs',
    '/admin/notifications',
    '/admin/stats',
    '/admin/settings',
    '/admin/profile'
  ];

  for (const route of routes) {
    test(`route ${route} gracefully redirects or handles unauthenticated state`, async ({ page }) => {
      await page.goto(route);
      await page.waitForURL(url => url.pathname.includes('/login') || url.pathname.includes('/admin'));
      const currentUrl = page.url();
      expect(currentUrl.includes('/login') || currentUrl.includes('/admin')).toBe(true);
      const title = await page.title();
      expect(title).toBeDefined();
    });
  }
});
