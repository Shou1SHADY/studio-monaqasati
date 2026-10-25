/**
 * Procurement 2.0, FLW-01..03 — «كيف تعمل المشتريات؟»: the eight stations and the sources of a request follow the package,
 * every sentence and button the page can name exists in both languages, every button is a plain link to a page that exists,
 * and the pure layer never writes anything (B-10, R-30).
 */

import fs from "fs"
import path from "path"
import { flowSources, flowStations, GUIDE_HREF, legendRoles, MY_REQUESTS_HREF, ROLE_IDS, STATION_IDS } from "@/lib/procurement/guide"
import { PACKAGE_STATES, type PackageFlags } from "@/lib/procurement/package"

const flags = (pm: boolean, fin: boolean, mfg: boolean): PackageFlags => ({ pm, fin, mfg })
const base = flags(false, false, false)
const full = flags(true, true, true)

const ar = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", "ar.json"), "utf8")) as { Portal: { ProcGuide: Record<string, unknown> } }
const en = JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", "en.json"), "utf8")) as { Portal: { ProcGuide: Record<string, unknown> } }
const at = (root: Record<string, unknown>, key: string): unknown => key.split(".").reduce<unknown>((n, p) => (n && typeof n === "object" ? (n as Record<string, unknown>)[p] : undefined), root)

