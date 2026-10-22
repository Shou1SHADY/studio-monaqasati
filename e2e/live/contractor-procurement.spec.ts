import { test, expect } from '@playwright/test'
import { expectNoSideScroll, watchErrors } from './helpers'

// Needs a signed-in contractor: E2E_CONTRACTOR_STATE. Read-only. Procurement 1.5 — every page of the module loads with
// no Firestore permission error, no React #310, nothing sideways, and none of the wording the spec removed.

test.skip(!process.env.E2E_CONTRACTOR_STATE, 'set E2E_CONTRACTOR_STATE (see scripts/e2e-save-auth.mjs)')
test.use({ storageState: process.env.E2E_CONTRACTOR_STATE, viewport: { width: 1366, height: 900 } })

const PAGES = ['/contractor/rfqs/today', '/contractor/rfqs/requests', '/contractor/rfqs', '/contractor/rfqs/new', '/contractor/rfqs/orders', '/contractor/goods-received', '/contractor/suppliers', '/contractor/rfqs/reports', '/contractor/rfqs/settings']

const REMOVED_WORDING = [/تأكيد الاستلام/, /انشره الآن/, /\bPR-\d/]

for (const path of PAGES) {
  test(`${path} loads clean: no permission error, no #310, nothing sideways, no removed wording`, async ({ page }) => {
    test.setTimeout(150_000)
    const errors = watchErrors(page)
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 60_000 })
    await page.waitForTimeout(6000)
    await expectNoSideScroll(page)
    const body = (await page.locator('body').innerText()).replace(/لا زر «تأكيد الاستلام» في المشتريات/g, '')
    for (const re of REMOVED_WORDING) expect(body, `${re} must not appear`).not.toMatch(re)
    expect(errors.hooks()).toEqual([])
    expect(errors.crashes()).toEqual([])
    expect(errors.all().filter((e) => /Missing or insufficient permissions/.test(e)), 'Firestore refused a read').toEqual([])
  })
}

test('incoming requests: one card per request with its project number and the two buttons', async ({ page }) => {
  await page.goto('/contractor/rfqs/requests', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(6000)
  const publish = page.getByRole('button', { name: /^انشره$/ })
  test.skip((await publish.count()) === 0, 'no new incoming request on this company')
  await expect(page.getByRole('link', { name: /^جهّزه$/ }).first()).toBeVisible()
  await expect(page.locator('body')).toContainText(/ط\.م\s?\d+/)
})

test('suppliers: the invitations section loads', async ({ page }) => {
  await page.goto('/contractor/suppliers', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(6000)
  await expect(page.getByRole('button', { name: /ادعُ|دعوة/ }).first()).toBeVisible()
})
