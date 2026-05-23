import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the homepage successfully', async ({ page }) => {
    // Check that the brand name is visible in the nav
    await expect(page.locator('nav').filter({ hasText: 'مدماك تيك' })).toBeVisible();
  });

  test('should display navigation with links', async ({ page }) => {
    // Check navigation links exist in header
    await expect(page.getByRole('link', { name: /دخول/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /ابدأ مجاناً/i }).first()).toBeVisible();
  });

  test('should have working CTA buttons', async ({ page }) => {
    // Check CTA buttons exist and are clickable
    const startButton = page.getByRole('link', { name: /ابدأ مجاناً/i }).first();
    await expect(startButton).toBeVisible();
    await expect(startButton).toHaveAttribute('href', '/register');
  });

  test('should display features section', async ({ page }) => {
    // Check features section exists by looking for the section ID
    const featuresSection = page.locator('#features');
    await expect(featuresSection).toBeVisible();
    await expect(featuresSection).toContainText('قوة مدماك تيك');
  });

  test('should navigate to login page', async ({ page }) => {
    await page.getByRole('link', { name: /دخول/i }).first().click();
    await expect(page).toHaveURL(/login/);
  });

  test('should navigate to register page', async ({ page }) => {
    await page.getByRole('link', { name: /ابدأ مجاناً/i }).first().click();
    await expect(page).toHaveURL(/register/);
  });
});