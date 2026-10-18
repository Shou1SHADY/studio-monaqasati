import { test, expect, type Page } from '@playwright/test'
import { expectNoSideScroll, watchErrors } from './helpers'

// Needs a signed-in platform admin: E2E_ADMIN_STATE=<file from scripts/e2e-save-auth.mjs>.
// Opens a contractor's Components dialog and flips Finance. It never presses Save, so no company is changed.

test.skip(!process.env.E2E_ADMIN_STATE, 'set E2E_ADMIN_STATE (see scripts/e2e-save-auth.mjs)')

test.use({ viewport: { width: 1280, height: 800 } })

async function openComponents(page: Page) {
  await page.goto('/admin/contractors')
  const button = page.getByRole('button', { name: /^(المكوّنات|Components)$/ }).first()
  await expect(button).toBeVisible({ timeout: 45_000 })
  await button.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

test('a contractor has four component switches, in order: Project Management, Finance, HR, Manufacturing', async ({ page }) => {
  const errors = watchErrors(page)
  const dialog = await openComponents(page)
  const switches = dialog.getByRole('switch')
  await expect(switches).toHaveCount(4)
  const names = await switches.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  expect(names[0]).toMatch(/إدارة المشاريع|Project Management/)
  expect(names[1]).toMatch(/المالية|Finance/)
  expect(names[2]).toMatch(/الموارد البشرية|HR/)
  expect(names[3]).toMatch(/التصنيع|Manufacturing/)
  expect(errors.hooks()).toEqual([])
})

test('switching Finance off takes HR with it and locks HR; the others stay; Cancel changes nothing', async ({ page }) => {
  const dialog = await openComponents(page)
  const sw = dialog.getByRole('switch')
  const [pmSw, finance, hr, mfg] = [sw.nth(0), sw.nth(1), sw.nth(2), sw.nth(3)]
  test.skip((await finance.getAttribute('aria-checked')) !== 'true', 'this company already has Finance off')
  await finance.click()
  await expect(finance).toHaveAttribute('aria-checked', 'false')
  await expect(hr).toHaveAttribute('aria-checked', 'false')
  await expect(hr).toBeDisabled()
  await expect(pmSw).toHaveAttribute('aria-checked', 'true')
  await expect(mfg).toHaveAttribute('aria-checked', 'true')
  await expect(dialog.getByText(/تتوقف مع|Off with/)).toBeVisible()
  await dialog.getByRole('button', { name: /^(إلغاء|Cancel)$/ }).click()
  await expect(dialog).toBeHidden()
  const again = await openComponents(page)
  await expect(again.getByRole('switch').nth(1)).toHaveAttribute('aria-checked', 'true')
})

test('the contractors page fits the screen', async ({ page }) => {
  await page.goto('/admin/contractors')
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 45_000 })
  await expectNoSideScroll(page)
})
