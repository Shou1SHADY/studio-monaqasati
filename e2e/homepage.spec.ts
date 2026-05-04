import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the homepage successfully', async ({ page }) => {
    // Check that the main heading is visible
    await expect(page.locator('h1')).toContainText('مناقصتي');
  });

  test('should display navigation with links', async ({ page }) => {
    // Check navigation links exist in header - use first() to avoid strict mode
    await expect(page.getByRole('link', { name: /تسجيل الدخول/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /حساب جديد/i }).first()).toBeVisible();
  });

  test('should have working CTA buttons', async ({ page }) => {
    // Check CTA buttons exist and are clickable
    const startButton = page.getByRole('link', { name: /ابدأ الآن/i });
    await expect(startButton).toBeVisible();
    await expect(startButton).toHaveAttribute('href', '/register');
  });

  test('should display features section', async ({ page }) => {
    // Check features section exists - use heading role for unique elements
    await expect(page.getByRole('heading', { name: 'للمقاولين' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'للموردين' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'للمسؤولين' })).toBeVisible();
  });

  test('should navigate to login page', async ({ page }) => {
    await page.getByRole('link', { name: /تسجيل الدخول/i }).first().click();
    await expect(page).toHaveURL(/login/);
  });

  test('should navigate to register page', async ({ page }) => {
    await page.getByRole('link', { name: /حساب جديد/i }).first().click();
    await expect(page).toHaveURL(/register/);
  });
});