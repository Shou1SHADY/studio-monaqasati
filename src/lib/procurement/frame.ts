// What the portal frame needs to know of Procurement's pages (gaps FR-01, FR-03), kept apart from `shell.ts` so the frame
// every portal page loads does not carry Procurement's derivations.

/** The eight rail pages (`PROC_TABS` — a test keeps the two lists equal). Each draws `ProcurementHeader`, whose search is the
 * page's one search: the top bar's box steps aside there. */
export const PROC_TAB_PAGES: readonly string[] = [
  "/contractor/rfqs/today",
  "/contractor/rfqs/requests",
  "/contractor/rfqs",
  "/contractor/rfqs/orders",
  "/contractor/goods-received",
  "/contractor/suppliers",
  "/contractor/rfqs/reports",
  "/contractor/rfqs/settings",
]

export const isProcTabPage = (pathname: string): boolean => PROC_TAB_PAGES.includes(pathname)

/** The tabs whose list reads `?search=` as it changes — there the header's box filters the page as you type (prototype
 * «ابحث في هذه الصفحة…»); on the others Enter still jumps to the incoming requests (the expediter's orders). */
export const LIVE_SEARCH_TABS: readonly string[] = ["requests", "rfqs"]

/** The address of this page with `?search=` set to `term` (removed when blank), every other parameter kept. */
export function searchHref(pathname: string, params: URLSearchParams, term: string): string {
  const p = new URLSearchParams(params.toString())
  const q = term.trim()
  if (q) p.set("search", q)
  else p.delete("search")
  const qs = p.toString()
  return qs ? `${pathname}?${qs}` : pathname
}
