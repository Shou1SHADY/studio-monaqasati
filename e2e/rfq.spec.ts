import { test, expect } from '@playwright/test'

test.describe('Monaqasati Page Structure Tests', () => {
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

  test('contractor new rfq page loads', async ({ page }) => {
    await page.goto('/contractor/rfqs/new')
    const url = page.url()
    expect(url.includes('/contractor/rfqs/new') || url.includes('/login')).toBe(true)
  })

  test('supplier rfqs page loads', async ({ page }) => {
    await page.goto('/supplier/rfqs')
    const url = page.url()
    expect(url.includes('/supplier/rfqs') || url.includes('/login')).toBe(true)
  })

  test('supplier profile page loads', async ({ page }) => {
    await page.goto('/supplier/profile')
    const url = page.url()
    expect(url.includes('/supplier/profile') || url.includes('/login')).toBe(true)
  })

  test('supplier chats page loads', async ({ page }) => {
    await page.goto('/supplier/chats')
    const url = page.url()
    expect(url.includes('/supplier/chats') || url.includes('/login')).toBe(true)
  })

  test('contractor chats page loads', async ({ page }) => {
    await page.goto('/contractor/chats')
    const url = page.url()
    expect(url.includes('/contractor/chats') || url.includes('/login')).toBe(true)
  })

  test('contractor offers page loads', async ({ page }) => {
    await page.goto('/contractor/rfqs/test/offers')
    const url = page.url()
    expect(url.includes('/contractor/rfqs') || url.includes('/login')).toBe(true)
  })
})

test.describe('RFQ Form Structure', () => {
  test('products section exists', async ({ page }) => {
    await page.goto('/contractor/rfqs/new')
    const html = await page.innerHTML('body')
    expect(html).toContain('المنتجات المطلوبة')
  })

  test('add product button exists', async ({ page }) => {
    await page.goto('/contractor/rfqs/new')
    const html = await page.innerHTML('body')
    expect(html).toContain('إضافة منتج')
  })

  test('pdf upload section exists', async ({ page }) => {
    await page.goto('/contractor/rfqs/new')
    const html = await page.innerHTML('body')
    expect(html).toContain('ملفات PDF')
  })

  test('notes section exists', async ({ page }) => {
    await page.goto('/contractor/rfqs/new')
    const html = await page.innerHTML('body')
    expect(html).toContain('ملاحظات')
  })
})

test.describe('RFQ Listing Structure', () => {
  test('supplier rfqs page renders', async ({ page }) => {
    await page.goto('/supplier/rfqs')
    const html = await page.innerHTML('body')
    expect(html).toContain('المناقصات المتاحة')
  })
})

test.describe('Profile Structure', () => {
  test('supplier profile page renders', async ({ page }) => {
    await page.goto('/supplier/profile')
    const html = await page.innerHTML('body')
    expect(html).toContain('الملف الشخصي')
  })
})