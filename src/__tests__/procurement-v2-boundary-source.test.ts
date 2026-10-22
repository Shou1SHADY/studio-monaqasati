/** @jest-environment node */
/**
 * Procurement 2.0 — the boundaries that are written in the words and in the code (QA pack 3/5, B-01, B-08, B-12; the retired price-seal words are in the names test):
 *   B-01  no «تأكيد الاستلام» in Procurement: the receipt is the receiver's, Procurement shows the notice's state and its button only;
 *   B-08  nothing is sent automatically from the buyer's side to a supplier: a message to a supplier is a link on the user's own device;
 *   B-12  no developer event key (proc:ISS…) in any screen the contractor reads;
 */

import fs from "fs"
import path from "path"

type Tree = { [k: string]: string | Tree }
const load = (locale: "ar" | "en") => JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8")) as Tree
const MESSAGES = { ar: load("ar"), en: load("en") }

function* walk(node: Tree | string, prefix = ""): Generator<[string, string]> {
  if (typeof node === "string") {
    yield [prefix, node]
    return
  }
  for (const [k, v] of Object.entries(node)) yield* walk(v, prefix ? `${prefix}.${k}` : k)
}

const PROCUREMENT_NAMESPACES = [
  "Portal.Procurement",
  "Portal.ProcToday",
  "Portal.ProcChats",
  "Portal.ProcOrders",
  "Portal.ProcReceipts",
  "Portal.ProcReports",
  "Portal.ProcPrices",
  "Portal.ProcReceivers",
  "Portal.ProcSubscription",
  "Portal.ProcMyRequests",
  "Portal.ProcPackage",
  "Portal.ProcSettings",
  "Portal.ProcSuppliers",
  "Portal.ProcGuide",
  "Portal.ProcSoon",
  "Portal.ProcEditor",
  "PublicRfq",
  "PoLink",
]
const inProcurement = (key: string) => PROCUREMENT_NAMESPACES.some((ns) => key === ns || key.startsWith(`${ns}.`))
const procurementStrings = (locale: "ar" | "en") => [...walk(MESSAGES[locale])].filter(([k]) => inProcurement(k))

const SRC = path.join(process.cwd(), "src")
function files(dir: string, ext = /\.(ts|tsx)$/): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name), ext) : ext.test(e.name) ? [path.join(dir, e.name)] : []))
}
const rel = (f: string) => path.relative(process.cwd(), f).replace(/\\/g, "/")

describe("the namespaces are the ones Procurement owns", () => {
  it("there are strings to read in both languages", () => {
    expect(procurementStrings("ar").length).toBeGreaterThan(1500)
    expect(procurementStrings("en").length).toBeGreaterThan(1500)
  })
})

describe("B-01 — no «تأكيد الاستلام» in Procurement", () => {
  it("Arabic: the phrase appears only where a line says there is no such button", () => {
    const bad = procurementStrings("ar").filter(([, v]) => /تأكيد الاستلام|تاكيد الاستلام/.test(v) && !/^لا زر/.test(v))
    expect(bad.map(([k]) => k)).toEqual([])
  })

  it("English: «Confirm receipt» appears only where a line says there is no such button", () => {
    const bad = procurementStrings("en").filter(([, v]) => /confirm(ing)? (the )?receipt|receipt confirmation/i.test(v) && !/^No “?Confirm receipt/i.test(v))
    expect(bad.map(([k]) => k)).toEqual([])
  })

  it("no Procurement route or component is named for confirming a receipt", () => {
    const named = [...files(path.join(SRC, "components/procurement")), ...files(path.join(SRC, "app/api/procurement"))].filter((f) => /confirm[-_]?(the[-_]?)?receipt|receipt[-_]?confirm|grn[-_]?ok/i.test(rel(f)))
    expect(named.map(rel)).toEqual([])
  })
})

describe("B-12 — no developer key on a contractor's screen", () => {
  const KEY = /\b(?:proc|prj|inv|fin|mfg|sup|hr|adv):[A-Z]{2,}/
  for (const locale of ["ar", "en"] as const) {
    it(`${locale}: no event key (proc:ISS, inv:CHK, fin:PAID…) in a Procurement string`, () => {
      expect(procurementStrings(locale).filter(([, v]) => KEY.test(v)).map(([k]) => k)).toEqual([])
    })
  }
})

describe("B-08 — no automatic message from the buyer's side to a supplier", () => {
  const BUYER_TO_SUPPLIER = [
    ...files(path.join(SRC, "app/api/po-link")),
    ...files(path.join(SRC, "app/api/rfq-share")),
    ...files(path.join(SRC, "app/api/procurement/po")),
    ...files(path.join(SRC, "app/api/procurement/rfq")),
    ...files(path.join(SRC, "app/api/procurement/offers")),
    ...files(path.join(SRC, "lib/procurement/rfq-server")),
    ...files(path.join(SRC, "lib/procurement")).filter((f) => /po-(server|link-server|messages-server|extra-writes)|offer-decisions-server|reaward-server/.test(f)),
  ].filter((f) => !/\.test\./.test(f))

  it("the files that talk to suppliers exist", () => {
    expect(BUYER_TO_SUPPLIER.length).toBeGreaterThan(15)
  })

  it("none of them sends a WhatsApp or a direct message, or calls a messaging network address", () => {
    const hits = BUYER_TO_SUPPLIER.filter((f) => /\b(sendWhatsApp|sendDirectMessage)\b|api\.whatsapp|graph\.facebook|twilio\.com\/.*Messages/.test(fs.readFileSync(f, "utf8"))).map(rel)
    expect(hits).toEqual([])
  })

  it("the only text message they send is the visitor's own verification code", () => {
    const sms = BUYER_TO_SUPPLIER.filter((f) => /\bsendSms\b/.test(fs.readFileSync(f, "utf8"))).map(rel)
    expect(sms.every((f) => /rfq-share\/\[token\]\/code|offer\/route|guest-offer/.test(f))).toBe(true)
  })

  it("the device hand-off exists: the composer builds a wa.me link and sends nothing itself", () => {
    const model = fs.readFileSync(path.join(SRC, "components/procurement/PoModel.ts"), "utf8")
    expect(model).toMatch(/wa\.me/)
    expect(model).not.toMatch(/fetch\(/)
  })
})
