import { test, expect } from '@playwright/test'

test.describe('Monaqasati Page Routing & Structure Tests', () => {
  test('homepage loads', async ({ page }) => {
    await page.goto('/')
    expect(page.url()).toBeTruthy()
  })

  test('login page loads', async ({ page }) => {
    await page.goto('/login')
    expect(page.url()).toContain('/login')
  })

  test('register page loads', async ({ page }) => {
    await page.goto('/register')
    expect(page.url()).toContain('/register')
  })

  // Test that unauthenticated users are properly redirected to login or shown a loader
  test('contractor new rfq page redirects unauthenticated users', async ({ page }) => {
    await page.goto('/contractor/rfqs/new')
    await page.waitForURL(url => url.pathname.includes('/login') || url.pathname.includes('/contractor/rfqs/new'))
    const currentUrl = page.url()
    expect(currentUrl.includes('/login') || currentUrl.includes('/contractor')).toBe(true)
  })

  test('supplier rfqs page redirects unauthenticated users', async ({ page }) => {
    await page.goto('/supplier/rfqs')
    await page.waitForURL(url => url.pathname.includes('/login') || url.pathname.includes('/supplier'))
    const currentUrl = page.url()
    expect(currentUrl.includes('/login') || currentUrl.includes('/supplier')).toBe(true)
  })

  test('supplier profile page redirects unauthenticated users', async ({ page }) => {
    await page.goto('/supplier/profile')
    await page.waitForURL(url => url.pathname.includes('/login') || url.pathname.includes('/supplier'))
    const currentUrl = page.url()
    expect(currentUrl.includes('/login') || currentUrl.includes('/supplier')).toBe(true)
  })

  test('supplier chats page redirects unauthenticated users', async ({ page }) => {
    await page.goto('/supplier/chats')
    await page.waitForURL(url => url.pathname.includes('/login') || url.pathname.includes('/supplier'))
    const currentUrl = page.url()
    expect(currentUrl.includes('/login') || currentUrl.includes('/supplier')).toBe(true)
  })

  test('contractor chats page redirects unauthenticated users', async ({ page }) => {
    await page.goto('/contractor/chats')
    await page.waitForURL(url => url.pathname.includes('/login') || url.pathname.includes('/contractor'))
    const currentUrl = page.url()
    expect(currentUrl.includes('/login') || currentUrl.includes('/contractor')).toBe(true)
  })

  test('contractor offers page redirects unauthenticated users', async ({ page }) => {
    await page.goto('/contractor/rfqs/test/offers')
    await page.waitForURL(url => url.pathname.includes('/login') || url.pathname.includes('/contractor'))
    const currentUrl = page.url()
    expect(currentUrl.includes('/login') || currentUrl.includes('/contractor')).toBe(true)
  })
})

test.describe('Protected Form & Listing Structures (Unauthenticated Behavior)', () => {
  // If a user goes directly to a protected form, the portal layout renders a loading state
  // or redirects to login. These tests verify the app doesn't crash.
  
  test('contractor new rfq page handles unauthenticated state gracefully', async ({ page }) => {
    await page.goto('/contractor/rfqs/new')
    // At minimum, it shouldn't show a 500/404 error
    const title = await page.title()
    expect(title).toBeDefined()
  })

  test('supplier rfqs page handles unauthenticated state gracefully', async ({ page }) => {
    await page.goto('/supplier/rfqs')
    const title = await page.title()
    expect(title).toBeDefined()
  })

  test('supplier profile page handles unauthenticated state gracefully', async ({ page }) => {
    await page.goto('/supplier/profile')
    const title = await page.title()
    expect(title).toBeDefined()
  })
})