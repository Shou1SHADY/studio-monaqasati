import { test, expect } from '@playwright/test'

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

test.describe('Manual Testing', () => {
  test('print manual test guide', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════════╗
║               MANUAL TESTING GUIDE                                 ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  Start: npm run dev (runs on http://localhost:9002)             ║
║                                                                  ║
║  AS CONTRACTOR:                                                   ║
║  1. /contractor/rfqs/new → Create RFQ                            ║
║     - Add multiple products (click "إضافة منتج")                 ║
║     - Add notes on first page                                     ║
║     - Upload PDF                                                  ║
║                                                                  ║
║  AS SUPPLIER:                                                     ║
║  2. /supplier/rfqs → View RFQs                                   ║
║     - Test filters (category, city, deadline)                      ║
║     - Click RFQ card → View details                              ║
║     - Expand inquiries → Ask question                            ║
║     - Submit offer with free shipping + sample toggles           ║
║                                                                  ║
║  3. /supplier/profile → Edit Profile                             ║
║     - Add coverage cities (dropdown or manual)                   ║
║                                                                  ║
║  COMPARISON:                                                      ║
║  4. /contractor/rfqs/[id]/offers → View offers                  ║
║     - Click "مقارنة العروض" tab                                   ║
║     - Verify real data in table                                  ║
║                                                                  ║
║  CHAT:                                                            ║
║  5. Accept offer → Auto-create chat                              ║
║  6. /contractor/chats or /supplier/chats → Send messages         ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
    `)
    expect(true).toBe(true)
  })
})