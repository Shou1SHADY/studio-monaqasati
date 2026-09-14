// Printable accounting documents (statements of account, audit extracts).
//
// A self-contained window rather than print CSS on the app page: the portal's
// sidebar, toolbars and sheets never leak onto paper, and the document can be
// saved as PDF from the browser's print dialog with its own title. Every
// interpolated value goes through escapeHtml — descriptions and party names are
// user text.

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export function openPrintWindow(input: { title: string; dir: "rtl" | "ltr"; bodyHtml: string }): boolean {
  const w = window.open("", "_blank", "width=1000,height=760")
  if (!w) return false
  const align = input.dir === "rtl" ? "right" : "left"
  w.document.write(`<!doctype html><html dir="${input.dir}"><head><meta charset="utf-8">
<title>${escapeHtml(input.title)}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: "Noto Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif; color: #0f172a; margin: 0; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .muted { color: #64748b; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0 16px; }
  .kpi { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; }
  .kpi b { display: block; font-size: 14px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: ${align}; vertical-align: top; }
  th { background: #f1f5f9; font-size: 11px; }
  td.num, th.num { text-align: ${input.dir === "rtl" ? "left" : "right"}; direction: ltr; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.total td { font-weight: 700; background: #f8fafc; }
  .foot { margin-top: 24px; display: flex; justify-content: space-between; gap: 24px; }
  .sign { border-top: 1px solid #94a3b8; padding-top: 6px; width: 200px; text-align: center; }
</style></head><body>${input.bodyHtml}<script>window.onload = function () { window.print() }</script></body></html>`)
  w.document.close()
  return true
}
