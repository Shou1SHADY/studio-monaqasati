import { test, expect } from '@playwright/test'
import { watchErrors } from './helpers'

// Needs a signed-in platform admin: E2E_ADMIN_STATE. Read-only.

test.skip(!process.env.E2E_ADMIN_STATE, 'set E2E_ADMIN_STATE (see scripts/e2e-save-auth.mjs)')

for (const width of [1280, 1100]) {
  for (const path of ['/admin/contractors', '/admin/suppliers']) {
    test.describe(`${path} at ${width}px`, () => {
      test.use({ viewport: { width, height: 800 } })

      test('the table fits its card — nothing to slide sideways', async ({ page }) => {
        const errors = watchErrors(page)
        await page.goto(path)
        await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 45_000 })
        await page.waitForTimeout(1500)
        const { scroll, client } = await page.evaluate(() => {
          const wrap = document.querySelector('table')!.parentElement!
          return { scroll: wrap.scrollWidth, client: wrap.clientWidth }
        })
        expect(scroll, `table is ${scroll}px in a ${client}px card`).toBeLessThanOrEqual(client + 1)
        expect(errors.hooks()).toEqual([])
      })

      test('every account has View, Components and Verify/Unverify — owners and team members alike', async ({ page }) => {
        await page.goto(path)
        const rows = page.locator('tbody tr')
        await expect(rows.first()).toBeVisible({ timeout: 45_000 })
        await page.waitForTimeout(1500)
        const n = await rows.count()
        expect(n).toBeGreaterThan(0)
        await expect(rows.getByRole('button', { name: /^(المكوّنات|Components)$/ })).toHaveCount(n)
        await expect(rows.getByRole('button', { name: /^(عرض|View)$/ })).toHaveCount(n)
        const verifyOrUnverify = rows.getByRole('button', { name: /^(توثيق|Verify|إلغاء التوثيق|Unverify)/ })
        await expect(verifyOrUnverify).toHaveCount(n)
      })
    })
  }
}

test('a team member\'s Components button opens the owner company dialog with its four switches', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/admin/contractors')
  const memberRow = page.locator('tbody tr').filter({ hasText: /عضو في فريق|Team member of/ }).first()
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 45_000 })
  test.skip((await memberRow.count()) === 0, 'no team member in the first page of accounts')
  await memberRow.getByRole('button', { name: /^(المكوّنات|Components)$/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('switch')).toHaveCount(4)
  await dialog.getByRole('button', { name: /^(إلغاء|Cancel)$/ }).click()
})
