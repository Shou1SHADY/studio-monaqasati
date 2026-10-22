/**
 * Procurement 2.0 — the visitor link's pure parts: the maths shown while he prices (the comparison's own), the four mandatory
 * fields and the price as one list of reasons (LNK-05, LNK-07, NFR-07), what the page is told of the request (LNK-01, G-06),
 * and the message that goes out with the link — opened on the buyer's own device, never sent by the platform (LNK-12, B-08).
 */

import fs from "node:fs"
import path from "node:path"
import { grossOf, lineTotal, linesNet } from "@/lib/procurement/link-pricing"
import { validateLinkQuote, type LinkQuoteInput } from "@/lib/procurement/link-validate"
import { buildLinkMessage, mailHref, materialsText, whatsappHref } from "@/lib/procurement/link-messages"
import { buildLinkView, linkStateOf, resultOf, visitorTitle } from "@/lib/procurement/rfq-share-view"
import { lineCalc } from "@/lib/procurement/offer-calc"
import { MAX_UNIT_PRICE } from "@/lib/procurement/input-limits"

describe("the line he is pricing is the comparison's own maths (LNK-05, G-02)", () => {
  it("20 pieces of 6 m for 175 m... is ⌈175 ÷ 6⌉ = 30 pieces, 180 m received, 5 m over", () => {
    expect(lineTotal(175, 74, 6)).toMatchObject({ pcs: 30, received: 180, extra: 5, total: 2220, per: 6 })
    expect(lineTotal(175, 146, 12)).toMatchObject({ pcs: 15, received: 180, total: 2190 })
  })

  it("«20 قطعة 6 م = 120 متر · 1,200 ر.س»: 120 m asked, priced 60 a piece", () => {
    expect(lineTotal(120, 60, 6)).toMatchObject({ pcs: 20, received: 120, extra: 0, total: 1200 })
  })

  it("per request unit it is rate × quantity, and it equals offer-calc's line to the halala", () => {
    const x = lineTotal(320, 3.6)
    expect(x).toMatchObject({ pcs: null, total: 1152, effective: 3.6 })
    expect(Math.round((x?.total ?? 0) * 100)).toBe(lineCalc(320, 3.6).totalH)
  })

  it("a blank, zero or unreadable price prices nothing", () => {
    for (const p of ["", "0", "abc", null, -3]) expect(lineTotal(100, p)).toBeNull()
  })

  it("the total is the sum of what he prices, a skipped line adds nothing, VAT is 15% unless he is not registered", () => {
    const net = linesNet([
      { qty: 175, price: 74, per: 6 },
      { qty: 320, price: 3.6 },
      { qty: 10, price: 999, skipped: true },
    ])
    expect(net).toBe(3372)
    expect(grossOf(net, true)).toBe(3877.8)
    expect(grossOf(net, false)).toBe(3372)
  })
})

describe("four mandatory fields and a reasonable price, as one list (LNK-07, NFR-07)", () => {
  const base: LinkQuoteInput = {
    pricing: "line",
    lines: [
      { index: 0, qty: 175, price: "74", per: 6 },
      { index: 1, qty: 320, price: "3.6" },
    ],
    days: "5",
    valid: "2026-11-10",
    close: "2026-10-25",
    company: "Al Noor",
    mobile: "0551234567",
  }
  const codes = (over: Partial<LinkQuoteInput>) => validateLinkQuote({ ...base, ...over }).issues.map((i) => i.code)

  it("a complete quote has no reason and a net", () => {
    expect(validateLinkQuote(base)).toEqual({ issues: [], net: 3372 })
  })

  it("days are a whole number from 1 to 365 — 9,999, 0, 1.5 and blank are refused", () => {
    for (const days of ["9999", "0", "1.5", "", "366", "abc"]) expect(codes({ days })).toContain("days")
    for (const days of ["1", "365", 5]) expect(codes({ days })).not.toContain("days")
  })

  it("validity is required and may not end before the request closes", () => {
    expect(codes({ valid: "" })).toEqual(["valid_missing"])
    expect(codes({ valid: "2026-10-24" })).toEqual(["valid_before_close"])
    expect(codes({ valid: "2026-10-25" })).toEqual([])
  })

  it("the company and a Saudi mobile (05XXXXXXXX, either numeral set)", () => {
    expect(codes({ company: " a " })).toEqual(["company"])
    expect(codes({ mobile: "0612345678" })).toEqual(["mobile"])
    expect(codes({ mobile: "٠٥٥١٢٣٤٥٦٧" })).toEqual([])
  })

  it("prices: at least one, none zero, none beyond reason", () => {
    expect(codes({ lines: [{ index: 0, qty: 1, price: "" }] })).toEqual(["no_price"])
    expect(codes({ lines: [{ index: 0, qty: 1, price: "0" }, { index: 1, qty: 1, price: "5" }] })).toEqual(["price_zero"])
    expect(codes({ lines: [{ index: 0, qty: 1, price: String(MAX_UNIT_PRICE + 1) }] })).toContain("price_big")
    expect(codes({ lines: [{ index: 0, qty: 1, price: "5" }, { index: 1, qty: 1, price: "", skipped: true }] })).toEqual([])
  })

  it("a lump-sum request asks a single total", () => {
    expect(codes({ pricing: "total", lines: [], total: "" })).toEqual(["total_missing"])
    expect(validateLinkQuote({ ...base, pricing: "total", lines: [], total: "5,000" }).net).toBe(5000)
  })

  it("lists every reason in the order they are shown, so the page names the first and counts the rest", () => {
    expect(codes({ lines: [], days: "", valid: "", company: "", mobile: "" })).toEqual(["no_price", "days", "valid_missing", "company", "mobile"])
  })
})

