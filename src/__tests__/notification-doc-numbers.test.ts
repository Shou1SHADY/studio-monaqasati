/**
 * A notification reads its document numbers the way every screen shows them.
 *
 * UAT, 23 Sep: the supplier's bell and the Arabic push said "PO-2026/001"
 * while every screen said "ط.ش-2026/001". The number is STORED Latin (it is
 * data); the Arabic reader gets the Arabic prefix at render time.
 */

import { notificationCopy } from "@/lib/mfg-events"
import { renderProcCopy } from "@/lib/procurement/events"

const table: Record<string, string> = { pn_x_title: "أمر شراء جديد {number}", pn_x: "الاستلام {receipt} على {number} — {note}" }
const t = Object.assign((key: string, vars?: Record<string, string | number>) => table[key].replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? "")), {
  has: (key: string) => key in table,
})
const n = { i18n: { title: "pn_x_title", message: "pn_x", params: { number: "PO-2026/001", receipt: "GR-2026/004", note: "PO-style text left alone" } } }

describe("notificationCopy — the reader's locale", () => {
  it("an Arabic reader sees the Arabic prefixes", () => {
    expect(notificationCopy(n, t, "ar")).toEqual({ title: "أمر شراء جديد ط.ش-2026/001", message: "الاستلام ا.س-2026/004 على ط.ش-2026/001 — PO-style text left alone" })
  })

  it("an English reader, and a caller with no locale, see the stored number", () => {
    expect(notificationCopy(n, t, "en").title).toBe("أمر شراء جديد PO-2026/001")
    expect(notificationCopy(n, t).title).toBe("أمر شراء جديد PO-2026/001")
  })
})

describe("renderProcCopy — the Arabic text stored for push and the phone", () => {
  it("uses the Arabic prefix", () => {
    const copy = renderProcCopy("po_sent", { number: "PO-2026/001", company: "شركة البنيان" })
    expect(copy.title).toContain("ط.ش-2026/001")
    expect(copy.title).not.toContain("PO-2026/001")
  })
})
