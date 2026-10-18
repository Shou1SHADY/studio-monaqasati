import { expect, test, type Locator, type Page } from '@playwright/test'

export const VIEWPORTS = [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1280, height: 800 },
] as const

export const LOCALES = [
  { name: 'ar', prefix: '' },
  { name: 'en', prefix: '/en' },
] as const

/** Collects what the page throws: uncaught errors and console errors. React error #310 (hooks in a different order) is the one the suite exists to catch. */
export function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return {
    all: () => errors,
    hooks: () => errors.filter((e) => /Minified React error #310|Rendered (more|fewer) hooks/i.test(e)),
    crashes: () => errors.filter((e) => /^pageerror:/.test(e) && !/ResizeObserver|Script error/i.test(e)),
  }
}

/** The page is exactly as wide as the screen: nothing sticks out sideways. */
export async function expectNoSideScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))
  expect(scrollWidth, `page is ${scrollWidth}px wide in a ${innerWidth}px window`).toBeLessThanOrEqual(innerWidth + 1)
}

/** The page finished loading into something real: a heading, and not the app's error screen. */
export async function expectLoaded(page: Page) {
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 45_000 })
  await expect(page.getByText(/Application error|Something went wrong|حدث خطأ غير متوقع/i)).toHaveCount(0)
}

/** The first match once the page has had time to show it; the test is skipped (not failed) when the account has none. */
export async function firstOrSkip(locator: Locator, why: string): Promise<Locator> {
  const first = locator.first()
  const found = await first.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false)
  test.skip(!found, why)
  return first
}
