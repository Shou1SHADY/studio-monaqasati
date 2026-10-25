/**
 * PUR-06 — Procurement does not confirm receipt; the receiver does. No button
 * or prompt in a Procurement screen may promise an act that Procurement never
 * performs («تأكيد الاستلام» / «أكّد الاستلام»). The receiver-side screens, where
 * the act really happens, may use the phrase and are listed below.
 */

import fs from "fs"
import path from "path"
import ar from "../../messages/ar.json"
import en from "../../messages/en.json"

type Tree = { [key: string]: string | Tree }

const RECEIVER_SIDE_ALLOWED: string[] = []

const AR_LABEL = /^\s*(تأكيد الاستلام|تأكيد استلام الشحنة)\s*$/
const AR_PROMPT = /(^|[\s—–\-.،:])أكّ?د الاستلام/
const EN_LABEL = /^\s*confirm receipt\s*$/i
const EN_PROMPT = /confirm receipt (when|once)/i

function strings(node: Tree, prefix: string, out: Array<[string, string]> = []): Array<[string, string]> {
  for (const [key, value] of Object.entries(node)) {
    const at = `${prefix}.${key}`
    if (typeof value === "string") out.push([at, value])
    else strings(value, at, out)
  }
  return out
}

function procurementStrings(root: Tree): Array<[string, string]> {
  const portal = root.Portal as Tree
  const out: Array<[string, string]> = []
  for (const ns of Object.keys(portal)) {
    if (/^Proc/.test(ns)) strings(portal[ns] as Tree, `Portal.${ns}`, out)
  }
  for (const [key, value] of Object.entries(portal.Shared as Tree)) {
    if (key.startsWith("pn_") && typeof value === "string") out.push([`Portal.Shared.${key}`, value])
  }
  return out
}

describe("Procurement never promises to confirm receipt", () => {
  it("has no Arabic button label or prompt of that kind", () => {
    const bad = procurementStrings(ar as unknown as Tree).filter(([key, v]) => !RECEIVER_SIDE_ALLOWED.includes(key) && (AR_LABEL.test(v) || AR_PROMPT.test(v)))
    expect(bad).toEqual([])
  })

  it("has no English button label or prompt of that kind", () => {
    const bad = procurementStrings(en as unknown as Tree).filter(([key, v]) => !RECEIVER_SIDE_ALLOWED.includes(key) && (EN_LABEL.test(v) || EN_PROMPT.test(v)))
    expect(bad).toEqual([])
  })

  it("tells the contractor the notice is forwarded to the receiver", () => {
    const shared = (ar as unknown as { Portal: { Shared: Record<string, string> } }).Portal.Shared
    expect(shared.pn_delivery_notice).toContain("يُحوَّل للمستلم")
    const sharedEn = (en as unknown as { Portal: { Shared: Record<string, string> } }).Portal.Shared
    expect(sharedEn.pn_delivery_notice).toMatch(/forwarded to the receiver/)
  })

  it("labels the legacy notice's submit button with the receiver's act", () => {
    const contractor = (ar as unknown as { Portal: { Contractor: Record<string, string> } }).Portal.Contractor
    const contractorEn = (en as unknown as { Portal: { Contractor: Record<string, string> } }).Portal.Contractor
    expect(contractor.delivery_confirm_submit).toBe("سجّل الاستلام")
    expect(contractorEn.delivery_confirm_submit).not.toMatch(EN_LABEL)
  })

  it("reaches no Portal.Contractor label of that kind from a Procurement component", () => {
    const dir = path.join(process.cwd(), "src/components/procurement")
    const contractor = (ar as unknown as { Portal: { Contractor: Record<string, string> } }).Portal.Contractor
    const used: string[] = []
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const source = fs.readFileSync(path.join(dir, file), "utf8")
      const alias = /const (\w+) = useTranslations\("Portal\.Contractor"\)/.exec(source)?.[1]
      if (!alias) continue
      for (const m of source.matchAll(new RegExp(`\\b${alias}\\(\\s*["']([A-Za-z0-9_]+)["']`, "g"))) used.push(`${file}:${m[1]}`)
    }
    const bad = used.filter((u) => {
      const text = contractor[u.split(":")[1]]
      return typeof text === "string" && (AR_LABEL.test(text) || AR_PROMPT.test(text))
    })
    expect(bad).toEqual([])
  })
  it("G-09: no Procurement screen offers an act that records a receipt, or the retired receiving policies", () => {
    const root = process.cwd()
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.tsx?$/.test(entry.name)) files.push(full)
      }
    }
    walk(path.join(root, "src/components/procurement"))
    files.push(path.join(root, "src/components/contractor/ProcurementHeader.tsx"))
    // Settings shows the delivery notice route as the 2.0 prototype does — fixed, «it reaches Procurement first» — and only
    // ever writes it BACK to "procurement" for a 1.5 company that chose «both» (ST-01); no other screen names it.
    const settings = path.join(root, "src/components/procurement/ProcurementSettings.tsx")
    const offenders = files.filter((f) => (f === settings ? /ReceiveDeliveryDialog|recordReceipt|buyerReceives/ : /ReceiveDeliveryDialog|recordReceipt|buyerReceives|noticeRouting/).test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(root, f))
    expect(offenders).toEqual([])
    expect(fs.readFileSync(settings, "utf8")).not.toMatch(/noticeRouting:\s*"both"/)
  })
})
