// Saves a signed-in browser state for the live Playwright suite. YOU sign in in the window that opens (no password is
// read or typed by any script); the state — cookies, localStorage and IndexedDB, where Firebase keeps the session — is
// written to the file you name, and the specs read it through E2E_SUPPLIER_STATE / E2E_ADMIN_STATE.
//
//   node scripts/e2e-save-auth.mjs supplier e2e/.auth/supplier.json
//   node scripts/e2e-save-auth.mjs admin e2e/.auth/admin.json
//   node scripts/e2e-save-auth.mjs contractor e2e/.auth/contractor.json   (a member of a company whose Finance is off)
//
// Then:  E2E_SUPPLIER_STATE=e2e/.auth/supplier.json E2E_ADMIN_STATE=e2e/.auth/admin.json npx playwright test -c playwright.uat.config.ts

import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { chromium } from '@playwright/test'

const [, , who, out] = process.argv
if (!who || !out) {
  console.error('usage: node scripts/e2e-save-auth.mjs <supplier|admin|contractor> <output.json>')
  process.exit(1)
}
const base = process.env.E2E_BASE_URL || 'https://studio-monaqasati--mdmaktech-uat.us-east4.hosted.app'
const home = who === 'admin' ? '/admin' : who === 'contractor' ? '/contractor' : '/supplier'

const browser = await chromium.launch({ headless: false })
const context = await browser.newContext()
const page = await context.newPage()
await page.goto(`${base}/login`)
console.log(`Sign in as the ${who} in the browser window. Waiting up to 5 minutes for ${home}…`)
await page.waitForURL((u) => u.pathname.startsWith(home), { timeout: 300_000 })
await page.waitForTimeout(4000)
mkdirSync(dirname(out), { recursive: true })
await context.storageState({ path: out, indexedDB: true })
console.log(`Saved ${out}`)
await browser.close()
