import { test, expect } from '@playwright/test';

test.describe('Login Page', () => {
  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    expect(page.url()).toContain('/login');
  });

  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login');
    const html = await page.innerHTML('body');
    expect(html).toContain('تسجيل');
  });
});

test.describe('Register Page', () => {
  test('register page loads', async ({ page }) => {
    await page.goto('/register');
    expect(page.url()).toContain('/register');
  });

  test('register page renders correctly', async ({ page }) => {
    await page.goto('/register');
    const html = await page.innerHTML('body');
    expect(html).toContain('حساب');
  });
});