describe("what the page is told of the request (LNK-01, LNK-02, G-06)", () => {
  const rfq = {
    rfqNumber: "RFQ-2026/012",
    title: "Villa Al Olaya — block B",
    status: "New",
    deadline: "2026-10-25",
    city: "Riyadh",
    district: "Al Olaya",
    pricingMode: "line",
    locationCoords: { lat: 24.7, lng: 46.6 },
    address: "Street 4, plot 12",
    paymentTermsList: [{ pct: 100, days: 30 }],
    deliveryOptions: { s1: { unload: "us", slot: "am", note: "Gate 3, call the foreman" } },
    products: [
      { name: "Angle iron", quantity: 175, unitOfMeasure: "m", saleUnits: [{ ar: "قطعة 6 م", en: "piece 6 m", lengthM: 6 }], warrantyMonths: 24, needBy: "2026-11-01", deliveryCity: "Riyadh", deliveryDistrict: "Al Olaya", projectName: "Villa Al Olaya" },
      { name: "Timber", quantity: 320, unitOfMeasure: "m", needBy: "2026-10-30" },
    ],
  }

  it("the visitor-facing name is the materials, never the buyer's title or the project", () => {
    expect(visitorTitle(rfq)).toBe("Angle iron و Timber")
    expect(visitorTitle({ products: [{ name: "a" }, { name: "b" }, { name: "c" }, { name: "d" }] }, (n) => ` +${n}`)).toBe("a و b +2")
  })

  it("carries the city and district, the earliest need, the terms, the delivery options, each line's sale units and warranty — and no pin, no address, no project", () => {
    const { rfq: view } = buildLinkView(rfq, "R1", new Date("2026-10-13T06:00:00Z"))
    expect(view).toMatchObject({ number: "RFQ-2026/012", places: [{ city: "Riyadh", district: "Al Olaya" }], needBy: "2026-10-30", termsList: [{ pct: 100, days: 30 }], delivery: { unload: "us", slot: "am" }, accessNote: "Gate 3, call the foreman", state: "open", pricing: "line", lump: false })
    expect(view.lines[0]).toMatchObject({ saleUnits: [{ lengthM: 6, ar: "قطعة 6 م", en: "piece 6 m" }], warrantyMonths: 24, needBy: "2026-11-01" })
    const text = JSON.stringify(view)
    for (const leak of ["24.7", "Street 4", "Villa", "locationCoords", "projectName"]) expect(text).not.toContain(leak)
  })

  it("states: open, closed after the deadline's own day (Riyadh), awarded, cancelled", () => {
    expect(linkStateOf(rfq, new Date("2026-10-25T20:59:00Z"))).toBe("open")
    expect(linkStateOf(rfq, new Date("2026-10-25T21:01:00Z"))).toBe("closed")
    expect(linkStateOf({ ...rfq, status: "Awarded" }, new Date("2026-10-13T00:00:00Z"))).toBe("awarded")
    expect(linkStateOf({ ...rfq, status: "Cancelled" }, new Date("2026-10-13T00:00:00Z"))).toBe("cancelled")
  })

  it("a request of several materials priced as a total is a lump sum; closing early is told", () => {
    const { rfq: view } = buildLinkView({ ...rfq, pricingMode: "total", status: "Awarded", awardedAt: "2026-10-20T08:00:00.000Z" }, "R1", new Date("2026-10-22T00:00:00Z"))
    expect(view).toMatchObject({ lump: true, state: "awarded", closedEarly: true, closedAt: "2026-10-20T08:00:00.000Z" })
  })

  it("his result: awarded only once the order is out; without an order he was not awarded; cancelled carries its reason", () => {
    expect(resultOf("open", {}, false, null).kind).toBe("open")
    expect(resultOf("closed", {}, false, null).kind).toBe("review")
    expect(resultOf("awarded", { poId: "P1" }, false, null).kind).toBe("review")
    expect(resultOf("awarded", { poId: "P1" }, true, null).kind).toBe("awarded")
    expect(resultOf("awarded", {}, false, null).kind).toBe("lost")
    expect(resultOf("cancelled", {}, false, "spec")).toEqual({ kind: "cancelled", cancelCode: "spec" })
  })
})

