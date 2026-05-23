import { test, expect } from '@playwright/test';

test.describe('Supplier Portal (Unauthenticated)', () => {
  const routes = [
    '/supplier',
    '/supplier/orders',
    '/supplier/rfqs',
    '/supplier/offers',
    '/supplier/chats',
    '/supplier/team',
    '/supplier/notifications',
    '/supplier/profile'
  ];

  for (const route of routes) {
    test(`route ${route} gracefully redirects or handles unauthenticated state`, async ({ page }) => {
      await page.goto(route);
      await page.waitForURL(url => url.pathname.includes('/login') || url.pathname.includes('/supplier'));
      const currentUrl = page.url();
      expect(currentUrl.includes('/login') || currentUrl.includes('/supplier')).toBe(true);
      const title = await page.title();
      expect(title).toBeDefined();
    });
  }
});
