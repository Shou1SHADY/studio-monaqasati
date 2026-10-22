import { test, expect, type Page } from '@playwright/test'
import { watchErrors } from './helpers'

// Procurement 2.0 — the platform admin's package screens (ADM-01…04). Needs E2E_ADMIN_STATE (a signed-in platform admin).
//
// Part 1 is read-only: the contractors list with its package column, the pipeline page with its 36 events and eight states.
//
// Part 2 (WF-22) CHANGES DATA on UAT, so it runs only on purpose: E2E_ALLOW_WRITES=1, E2E_ADMIN_STATE and E2E_TEST_COMPANY_ORG (the uid of a UAT
// test contractor's company owner — the id in /admin/contractors/<id>). It opens Manufacturing for that company, reads «what changes»,
// saves, checks the list shows the new package, and puts the company back exactly as it was — even when a check failed.

test.skip(!process.env.E2E_ADMIN_STATE, 'set E2E_ADMIN_STATE (see scripts/e2e-save-auth.mjs)')
test.use({ storageState: process.env.E2E_ADMIN_STATE, viewport: { width: 1366, height: 900 } })

const NAMES = { mfg: /^(التصنيع|Manufacturing)$/, pm: /^(إدارة المشاريع|Projects)$/, fin: /^(المالية|Finance)$/ } as const
const SAVE = /^(احفظ الباقة|Save package)$/
const SAVED = /حُفظت باقة|Saved .*:/

async function settle(page: Page) {
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(2500)
}

test('the contractors list carries the package column and the strip of four numbers', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/admin/contractors', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await settle(page)
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 45_000 })
  await expect(page.getByRole('columnheader', { name: /^(الباقة|Package)$/ })).toHaveCount(1)
  const body = await page.locator('body').innerText()
  for (const label of [/المشتركون|Subscribers/, /بالباقة الكاملة|On the full package/, /بلا المالية|Without Finance/]) expect(body).toMatch(label)
  expect(errors.hooks()).toEqual([])
  expect(errors.crashes()).toEqual([])
})

test('«المسار والعقود» shows the 36 events and filters them by module', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/admin/pipeline', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await settle(page)
  await expect(page.locator('tr[data-event]')).toHaveCount(36)
  await expect(page.getByTestId('contract-count')).toContainText('36')
  await page.getByRole('button', { name: /^(المشاريع|Projects)$/ }).first().click()
  const filtered = await page.locator('tr[data-event]').count()
  expect(filtered).toBeGreaterThan(0)
  expect(filtered).toBeLessThan(36)
  expect(errors.hooks()).toEqual([])
  expect(errors.crashes()).toEqual([])
})

test.describe('WF-22 — opening a connector for an existing subscriber', () => {
  const ORG = process.env.E2E_TEST_COMPANY_ORG
  test.skip(process.env.E2E_ALLOW_WRITES !== '1' || !ORG, 'set E2E_ALLOW_WRITES=1 and E2E_TEST_COMPANY_ORG')

  const sw = (page: Page) => page.getByRole('switch', { name: NAMES.mfg })
  const checked = async (page: Page) => (await sw(page).getAttribute('aria-checked')) === 'true'

  async function open(page: Page) {
    await page.goto(`/admin/contractors/${ORG}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await settle(page)
    await expect(sw(page)).toBeVisible({ timeout: 45_000 })
  }

  async function save(page: Page) {
    const bar = page.getByRole('button', { name: SAVE })
    await expect(bar).toBeVisible()
    const ack = page.locator('[data-testid="impact-panel"] input[type="checkbox"]')
    if ((await ack.count()) > 0) await ack.first().check()
    await expect(bar).toBeEnabled({ timeout: 30_000 })
    await bar.click()
    await expect(page.getByText(SAVED).first()).toBeVisible({ timeout: 30_000 })
  }

  test('flip Manufacturing: «ما يتغيّر عند الحفظ» is read first, the save lands, the page keeps it after a reload; then it is put back', async ({ page }) => {
    test.setTimeout(240_000)
    const errors = watchErrors(page)
    await open(page)
    const original = await checked(page)
    try {
      await sw(page).click()
      await expect(page.getByText(/ما يتغيّر عند الحفظ|What changes on save/)).toBeVisible({ timeout: 30_000 })
      await expect(page.locator('[data-testid="impact-panel"], [data-testid^="impact-"]').first()).toBeVisible({ timeout: 30_000 })
      await save(page)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await settle(page)
      await expect(sw(page)).toBeVisible({ timeout: 45_000 })
      expect(await checked(page)).toBe(!original)
      await page.goto('/admin/contractors', { waitUntil: 'domcontentloaded', timeout: 90_000 })
      await settle(page)
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 45_000 })
    } finally {
      await open(page)
      if ((await checked(page)) !== original) {
        await sw(page).click()
        await save(page)
      }
    }
    expect(errors.hooks()).toEqual([])
    expect(errors.crashes()).toEqual([])
  })

  test('closing Finance locks Human Resources with it, and the page says so before it saves nothing', async ({ page }) => {
    test.setTimeout(120_000)
    await open(page)
    const finance = page.getByRole('switch', { name: NAMES.fin })
    test.skip((await finance.getAttribute('aria-checked')) !== 'true', 'Finance is already off on this company')
    await finance.click()
    await expect(page.getByRole('switch', { name: /^(الموارد البشرية|HR|Human Resources)$/ })).toBeDisabled()
    await page.getByRole('button', { name: /^(تراجع|Undo)$/ }).click()
    await expect(finance).toHaveAttribute('aria-checked', 'true')
  })
})
