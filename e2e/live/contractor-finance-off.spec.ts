import { test, expect, type Browser, type Page } from '@playwright/test'
import { expectNoSideScroll, watchErrors } from './helpers'

// The contractor side of the Finance switch.
//
// Part 1 needs E2E_CONTRACTOR_STATE: a signed-in member of a contractor company whose Finance is ALREADY off
// (the admin turned it off in Components). Read-only.
//
// Part 2 changes data on UAT, so it runs only on purpose: E2E_ALLOW_WRITES=1, E2E_ADMIN_STATE, E2E_CONTRACTOR_STATE and
// E2E_TEST_COMPANY (the exact name of a UAT test contractor company). It switches that company's Finance off from the
// admin's Components dialog, checks what its own members then see, and switches Finance and HR back on at the end,
// even when a check failed.

const NOTICE = /This component is not switched on for your company|هذا المكوّن غير مفعّل لشركتك/
const FINANCE_PAGES = ['/contractor/accounting', '/contractor/accounting/journal', '/contractor/invoices', '/contractor/guarantees']
const STILL_OPEN = ['/contractor', '/contractor/rfqs', '/contractor/goods-received', '/contractor/warehouses', '/contractor/projects', '/contractor/sales']

async function expectFinanceOffForMember(page: Page) {
  const errors = watchErrors(page)

  await page.goto('/contractor')
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 45_000 })
  await expect(page.locator('a[href*="/contractor/accounting"]')).toHaveCount(0)
  await expect(page.locator('a[href*="/contractor/hr"]')).toHaveCount(0)

  for (const path of FINANCE_PAGES) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: NOTICE }), `${path} should be a notice`).toBeVisible({ timeout: 45_000 })
    await expectNoSideScroll(page)
  }

  await page.goto('/contractor/hr/people')
  await expect(page.getByRole('heading', { name: NOTICE })).toBeVisible({ timeout: 45_000 })

  for (const path of STILL_OPEN) {
    await page.goto(path)
    await expect(page.locator('h1').first(), `${path} should open`).toBeVisible({ timeout: 45_000 })
    await expect(page.getByRole('heading', { name: NOTICE }), `${path} must not be a notice`).toHaveCount(0)
  }

  expect(errors.hooks()).toEqual([])
  expect(errors.crashes()).toEqual([])
}

test.describe('a contractor whose Finance is already off', () => {
  test.skip(!process.env.E2E_CONTRACTOR_STATE, 'set E2E_CONTRACTOR_STATE (see scripts/e2e-save-auth.mjs)')
  test.use({ storageState: process.env.E2E_CONTRACTOR_STATE })

  for (const vp of [{ width: 375, height: 812 }, { width: 1280, height: 800 }]) {
    test(`Finance and HR are gone, everything else works (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize(vp)
      await expectFinanceOffForMember(page)
    })
  }
})

test.describe('switching a contractor company\'s Finance off and back on, end to end', () => {
  test.skip(
    process.env.E2E_ALLOW_WRITES !== '1' || !process.env.E2E_ADMIN_STATE || !process.env.E2E_CONTRACTOR_STATE || !process.env.E2E_TEST_COMPANY,
    'set E2E_ALLOW_WRITES=1, E2E_ADMIN_STATE, E2E_CONTRACTOR_STATE and E2E_TEST_COMPANY'
  )

  async function setFinance(browser: Browser, on: boolean) {
    const context = await browser.newContext({ storageState: process.env.E2E_ADMIN_STATE, viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    await page.goto('/admin/contractors')
    const company = process.env.E2E_TEST_COMPANY as string
    const row = page.locator('tr, [class*="card"], li').filter({ hasText: company }).first()
    await expect(row).toBeVisible({ timeout: 45_000 })
    await row.getByRole('button', { name: /^(المكوّنات|Components)$/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const sw = dialog.getByRole('switch')
    const finance = sw.nth(1)
    const hr = sw.nth(2)
    if ((await finance.getAttribute('aria-checked')) !== String(on)) await finance.click()
    if (on && (await hr.getAttribute('aria-checked')) !== 'true') await hr.click()
    await dialog.getByRole('button', { name: /^(حفظ|Save|تأكيد|Confirm)/ }).click()
    // a company with unfinished items asks to confirm once more
    const confirm = dialog.getByRole('button', { name: /تأكيد|Confirm/ })
    if (await confirm.isVisible().catch(() => false)) await confirm.click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
    await context.close()
  }

  test('off from the admin, the company members lose Finance and HR and keep everything else; back on restores it', async ({ browser }) => {
    try {
      await setFinance(browser, false)
      const member = await browser.newContext({ storageState: process.env.E2E_CONTRACTOR_STATE, viewport: { width: 1280, height: 800 } })
      const page = await member.newPage()
      await expectFinanceOffForMember(page)
      await member.close()
    } finally {
      await setFinance(browser, true)
    }
    const after = await browser.newContext({ storageState: process.env.E2E_CONTRACTOR_STATE, viewport: { width: 1280, height: 800 } })
    const page = await after.newPage()
    await page.goto('/contractor/accounting')
    await expect(page.getByRole('heading', { name: NOTICE })).toHaveCount(0)
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 45_000 })
    await after.close()
  })
})
