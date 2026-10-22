import { test, expect, type Page } from '@playwright/test'
import { expectNoSideScroll, firstOrSkip, watchErrors } from './helpers'

// Procurement 2.0 — every page of the module loads clean for a signed-in contractor, at a phone (375 px) and a desktop (1366 px), in both
// languages. READ-ONLY: it never clicks anything that writes. Needs E2E_CONTRACTOR_STATE (a company owner, see scripts/e2e-save-auth.mjs) on
// UAT, ideally one seeded with scripts/seed-proc20-demo.ts so the lists have something in them. Optional: E2E_PO_ID opens an order's
// drawer. Complements contractor-procurement.spec.ts (the 1.5 pages at 1366 px, Arabic) — this one adds the 2.0 pages, the RFQ page's
// four tabs, the other language and the phone width. Run with the `procurement-v2` project of playwright.uat.config.ts.

test.skip(!process.env.E2E_CONTRACTOR_STATE, 'set E2E_CONTRACTOR_STATE (see scripts/e2e-save-auth.mjs)')
test.use({ storageState: process.env.E2E_CONTRACTOR_STATE })

const VIEWS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1366, height: 900 },
] as const
const LOCALES = [
  { name: 'ar', prefix: '', dir: 'rtl' },
  { name: 'en', prefix: '/en', dir: 'ltr' },
] as const

const PAGES = [
  '/contractor/rfqs/today',
  '/contractor/rfqs/requests',
  '/contractor/rfqs',
  '/contractor/rfqs/new',
  '/contractor/rfqs/orders',
  '/contractor/goods-received',
  '/contractor/suppliers',
  '/contractor/rfqs/reports',
  '/contractor/rfqs/settings',
  '/contractor/rfqs/guide',
  '/contractor/rfqs/chats',
  '/contractor/rfqs/my-requests',
]

const RETIRED = [/تأكيد الاستلام/, /Confirm receipt/i, /\bPR-\d/, /الأسعار مغلقة حتى/, /prices (stay )?sealed/i, /\bunseal/i, /\b(?:proc|prj|inv|fin|mfg|sup):[A-Z]{2,}/]
const SERVER_TEXT = /Application error|Something went wrong|حدث خطأ غير متوقع|Missing or insufficient permissions/

async function settle(page: Page) {
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(5000)
}

async function expectClean(page: Page, errors: ReturnType<typeof watchErrors>, dir: string) {
  await expectNoSideScroll(page)
  await expect(page.locator('html')).toHaveAttribute('dir', dir)
  const body = await page.locator('body').innerText()
  expect(body).not.toMatch(SERVER_TEXT)
  for (const re of RETIRED) expect(body, `${re} must not appear`).not.toMatch(re)
  expect(errors.hooks()).toEqual([])
  expect(errors.crashes()).toEqual([])
  expect(errors.all().filter((e) => /Missing or insufficient permissions/.test(e)), 'Firestore refused a read').toEqual([])
}

for (const loc of LOCALES) {
  for (const view of VIEWS) {
    test.describe(`${loc.name} at ${view.name} (${view.width}px)`, () => {
      test.use({ viewport: { width: view.width, height: view.height } })

      for (const path of PAGES) {
        test(`${path} loads clean`, async ({ page }) => {
          test.setTimeout(150_000)
          const errors = watchErrors(page)
          await page.goto(`${loc.prefix}${path}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
          await settle(page)
          await expectClean(page, errors, loc.dir)
        })
      }

      test('the RFQ page opens on its four tabs', async ({ page }) => {
        test.setTimeout(240_000)
        const errors = watchErrors(page)
        await page.goto(`${loc.prefix}/contractor/rfqs`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
        await settle(page)
        const link = await firstOrSkip(page.locator('a[href*="/contractor/rfqs/"][href*="/offers"]'), 'this company has no RFQ yet')
        const href = (await link.getAttribute('href')) as string
        const base = href.replace(/\?.*$/, '')
        for (const tab of ['list', 'compare', 'inquiries', 'details']) {
          await page.goto(`${base}?tab=${tab}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
          await settle(page)
          await expect(page.getByRole('tab')).toHaveCount(4)
          await expectClean(page, errors, loc.dir)
        }
      })

      test('an order opens in its drawer', async ({ page }) => {
        test.skip(!process.env.E2E_PO_ID, 'set E2E_PO_ID (an order of this company) to open its drawer')
        const errors = watchErrors(page)
        await page.goto(`${loc.prefix}/contractor/rfqs/orders?po=${process.env.E2E_PO_ID}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
        await settle(page)
        await expectClean(page, errors, loc.dir)
      })
    })
  }
}

test('the eight pages are one rail: the same names as the sidebar, in the same order (G-11)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto('/contractor/rfqs/requests', { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await settle(page)
  const rail = ['اليوم', 'طلبات الشراء الواردة', 'طلبات العروض', 'أوامر الشراء', 'سندات الاستلام', 'الموردون', 'التقارير', 'الإعدادات']
  const body = await page.locator('body').innerText()
  let at = -1
  for (const name of rail) {
    const next = body.indexOf(name, at + 1)
    expect(next, `«${name}» should follow the previous name`).toBeGreaterThan(at)
    at = next
  }
})
