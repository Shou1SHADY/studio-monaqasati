/**
 * Procurement 2.0, SET-05 / B-12 — the developers' text is not in the customer's bundle: no event key of the contract
 * («proc:PO:…», «prj:MR:…», «fin:PAY:…») in any Procurement namespace the customer reads, none of the dead developer
 * sections of the old Settings page, and no file that built them. The keys live in the admin portal's pipeline page.
 */

import fs from "fs"
import path from "path"

type Json = { [k: string]: Json | string }
const load = (l: string) => (JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", `${l}.json`), "utf8")) as { Portal: Json }).Portal

const KEY = /\b(proc|prj|inv|fin|mfg|sup):[A-Z]/

function strings(node: Json | string, prefix: string, out: Array<[string, string]> = []): Array<[string, string]> {
  if (typeof node === "string") out.push([prefix, node])
  else for (const [k, v] of Object.entries(node)) strings(v, `${prefix}.${k}`, out)
  return out
}

describe("B-12: no programme keys in what the contractor reads", () => {
  for (const locale of ["ar", "en"] as const) {
    const portal = load(locale)
    const customerNamespaces = Object.keys(portal).filter((ns) => ns.startsWith("Proc") && ns !== "ProcPackage")

    it(`${locale}: the Procurement namespaces are found`, () => {
      expect(customerNamespaces).toEqual(expect.arrayContaining(["ProcSettings", "ProcGuide", "ProcToday"]))
    })

    it.each(customerNamespaces)(`${locale}: Portal.%s carries no event key`, (ns) => {
      const hits = strings(portal[ns], ns).filter(([, value]) => KEY.test(value))
      expect(hits).toEqual([])
    })

    it(`${locale}: nor does Portal.ProcPackage — the connector texts speak of what the connector does, not of its keys`, () => {
      expect(strings(portal.ProcPackage, "ProcPackage").filter(([, value]) => KEY.test(value))).toEqual([])
    })

    it(`${locale}: the old Settings page's developer sections are gone`, () => {
      const settings = portal.ProcSettings as Json
      for (const dead of ["seg", "path", "flow", "ideas", "owns", "link", "never", "notBuilt", "conflict", "blog", "folds", "party"]) expect(settings[dead]).toBeUndefined()
      const panel = settings.polPanel as Json
      for (const dead of ["smallFirm", "noInventory", "noWorkshop", "enforced"]) expect(panel[dead]).toBeUndefined()
      const segments = Object.keys(settings.segment as Json)
      expect(segments).not.toEqual(expect.arrayContaining(["flow"]))
      expect(segments).not.toEqual(expect.arrayContaining(["link"]))
      expect(segments).not.toEqual(expect.arrayContaining(["gap"]))
    })
  }

  it("the derived boundary log is gone, with the module that built it", () => {
    expect(fs.existsSync(path.join(process.cwd(), "src", "lib", "procurement", "boundary.ts"))).toBe(false)
  })

  it("no source file reads a key of the removed sections", () => {
    const root = path.join(process.cwd(), "src")
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (/\.(ts|tsx)$/.test(e.name) && !full.includes("__tests__")) {
          const source = fs.readFileSync(full, "utf8")
          if (!source.includes('useTranslations("Portal.ProcSettings")')) continue
          if (/\bt\(\s*[`"'](seg|path|flow|ideas|owns|link|never|notBuilt|conflict|blog|folds|party)\./.test(source)) hits.push(path.relative(root, full))
        }
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })
})

describe("the team's page keeps the keys the customer no longer sees", () => {
  it("every event key is in the admin registry, not in the messages", () => {
    const { EVENTS } = jest.requireActual<typeof import("@/lib/procurement/package-data")>("@/lib/procurement/package-data")
    expect(EVENTS).toHaveLength(36)
    const bundle = JSON.stringify(load("ar")) + JSON.stringify(load("en"))
    const inMessages = EVENTS.filter((e) => bundle.includes(e.key))
    expect(inMessages.map((e) => e.key)).toEqual([])
  })
})
