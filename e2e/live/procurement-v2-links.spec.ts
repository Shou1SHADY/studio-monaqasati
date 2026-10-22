import { test, expect, type Page } from '@playwright/test'
import { expectNoSideScroll, watchErrors } from './helpers'

// Procurement 2.0 — the two links a supplier outside the platform opens, read the way a stranger reads them. NO sign-in, READ-ONLY (nothing is
// submitted, accepted or reported). Needs the tokens the seed printed (scripts/seed-proc20-demo.ts --apply), as full addresses:
//   E2E_RFQ_LINK     the visitor link of an OPEN RFQ            e.g. https://…/rfq/AbCd…
//   E2E_ORDER_LINK   the order link of a SENT off-platform order e.g. https://…/po/AbCd…
//   E2E_CLOSED_LINK  (optional) the visitor link of an RFQ that is awarded, cancelled or past its deadline
//   E2E_FOREIGN      (optional) names that must NOT appear on these pages, comma separated; default: the seed's other suppliers
//   E2E_ORDER_NO     (optional) the order's bare number, e.g. 2026/009
// Run with the `procurement-v2` project of playwright.uat.config.ts.

const RFQ_LINK = process.env.E2E_RFQ_LINK
const ORDER_LINK = process.env.E2E_ORDER_LINK
const CLOSED_LINK = process.env.E2E_CLOSED_LINK
const FOREIGN = (process.env.E2E_FOREIGN || 'مصنع الجودة,مصنع الشرق للحديد,الوسطى للتجارة,مؤسسة الأفق,مصنع النور,مؤسسة الفجر,مؤسسة الريان للتجارة,البركة لمواد البناء,الخليج للأخشاب,عمران للتوريدات,الصفا للدهانات').split(',').map((s) => s.trim()).filter(Boolean)
const TOKEN = /^[A-Za-z0-9_-]{22}$/

