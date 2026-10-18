import { test, expect } from '@playwright/test'
import { LOCALES, VIEWPORTS, expectLoaded, expectNoSideScroll, watchErrors } from './helpers'

// Needs a signed-in free supplier: E2E_SUPPLIER_STATE=<file from scripts/e2e-save-auth.mjs>. Read-only: nothing is sent or saved.

test.skip(!process.env.E2E_SUPPLIER_STATE, 'set E2E_SUPPLIER_STATE (see scripts/e2e-save-auth.mjs)')

const ROUTES = ['/supplier', '/supplier/rfqs', '/supplier/offers', '/supplier/orders', '/supplier/invoices', '/supplier/connections', '/supplier/chats', '/supplier/notifications', '/supplier/profile', '/supplier/search?q=a']

for (const loc of LOCALES) {
  for (const vp of VIEWPORTS) {
    test.describe(`${loc.name} at ${vp.name} (${vp.width}px)`, () => {
      test.use({ viewport: { width: vp.width, height: vp.height } })

      for (const route of ROUTES) {
        test(`${route} loads, fits the screen and throws nothing (no React #310)`, async ({ page }) => {
          const errors = watchErrors(page)
          await page.goto(`${loc.prefix}${route}`)
          await expectLoaded(page)
          await page.waitForTimeout(1500)
          await expectNoSideScroll(page)
          await expect(page.locator('html')).toHaveAttribute('dir', loc.name === 'ar' ? 'rtl' : 'ltr')
          expect(errors.hooks()).toEqual([])
          expect(errors.crashes()).toEqual([])
        })
      }
    })
  }
}

test.describe('what was changed, on the live build', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  for (const path of ['/supplier/orders', '/supplier/invoices', '/supplier/offers', '/supplier/connections', '/supplier/profile']) {
    test(`${path}: the tab strip is the prototype grey track with rounded tabs`, async ({ page }) => {
      await page.goto(path)
      await expectLoaded(page)
      const track = page.getByRole('tablist').first()
      await expect(track).toBeVisible()
      const css = await track.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderRadius }))
      expect(css.bg).toBe('rgb(241, 245, 249)')
      expect(css.radius).toBe('12px')
    })
  }

  test('notifications: the unread dot is the brand blue', async ({ page }) => {
    await page.goto('/supplier/notifications')
    await expectLoaded(page)
    const dot = page.locator('span.h-2.w-2.rounded-full').first()
    test.skip((await dot.count()) === 0, 'no unread notification on this account')
    await expect(dot).toHaveCSS('background-color', 'rgb(3, 105, 161)')
  })

  test('orders: a row opens the deal drawer with the five-step tracker, and Escape closes it', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/supplier/orders')
    await expectLoaded(page)
    const row = page.locator('li.cursor-pointer').first()
    test.skip((await row.count()) === 0, 'no order on this account')
    await row.click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('ol[role="list"] > li')).toHaveCount(5)
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    expect(errors.hooks()).toEqual([])
  })

  test('requests: the quote dialog opens inside the screen, cannot be sent empty, and is not submitted here', async ({ page }) => {
    await page.goto('/supplier/rfqs')
    await expectLoaded(page)
    const open = page.getByRole('button', { name: /قدّم عرضك|Submit your quote|Send a quote|Quote/i }).first()
    test.skip((await open.count()) === 0, 'no open request on this account')
    await open.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const box = (await dialog.boundingBox())!
    const vp = page.viewportSize()!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
    await expect(dialog.getByRole('button', { name: /أرسل العرض|Send quote|Send offer/i })).toBeDisabled()
    await page.keyboard.press('Escape')
  })

  test('the deal conversation section opens and has its composer', async ({ page }) => {
    await page.goto('/supplier/orders')
    await expectLoaded(page)
    const row = page.locator('li.cursor-pointer').first()
    test.skip((await row.count()) === 0, 'no order on this account')
    await row.click()
    await expect(page.getByRole('dialog').getByRole('textbox').first()).toBeVisible()
  })
})
