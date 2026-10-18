import { test, expect, type Browser, type Locator, type Page } from '@playwright/test'
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
  await page.waitForTimeout(2000)
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
      await page.goto('/contractor')
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 45_000 })
      await page.waitForTimeout(2000)
      test.skip((await page.locator('a[href*="/contractor/accounting"]').count()) > 0, 'this company still has Finance ON — switch it off in Components first, or use the opt-in cycle test')
      await expectFinanceOffForMember(page)
    })
  }
})

test.describe('switching a contractor company Finance off and back on, end to end', () => {
  test.skip(
    process.env.E2E_ALLOW_WRITES !== '1' || !process.env.E2E_ADMIN_STATE || !process.env.E2E_CONTRACTOR_STATE || !process.env.E2E_TEST_COMPANY,
    'set E2E_ALLOW_WRITES=1, E2E_ADMIN_STATE, E2E_CONTRACTOR_STATE and E2E_TEST_COMPANY'
  )

  type Chosen = { finance: boolean; hr: boolean }

  /** Opens the admin's Components dialog for exactly the named company (never another row), runs `act`, and closes it. */
  async function withDialog(browser: Browser, act: (dialog: Locator) => Promise<void>) {
    const context = await browser.newContext({ storageState: process.env.E2E_ADMIN_STATE, viewport: { width: 1280, height: 800 } })
    try {
      const page = await context.newPage()
      await page.goto('/admin/contractors')
      const company = process.env.E2E_TEST_COMPANY as string
      const rows = page.locator('tbody tr').filter({ hasText: company })
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 45_000 })
      if ((await rows.count()) === 0) {
        await page.getByRole('textbox').first().fill(company)
        await page.waitForTimeout(1500)
      }
      await expect(rows, `exactly one row must match "${company}"`).toHaveCount(1)
      await rows.getByRole('button', { name: /^(المكوّنات|Components)$/ }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await act(dialog)
      await expect(dialog).toBeHidden({ timeout: 30_000 })
    } finally {
      await context.close()
    }
  }

  const checked = async (sw: Locator) => (await sw.getAttribute('aria-checked')) === 'true'

  async function save(dialog: Locator) {
    await dialog.getByRole('button', { name: /^(حفظ|Save)$/ }).click()
    // a company with unfinished items is told what is pending and confirms once more ("Switch off and save")
    const confirm = dialog.getByRole('button', { name: /^(إيقاف وحفظ|Switch off and save)$/ })
    const asked = await confirm.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)
    if (asked) await confirm.click()
  }

  async function readChosen(browser: Browser): Promise<Chosen> {
    let chosen: Chosen = { finance: true, hr: true }
    await withDialog(browser, async (dialog) => {
      const sw = dialog.getByRole('switch')
      chosen = { finance: await checked(sw.nth(1)), hr: await checked(sw.nth(2)) }
      await dialog.getByRole('button', { name: /^(إلغاء|Cancel)$/ }).click()
    })
    return chosen
  }

  /** Puts the company's Finance and HR exactly where they were before the test touched them. */
  async function restore(browser: Browser, original: Chosen) {
    await withDialog(browser, async (dialog) => {
      const sw = dialog.getByRole('switch')
      if ((await checked(sw.nth(1))) !== original.finance) await sw.nth(1).click()
      if (original.finance && (await checked(sw.nth(2))) !== original.hr) await sw.nth(2).click()
      await save(dialog)
    })
  }

  test('off from the admin, the company members lose Finance and HR and keep everything else; back on restores exactly what was there', async ({ browser }) => {
    test.setTimeout(300_000)
    const original = await readChosen(browser)
    test.skip(!original.finance, 'this company already has Finance off; nothing to switch')
    try {
      await withDialog(browser, async (dialog) => {
        await dialog.getByRole('switch').nth(1).click()
        await expect(dialog.getByRole('switch').nth(2)).toBeDisabled()
        await save(dialog)
      })
      const member = await browser.newContext({ storageState: process.env.E2E_CONTRACTOR_STATE, viewport: { width: 1280, height: 800 } })
      try {
        await expectFinanceOffForMember(await member.newPage())
      } finally {
        await member.close()
      }
    } finally {
      await restore(browser, original)
    }
    const after = await browser.newContext({ storageState: process.env.E2E_CONTRACTOR_STATE, viewport: { width: 1280, height: 800 } })
    try {
      const page = await after.newPage()
      await page.goto('/contractor/accounting')
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 45_000 })
      await expect(page.getByRole('heading', { name: NOTICE })).toHaveCount(0)
    } finally {
      await after.close()
    }
    const now = await readChosen(browser)
    expect(now).toEqual(original)
  })
})