const tokenOf = (url: string) => url.replace(/[?#].*$/, '').split('/').filter(Boolean).pop() as string
const originOf = (url: string) => new URL(url).origin
const inEnglish = (url: string) => url.replace(originOf(url), `${originOf(url)}/en`)
const COORDS = /\b2[0-9]\.\d{4,}\s*,\s*4[0-9]\.\d{4,}\b/

async function readable(page: Page, errors: ReturnType<typeof watchErrors>) {
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(3000)
  await expectNoSideScroll(page)
  expect(await page.locator('body').innerText()).not.toMatch(/Application error|Something went wrong|حدث خطأ غير متوقع/)
  expect(errors.hooks()).toEqual([])
  expect(errors.crashes()).toEqual([])
}

const VIEWS = [{ width: 375, height: 812 }, { width: 1366, height: 900 }]

test.describe('the visitor link of an open RFQ', () => {
  test.skip(!RFQ_LINK, 'set E2E_RFQ_LINK (the seed prints it)')

  for (const view of VIEWS) {
    for (const english of [false, true]) {
      test(`opens at ${view.width}px in ${english ? 'English' : 'Arabic'} and shows no other supplier's name, price or site pin`, async ({ page }) => {
        test.setTimeout(120_000)
        const errors = watchErrors(page)
        await page.setViewportSize(view)
        await page.goto(english ? inEnglish(RFQ_LINK as string) : (RFQ_LINK as string), { waitUntil: 'domcontentloaded', timeout: 90_000 })
        await readable(page, errors)
        await expect(page.locator('html')).toHaveAttribute('dir', english ? 'ltr' : 'rtl')
        const body = await page.locator('body').innerText()
        for (const name of FOREIGN) expect(body, `«${name}» belongs to another supplier`).not.toContain(name)
        expect(body).not.toMatch(COORDS)
        expect(await page.locator('input').count(), 'the page asks for a price').toBeGreaterThan(0)
      })
    }
  }

  test('the API answers the open request with its own facts only: no offers list, no site pin, canSubmit true', async ({ request }) => {
    const res = await request.get(`${originOf(RFQ_LINK as string)}/api/rfq-share/${tokenOf(RFQ_LINK as string)}`)
    expect(res.status()).toBe(200)
    const json = await res.json()
    expect(json.data.canSubmit).toBe(true)
    const text = JSON.stringify(json)
    expect(text).not.toMatch(/locationCoords|"offers"|guestContact|tokenHashes/)
    for (const name of FOREIGN) expect(text).not.toContain(name)
  })

  test('a link that never existed opens nothing (400 for a malformed token, 404 for an unknown one)', async ({ request }) => {
    const origin = originOf(RFQ_LINK as string)
    expect((await request.get(`${origin}/api/rfq-share/short`)).status()).toBe(400)
    const unknown = 'Zz'.repeat(11)
    expect(unknown).toMatch(TOKEN)
    expect((await request.get(`${origin}/api/rfq-share/${unknown}`)).status()).toBe(404)
  })
})

test.describe('a closed RFQ link', () => {
  test.skip(!CLOSED_LINK, 'set E2E_CLOSED_LINK (an awarded, cancelled or expired RFQ link)')

  test('refuses: the API says it takes no offer, and the page offers no price box', async ({ page, request }) => {
    test.setTimeout(120_000)
    const res = await request.get(`${originOf(CLOSED_LINK as string)}/api/rfq-share/${tokenOf(CLOSED_LINK as string)}`)
    expect([200, 410]).toContain(res.status())
    if (res.status() === 200) expect((await res.json()).data.canSubmit).toBe(false)
    const errors = watchErrors(page)
    await page.goto(CLOSED_LINK as string, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await readable(page, errors)
    await expect(page.locator('input[type="number"], input[inputmode="decimal"]')).toHaveCount(0)
  })
})

test.describe('the order link of a sent off-platform order', () => {
  test.skip(!ORDER_LINK, 'set E2E_ORDER_LINK (the seed prints it)')

  for (const view of VIEWS) {
    test(`opens at ${view.width}px with one order, its lines and its date, and nothing of another order or of the buyer's people`, async ({ page }) => {
      test.setTimeout(120_000)
      const errors = watchErrors(page)
      await page.setViewportSize(view)
      await page.goto(ORDER_LINK as string, { waitUntil: 'domcontentloaded', timeout: 90_000 })
      await readable(page, errors)
      const body = await page.locator('body').innerText()
      const numbers = [...new Set(body.match(/\b20\d{2}\/\d{3}\b/g) || [])]
      expect(numbers, 'exactly one order number on the page').toHaveLength(1)
      if (process.env.E2E_ORDER_NO) expect(numbers[0]).toBe(process.env.E2E_ORDER_NO)
      for (const name of FOREIGN) expect(body, `«${name}» belongs to another order`).not.toContain(name)
      expect(body).not.toMatch(/\b(?:proc|prj|inv|fin|mfg|sup):[A-Z]{2,}/)
    })
  }

  test('the API carries no approver, no preparer and no reason for the choice of supplier', async ({ request }) => {
    const res = await request.get(`${originOf(ORDER_LINK as string)}/api/po-link/${tokenOf(ORDER_LINK as string)}`)
    expect(res.status()).toBe(200)
    expect(JSON.stringify(await res.json())).not.toMatch(/approvedBy|preparedBy|notLowest|tokenHashes|organizationId|supplierOrgId/)
  })

  test('an order token is not an RFQ link, and the reverse', async ({ request }) => {
    test.skip(!RFQ_LINK, 'needs both links')
    const origin = originOf(ORDER_LINK as string)
    expect((await request.get(`${origin}/api/rfq-share/${tokenOf(ORDER_LINK as string)}`)).status()).toBeGreaterThanOrEqual(400)
    expect((await request.get(`${origin}/api/po-link/${tokenOf(RFQ_LINK as string)}`)).status()).toBeGreaterThanOrEqual(400)
  })
})
