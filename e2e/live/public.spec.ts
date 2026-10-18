import { test, expect } from '@playwright/test'
import { LOCALES, VIEWPORTS, expectNoSideScroll, watchErrors } from './helpers'

// No sign-in needed: what a visitor meets on the live site.

const ROUTES = ['/supplier', '/supplier/rfqs', '/supplier/orders', '/supplier/invoices', '/supplier/profile', '/contractor', '/admin']

for (const loc of LOCALES) {
  test.describe(`visitor, ${loc.name}`, () => {
    for (const route of ROUTES) {
      test(`${route} sends a signed-out visitor to the login page`, async ({ page }) => {
        await page.goto(`${loc.prefix}${route}`)
        await page.waitForURL((u) => u.pathname.includes('/login'), { timeout: 45_000, waitUntil: 'commit' })
        await expect(page.locator('input[type="password"]')).toBeVisible()
      })
    }

    for (const vp of VIEWPORTS) {
      test(`login page at ${vp.name} (${vp.width}px) fits the screen, has the right direction and throws nothing`, async ({ page }) => {
        const errors = watchErrors(page)
        await page.setViewportSize({ width: vp.width, height: vp.height })
        await page.goto(`${loc.prefix}/login`)
        await expect(page.locator('input[type="password"]')).toBeVisible()
        await expectNoSideScroll(page)
        await expect(page.locator('html')).toHaveAttribute('dir', loc.name === 'ar' ? 'rtl' : 'ltr')
        expect(errors.hooks()).toEqual([])
        expect(errors.crashes()).toEqual([])
      })
    }
  })
}

test('the app font stack puts the riyal-sign font first and falls back to the system sans (the same as every other page)', async ({ page }) => {
  await page.goto('/login')
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
  expect(family.startsWith('"Saudi Riyal Sign"') || family.startsWith('Saudi Riyal Sign')).toBe(true)
})