describe("the message that goes with the link (LNK-12)", () => {
  const input = { company: "Acme", title: "Angle iron و Timber", materials: 2, places: ["الرياض — العليا"], closeDay: "2026-10-25", url: "https://mdmaktech.sa/rfq/abcdefghijklmnopqrstuv", locale: "ar" as const }

  it("is the PRD's wording: who asks, what, how many, where, until when, the link", () => {
    const { text, subject } = buildLinkMessage(input)
    expect(text.split("\n")).toEqual(["السلام عليكم،", "Acme تطلب منكم عرض سعر عبر مدماك:", "«Angle iron و Timber» — مادتان، والتسليم في الرياض — العليا.", expect.stringMatching(/^آخر موعد للتقديم .*2026|^آخر موعد للتقديم /), "قدّم عرضك بلا حساب من الرابط:", input.url])
    expect(subject).toBe("طلب عرض سعر — Angle iron و Timber")
    expect(buildLinkMessage({ ...input, locale: "en" }).text).toContain("Quote without an account here:")
  })

  it("counts materials in Arabic's own forms", () => {
    expect([1, 2, 5, 11].map((n) => materialsText(n, "ar"))).toEqual(["مادة واحدة", "مادتان", "5 مواد", "11 مادة"])
  })

  it("opens WhatsApp and the mail client from the buyer's device — a wa.me / mailto address with the text", () => {
    const { text, subject } = buildLinkMessage(input)
    expect(whatsappHref(text)).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`)
    expect(mailHref(subject, text)).toMatch(/^mailto:\?subject=.+&body=.+/)
  })
})

describe("no WhatsApp integration, no automatic send (B-08, MSG-05)", () => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))

  it("nothing on the visitor-link surface calls a WhatsApp API or the platform's message sender", () => {
    const roots = ["src/app/api/rfq-share", "src/components/procurement/guest", "src/components/procurement/rfq", "src/app/[locale]/rfq"]
    const own = ["src/lib/procurement/link-messages.ts", "src/lib/procurement/visitor-offer-server.ts", "src/lib/procurement/visitor-http.ts"]
    const files = [...roots.flatMap((r) => walk(path.join(process.cwd(), r))), ...own.map((f) => path.join(process.cwd(), f))].filter((f) => /\.(ts|tsx)$/.test(f))
    expect(files.length).toBeGreaterThan(20)
    const hits = files.filter((f) => /graph\.facebook\.com|api\.whatsapp|sendWhatsApp|sendDirectMessage|whatsapp-web/i.test(fs.readFileSync(f, "utf8")))
    expect(hits).toEqual([])
  })

  it("the composer only builds an address and opens it in a window from the click — it never fetches it", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/procurement/rfq/LinkComposer.tsx"), "utf8")
    expect(src).toContain("window.open(href")
    expect(src).not.toMatch(/fetch\(\s*(whatsappHref|mailHref|`https:\/\/wa\.me)/)
  })
})
