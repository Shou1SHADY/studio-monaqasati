import { test, expect } from '@playwright/test';

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should display login form', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /تسجيل الدخول/i })).toBeVisible();
  });

  test('should have email and password fields', async ({ page }) => {
    await expect(page.getByLabel(/البريد الإلكتروني/i)).toBeVisible();
    await expect(page.getByLabel(/كلمة المرور/i)).toBeVisible();
  });

  test('should show validation error for empty form', async ({ page }) => {
    await page.getByRole('button', { name: /تسجيل الدخول/i }).click();
    // Check for HTML5 validation (required attribute)
    const emailInput = page.getByLabel(/البريد الإلكتروني/i);
    await expect(emailInput).toHaveAttribute('required');
  });

  test('should navigate to register page', async ({ page }) => {
    await page.getByRole('link', { name: /أنشئ حساباً جديداً/i }).click();
    await expect(page).toHaveURL(/register/);
  });

  test('should navigate back to homepage', async ({ page }) => {
    await page.getByRole('link', { name: /العودة للرئيسية/i }).click();
    await expect(page).toHaveURL('/');
  });
});

test.describe('Register Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/register');
  });

  test('should display registration form', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /إنشاء حساب/i })).toBeVisible();
  });

  test('should have role selection (Contractor/Supplier)', async ({ page }) => {
    await expect(page.getByText(/مقاول/i)).toBeVisible();
    await expect(page.getByText(/مورد/i)).toBeVisible();
  });

  test('should navigate to login page', async ({ page }) => {
    await page.getByRole('link', { name: /تسجيل الدخول/i }).click();
    await expect(page).toHaveURL(/login/);
  });
});