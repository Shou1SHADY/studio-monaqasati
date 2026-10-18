import { test, expect } from '@playwright/test'
import { LOCALES, VIEWPORTS, expectLoaded, expectNoSideScroll, firstOrSkip, watchErrors } from './helpers'

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
    test(`${path}: the tab strip is the portal's segmented pills — the same as the contractor's lists`, async ({ page }) => {
      await page.goto(path)
      await expectLoaded(page)
      const strip = page.getByRole('tablist').first()
      await expect(strip).toBeVisible()
      const tabs = strip.getByRole('tab')
      expect(await tabs.count()).toBeGreaterThanOrEqual(2)
      await expect(tabs.first()).toHaveCSS('border-radius', '9999px')
      await expect(strip.locator('[aria-selected="true"]')).toHaveCount(1)
    })
  }

  test('notifications: the unread dot is red, as everywhere else in the portal', async ({ page }) => {
    await page.goto('/supplier/notifications')
    await expectLoaded(page)
    const dot = await firstOrSkip(page.locator('span.h-2.w-2.rounded-full'), 'no unread notification on this account')
    await expect(dot).toHaveCSS('background-color', 'rgb(239, 68, 68)')
  })

  test('orders: a row opens the deal drawer with the five-step tracker, and Escape closes it', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto('/supplier/orders')
    await expectLoaded(page)
    const row = await firstOrSkip(page.locator('li.cursor-pointer'), 'no order on this account')
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
    const open = await firstOrSkip(page.locator('a, button').filter({ hasText: /قدّم عرضك|Submit your quote|Send a quote|Make an offer/i }), 'no open request on this account')
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

  test('the conversation shows the other side message as a grey bubble on the start side, mine tinted on the end side', async ({ page }) => {
    await page.goto('/supplier/orders')
    await expectLoaded(page)
    const row = await firstOrSkip(page.locator('li.cursor-pointer'), 'no order on this account')
    await row.click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    const section = drawer.locator('button[aria-expanded]').last()
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
    const theirs = await firstOrSkip(drawer.locator('div.rounded-xl.bg-muted').filter({ hasText: /\S/ }), 'this conversation has no message from the other side')
    const mine = await firstOrSkip(drawer.locator('div.rounded-xl.ms-auto'), 'this conversation has no message from the supplier')
    await expect(theirs).toHaveCSS('background-color', 'rgb(241, 245, 249)')
    await expect(theirs).toHaveCSS('border-radius', '12px')
    await expect(mine).toHaveCSS('border-radius', '12px')
    const [t, m, d] = [await theirs.boundingBox(), await mine.boundingBox(), await drawer.boundingBox()]
    // the other side starts at the reading start; mine sits at the end (right in LTR, left in RTL)
    const rtl = (await page.locator('html').getAttribute('dir')) === 'rtl'
    expect(rtl ? t!.x + t!.width > m!.x + m!.width : t!.x < m!.x).toBe(true)
    expect(t!.width).toBeLessThanOrEqual(d!.width * 0.86)
  })

  test('the deal conversation section opens and has its composer', async ({ page }) => {
    await page.goto('/supplier/orders')
    await expectLoaded(page)
    const row = await firstOrSkip(page.locator('li.cursor-pointer'), 'no order on this account')
    await row.click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    const section = drawer.locator('button[aria-expanded]').last()
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click()
    await expect(drawer.getByRole('textbox').first()).toBeVisible()
  })
})