describe("the eight stations", () => {
  it("are eight, in the prototype's order, in every one of the eight packages", () => {
    for (const s of PACKAGE_STATES) {
      const stations = flowStations(s.pkg)
      expect(stations.map((x) => x.id)).toEqual([...STATION_IDS])
      expect(stations.map((x) => x.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    }
  })

  it("the first station is the project manager's with Projects and the requester's without", () => {
    const withPm = flowStations(full)[0]
    expect([withPm.who, withPm.whatKey]).toEqual([["pm"], "station.request.what_pm"])
    const without = flowStations(base)[0]
    expect([without.who, without.whatKey]).toEqual([["req"], "station.request.what_team"])
  })

  it("the last station is Finance's with Finance and the buyer's without it", () => {
    expect([flowStations(full)[7].who, flowStations(full)[7].whatKey]).toEqual([["fin"], "station.close.what_fin"])
    expect([flowStations(base)[7].who, flowStations(base)[7].whatKey]).toEqual([["buy"], "station.close.what_nofin"])
  })

  it("the extra lines follow the connectors: the workshop in the first two stations, Finance at the award", () => {
    const get = (pkg: PackageFlags, id: string) => flowStations(pkg).find((x) => x.id === id)?.more
    // Without Projects the first station also says the team approval is optional (REQ-05, the owner's decision of 25 Oct 2026).
    expect(get(base, "request")).toEqual(["approval", "need_line"])
    expect(get(flags(false, false, true), "request")).toEqual(["approval", "need_line", "mfg_sends"])
    expect(get(full, "request")).toEqual(["need_line", "mfg_sends"])
    expect(get(flags(false, false, true), "incoming")).toEqual(["inv_asked", "mfg_asked"])
    expect(get(base, "award")).toEqual(["bnpl"])
    expect(get(flags(false, true, false), "award")).toEqual(["fin", "bnpl"])
    expect(get(base, "receive")).toEqual(["stock"])
  })

  it("the sentence about approving team requests before Procurement is there without Projects only (decision 03 settled: owner or site manager)", () => {
    for (const s of PACKAGE_STATES) expect(flowStations(s.pkg)[0].more.includes("approval")).toBe(!s.pkg.pm)
    expect(JSON.stringify(ar.Portal.ProcGuide)).toContain("اعتماد قبل المشتريات اختياري")
  })

  it("with Projects the project manager sees the first seven; the requester sees the last — without Projects always the requester", () => {
    expect(flowStations(full).map((x) => x.seesBy)).toEqual(["pm", "pm", "pm", "pm", "pm", "pm", "pm", "requester"])
    expect(new Set(flowStations(base).map((x) => x.seesBy))).toEqual(new Set(["requester"]))
  })

  it("previewing a package without Projects from a company WITH Projects says the preview creates nothing, and offers no button on the station", () => {
    const preview = flowStations(base, full)[0]
    expect(preview.previewOnly).toBe(true)
    expect(preview.links).toEqual([])
    const own = flowStations(base, base)[0]
    expect(own.previewOnly).toBe(false)
    // «ارفع طلباً نيابةً عنه» opens the dialog on «طلباتي» directly (IN-18).
    expect(own.links.map((l) => l.href)).toEqual([MY_REQUESTS_HREF, `${MY_REQUESTS_HREF}?raise=1`])
    expect(own.links.map((l) => l.labelKey)).toEqual(["btn.open_mine_as", "btn.on_behalf_him"])
    expect(flowStations(full, full)[0].links).toEqual([])
  })

  it("is a pure function of its arguments", () => {
    const frozen = Object.freeze({ ...full })
    expect(flowStations(frozen, frozen)).toEqual(flowStations(frozen, frozen))
    expect(flowSources(frozen, frozen)).toEqual(flowSources(frozen, frozen))
  })
})

describe("the sources of a request", () => {
  it("without Projects: the team, the buyer on someone's behalf, Inventory — and the workshop when it is in the package", () => {
    expect(flowSources(base).map((s) => s.id)).toEqual(["team", "buy", "inv"])
    expect(flowSources(flags(false, false, true)).map((s) => s.id)).toEqual(["team", "buy", "inv", "mfg"])
  })

  it("with Projects: the projects replace the team and the buyer's own door", () => {
    expect(flowSources(full).map((s) => s.id)).toEqual(["pm", "inv", "mfg"])
    expect(flowSources(flags(true, true, false)).map((s) => s.id)).toEqual(["pm", "inv"])
  })

  it("the buyer's door is a link only when the company itself has no Projects", () => {
    expect(flowSources(base, base).find((s) => s.id === "buy")?.link?.href).toBe(`${MY_REQUESTS_HREF}?raise=1`)
    expect(flowSources(base, full).find((s) => s.id === "buy")?.link).toBeNull()
  })
})

describe("the legend", () => {
  it("lists the roles of the package: no requester with Projects, no project manager without, Finance and the workshop only when in it", () => {
    expect(legendRoles(base)).toEqual(["req", "buy", "app", "sup", "rcv", "inv"])
    expect(legendRoles(full)).toEqual(["pm", "buy", "app", "sup", "rcv", "inv", "fin", "mfg"])
    expect(ROLE_IDS).toHaveLength(9)
  })
})

describe("every name the page can use exists in both languages", () => {
  const keys = (pkg: PackageFlags, actual: PackageFlags) => {
    const out = new Set<string>()
    for (const s of flowStations(pkg, actual)) {
      out.add(s.whatKey)
      out.add(`station.${s.id}.name`)
      out.add(`sees.${s.sees}`)
      s.more.forEach((m) => out.add(`more.${m}`))
      s.links.forEach((l) => out.add(l.labelKey))
      s.who.forEach((r) => out.add(`role.${r}`))
    }
    for (const src of flowSources(pkg, actual)) {
      out.add(`source.${src.id}.title`)
      out.add(`source.${src.id}.body`)
      if (src.link) out.add(src.link.labelKey)
      out.add(`role.${src.role}`)
    }
    legendRoles(pkg).forEach((r) => out.add(`role.${r}`))
    return out
  }
  const all = new Set<string>()
  for (const a of PACKAGE_STATES) for (const b of PACKAGE_STATES) keys(a.pkg, b.pkg).forEach((k) => all.add(k))

  it.each([...all].sort())("%s", (key) => {
    expect(typeof at(ar.Portal.ProcGuide, key)).toBe("string")
    expect(typeof at(en.Portal.ProcGuide, key)).toBe("string")
  })

  it("the guide's own address, the two links and the strip", () => {
    expect(GUIDE_HREF).toBe("/contractor/rfqs/guide")
    for (const key of ["link.incoming", "link.mine", "strip.label", "strip.title", "strip.back", "head.title", "head.desc", "pkg.label", "pkg.base", "pkg.caption", "pkg.preview", "pkg.mine", "h2.sources", "h2.path", "note", "sees_requester", "sees_pm", "preview_only_request"]) {
      expect(typeof at(ar.Portal.ProcGuide, key)).toBe("string")
      expect(typeof at(en.Portal.ProcGuide, key)).toBe("string")
    }
  })

  it("the Arabic names are the prototype's", () => {
    const names = STATION_IDS.map((id) => at(ar.Portal.ProcGuide, `station.${id}.name`))
    expect(names).toEqual(["الطلب", "الوارد", "النشر", "العروض", "الترسية والأمر", "التوريد", "الاستلام", "الإقفال والدفع"])
    expect(ROLE_IDS.map((r) => at(ar.Portal.ProcGuide, `role.${r}`))).toEqual(["طالب المواد", "مدير المشروع", "المشتري", "المعتمد", "المورّد", "المستلم", "أمين المستودع", "المالية", "الورشة"])
  })
})

describe("every button is a plain link to a page that exists", () => {
  const appDir = path.join(process.cwd(), "src", "app", "[locale]")
  const exists = (href: string): boolean => {
    const wanted = href.split("?")[0].split("/").filter(Boolean)
    const walk = (dir: string, i: number): boolean => {
      if (i === wanted.length) return fs.existsSync(path.join(dir, "page.tsx"))
      return fs.readdirSync(dir, { withFileTypes: true }).some((e) => {
        if (!e.isDirectory()) return false
        const invisible = e.name.startsWith("(")
        if (invisible) return walk(path.join(dir, e.name), i)
        return (e.name === wanted[i] || (e.name.startsWith("[") && e.name.endsWith("]"))) && walk(path.join(dir, e.name), i + 1)
      })
    }
    return walk(appDir, 0)
  }
  const hrefs = new Set<string>()
  for (const s of PACKAGE_STATES) {
    flowStations(s.pkg, base).forEach((x) => x.links.forEach((l) => hrefs.add(l.href)))
    flowSources(s.pkg, base).forEach((x) => x.link && hrefs.add(x.link.href))
  }
  it.each([...hrefs].sort())("%s", (href) => {
    expect(exists(href)).toBe(true)
  })
})
