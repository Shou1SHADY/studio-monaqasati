/** @jest-environment node */
/**
 * Procurement 2.0 — NAMES CONFORMANCE (G-11, «حدّثوا الأسماء اللازمة»). The prototype's 1,820 Arabic/English label pairs
 * (`src/test-utils/fixtures/procurement-v2-pairs.json`, taken from Prototype-Procurement-v5.html) are matched against what our message files
 * say under the Procurement namespaces. Three things come out of it:
 *   1. the CORE names — the eight pages, the sidebar's entries, the segments of the requests, the RFQ page's tabs, the orders' filters —
 *      must be the prototype's in BOTH languages, and CI fails if one drifts;
 *   2. the words the package retired (the price seal, a «confirm receipt» in Procurement, developer event keys) must not come back;
 *   3. every other pair that has no equal string in our messages is reported in `docs/procurement-2.0-names-gap.md`, grouped by screen with
 *      the closest existing key — it does NOT fail CI. Regenerate it with `PROC20_WRITE_NAMES_GAP=1 npx jest procurement-v2-names`.
 */

import fs from "fs"
import path from "path"

type Tree = { [k: string]: string | Tree }
type Pair = [string, string[], string]
const load = (locale: "ar" | "en") => JSON.parse(fs.readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8")) as Tree
const PAIRS = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src/test-utils/fixtures/procurement-v2-pairs.json"), "utf8")) as Pair[]

function flat(node: Tree | string, prefix = "", out: Map<string, string> = new Map()): Map<string, string> {
  if (typeof node === "string") out.set(prefix, node)
  else for (const [k, v] of Object.entries(node)) flat(v, prefix ? `${prefix}.${k}` : k, out)
  return out
}

const SCOPES = [/^Portal\.Procurement\./, /^Portal\.Proc[A-Z]\w*\./, /^Portal\.Sidebar\./, /^Portal\.Shared\.(proc_tab_|rq_|nd_|pri_|tr_|bef_|rf_|pchg_|newrfq_|dor_|svc_|pn_|team_|pull_|paste_)/, /^Portal\.Admin(Packages|Pipeline|Modules)\./, /^PublicRfq\./, /^PoLink\./]
const inScope = (key: string) => SCOPES.some((re) => re.test(key))
const AR = flat(load("ar"))
const EN = flat(load("en"))
const KEYS = [...AR.keys()].filter((k) => inScope(k) && EN.has(k) && typeof AR.get(k) === "string")

function dropIcu(s: string): string {
  let out = ""
  let depth = 0
  for (const ch of s) {
    if (ch === "{") {
      if (depth === 0) out += "{}"
      depth++
    } else if (ch === "}") depth = Math.max(0, depth - 1)
    else if (depth === 0) out += ch
  }
  return out
}
const TRAIL = /[\s.,،:؛;!؟?…·—–\-]+$/
const normAr = (s: string) => dropIcu(s.normalize("NFKC").replace(/[ً-ٰٟـ]/g, "").replace(/[«»“”"‘’'`]/g, "")).replace(/\s+/g, " ").replace(TRAIL, "").trim()
const normEn = (s: string) => dropIcu(s.normalize("NFKC").replace(/[“”"‘’'`]/g, "")).toLowerCase().replace(/\s+/g, " ").replace(TRAIL, "").trim()

interface Entry {
  key: string
  ar: string
  en: string
}
const entries: Entry[] = KEYS.map((key) => ({ key, ar: AR.get(key) as string, en: EN.get(key) as string }))
const byAr = new Map<string, Entry[]>()
const byEn = new Map<string, Entry[]>()
for (const e of entries) {
  const a = normAr(e.ar)
  const n = normEn(e.en)
  byAr.set(a, [...(byAr.get(a) ?? []), e])
  byEn.set(n, [...(byEn.get(n) ?? []), e])
}

const ARABIC = /[؀-ۿ]/
const words = (s: string) => normAr(s).split(/[\s/·|()،]+/).map((w) => w.replace(/^ال/, "")).filter((w) => w.length > 1)
const dice = (a: string[], b: string[]) => {
  if (!a.length || !b.length) return 0
  const sb = new Set(b)
  const hit = a.filter((w) => sb.has(w)).length
  return (2 * hit) / (a.length + b.length)
}
const entryWords = entries.map((e) => words(e.ar))

type Status = "ok" | "en_differs" | "ar_differs" | "missing"
interface Verdict {
  ar: string
  en: string[]
  screen: string
  status: Status
  ours?: Entry
  closeness?: number
}
const preferred = (list: Entry[]) => list.find((e) => /^Portal\.(Procurement|Proc[A-Z])/.test(e.key)) ?? list[0]

function judge(pair: Pair): Verdict {
  const [ar, ens, screen] = pair
  const base = { ar, en: ens, screen }
  const a = normAr(ar)
  const eNorm = ens.map(normEn)
  const sameAr = byAr.get(a) ?? []
  const both = sameAr.filter((e) => eNorm.includes(normEn(e.en)))
  if (both.length) return { ...base, status: "ok", ours: preferred(both) }
  if (sameAr.length) return { ...base, status: "en_differs", ours: preferred(sameAr) }
  const sameEn = eNorm.flatMap((n) => byEn.get(n) ?? [])
  if (sameEn.length && a.length > 1) return { ...base, status: "ar_differs", ours: preferred(sameEn) }
  const w = words(ar)
  let best = -1
  let score = 0
  entryWords.forEach((ew, i) => {
    const d = dice(w, ew)
    if (d > score) {
      score = d
      best = i
    }
  })
  return { ...base, status: "missing", ...(best >= 0 && score >= 0.5 ? { ours: entries[best], closeness: Math.round(score * 100) / 100 } : {}) }
}

const CANDIDATES = PAIRS.filter(([ar]) => ARABIC.test(ar) && normAr(ar).length > 1)
const VERDICTS = CANDIDATES.map(judge)
const verdictOf = (ar: string) => VERDICTS.find((v) => v.ar === ar)

describe("the prototype's pairs", () => {
  it("are loaded whole: 1,820 pairs, every one with its Arabic, its English and the screen it belongs to", () => {
    expect(PAIRS.length).toBeGreaterThanOrEqual(1800)
    expect(PAIRS.every(([ar, en, screen]) => ar && en.length && screen)).toBe(true)
    expect(KEYS.length).toBeGreaterThan(2000)
  })
})

const CORE_NAMES: Array<[group: string, names: string[]]> = [
  ["the eight pages (the rail and the sidebar)", ["طلبات الشراء الواردة", "طلبات العروض", "أوامر الشراء", "سندات الاستلام", "الموردون", "التقارير", "الإعدادات"]],
  ["today and the sidebar's other entries", ["اليوم", "كيف تعمل المشتريات؟", "محادثاتي", "سوق المواد", "الشراء بالأجل", "الدليل"]],
  ["the segments of «الواردة»", ["قادمة", "جديدة", "مُجهَّزة", "في أوامر", "اكتملت", "انتهت", "الكل"]],
  ["the RFQ page's tabs", ["العروض", "المقارنة", "الاستفسارات", "التفاصيل"]],
  ["the offers' words", ["أقل عرض كامل", "القائمة القصيرة", "مستبعدة"]],
  ["the orders' filters", ["يحتاج تصرّفنا", "ننتظر غيرنا", "متأخرة", "مكتملة"]],
]

describe("the core names are the prototype's, in both languages (G-11)", () => {
  for (const [group, names] of CORE_NAMES) {
    describe(group, () => {
      it.each(names)("%s", (ar) => {
        const v = verdictOf(ar)
        expect(v).toBeDefined()
        expect({ ar, status: v?.status, ours: v?.ours ? { key: v.ours.key, ar: v.ours.ar, en: v.ours.en } : null, prototypeEn: v?.en }).toMatchObject({ status: "ok" })
      })
    })
  }
})

const PROCUREMENT_STRINGS = (locale: "ar" | "en") => KEYS.filter((k) => /^(Portal\.Procurement\.|Portal\.Proc[A-Z]\w*\.|PublicRfq\.|PoLink\.)/.test(k)).map((k) => [k, (locale === "ar" ? AR : EN).get(k) as string] as const)

describe("the words the package retired do not come back", () => {
  it("«تأكيد الاستلام» / «Confirm receipt» is not a Procurement name — only a line saying there is no such button may say it", () => {
    const ar = PROCUREMENT_STRINGS("ar").filter(([, v]) => /تأكيد الاستلام/.test(v) && !/^لا زر/.test(v))
    const en = PROCUREMENT_STRINGS("en").filter(([, v]) => /confirm(ing)? (the )?receipt/i.test(v) && !/^No “?Confirm receipt/i.test(v))
    expect([...ar, ...en].map(([k]) => k)).toEqual([])
  })

  it("English: no «sealed» / «unseal» price wording — prices are visible as offers arrive", () => {
    expect(PROCUREMENT_STRINGS("en").filter(([, v]) => /\b(?:un)?seal(?:ed|ing)?\b/i.test(v)).map(([k]) => k)).toEqual([])
  })

  it("Arabic: no price-seal wording («مغلقة حتى»…) — a «PDF مختوم» official quote is a stamp, not a seal, and is fine", () => {
    expect(PROCUREMENT_STRINGS("ar").filter(([, v]) => /(?:الأسعار|الاسعار|العروض|السعر) (?:مغلقة|مغلق|مختومة|مختوم|سرّية|سري) حتى|مغلقة حتى هذا التاريخ|وافتح الأسعار|فُتحت الأسعار|فتح الأسعار|تُفتح الأسعار/.test(v)).map(([k]) => k)).toEqual([])
  })

  it("no developer event key (proc:ISS, inv:CHK, fin:PAID…) in a string a contractor reads", () => {
    const KEY = /\b(?:proc|prj|inv|fin|mfg|sup|hr|adv):[A-Z]{2,}/
    expect([...PROCUREMENT_STRINGS("ar"), ...PROCUREMENT_STRINGS("en")].filter(([, v]) => KEY.test(v)).map(([k]) => k)).toEqual([])
  })
})

const SCREEN_ORDER = (a: string, b: string) => (a.startsWith("Vocabulary") === b.startsWith("Vocabulary") ? a.localeCompare(b) : a.startsWith("Vocabulary") ? 1 : -1)
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ")
const cell = (e?: Entry) => (e ? `\`${e.key}\`<br>${esc(e.ar)} / ${esc(e.en)}` : "—")

function report(): string {
  const count = (s: Status) => VERDICTS.filter((v) => v.status === s).length
  const gaps = VERDICTS.filter((v) => v.status !== "ok")
  const group = (s: string) => (s.startsWith("Vocabulary") ? "Vocabulary tables (prototype constants)" : s)
  const tableOf = (s: string) => (s.startsWith("Vocabulary · ") ? s.slice("Vocabulary · ".length) : "")
  const screens = [...new Set(VERDICTS.map((v) => group(v.screen)))].sort(SCREEN_ORDER)
  const out: string[] = []
  out.push("# Procurement 2.0 — names gap (prototype → our messages)")
  out.push("")
  out.push("Generated by `src/__tests__/procurement-v2-names.test.ts` (`PROC20_WRITE_NAMES_GAP=1 npx jest procurement-v2-names`). Source of the pairs: `Prototype-Procurement-v5.html` (1,820 Arabic/English label pairs, `src/test-utils/fixtures/procurement-v2-pairs.json`). Searched in: `Portal.Procurement*`, `Portal.Proc*`, `Portal.Sidebar`, `Portal.Shared.{proc_tab_,rq_,nd_,pri_,tr_,bef_,rf_,pchg_,newrfq_,dor_,svc_,pn_,team_,pull_,paste_}*`, `Portal.Admin{Packages,Pipeline,Modules}`, `PublicRfq`, `PoLink`. Comparison ignores diacritics, quotation marks, trailing punctuation and ICU parameters; a prototype label with several English spellings is satisfied by any of them.")
  out.push("")
  out.push("CI fails only on the core names (the eight pages, the sidebar, the segments, the RFQ page's tabs, the orders' filters) and on the retired words. Everything below is the work list for the rest.")
  out.push("")
  out.push("## How to read it")
  out.push("")
  out.push("- **English differs**: our Arabic is the prototype's, our English is not — change the English value of the key shown.")
  out.push("- **Arabic differs**: our English is the prototype's, our Arabic is not — change the Arabic value of the key shown.")
  out.push("- **Missing**: neither language has an equal string. «Closest» is the nearest key by shared Arabic words (with its score); no key is shown when nothing is near. Many of these are sentences of the prototype's demo data or the guide; a short label here is a name nobody has put in a message file yet.")
  out.push("- A screen is the prototype's function the label was written in; labels that sit in the prototype's shared tables are grouped under `Vocabulary · <table>`.")
  out.push("")
  out.push("## Summary")
  out.push("")
  out.push(`Pairs checked: **${VERDICTS.length}** · equal in both languages: **${count("ok")}** · English differs: **${count("en_differs")}** · Arabic differs: **${count("ar_differs")}** · missing: **${count("missing")}**`)
  out.push("")
  out.push("| Screen | Pairs | Equal | English differs | Arabic differs | Missing |")
  out.push("|---|---:|---:|---:|---:|---:|")
  for (const s of screens) {
    const mine = VERDICTS.filter((v) => group(v.screen) === s)
    const n = (st: Status) => mine.filter((v) => v.status === st).length
    out.push(`| ${esc(s)} | ${mine.length} | ${n("ok")} | ${n("en_differs")} | ${n("ar_differs")} | ${n("missing")} |`)
  }
  out.push("")
  const isLabel = (v: Verdict) => normAr(v.ar).split(" ").length <= 5
  for (const s of screens) {
    const mine = gaps.filter((v) => group(v.screen) === s)
    if (!mine.length) continue
    out.push(`## ${esc(s)}`)
    out.push("")
    const section = (title: string, rows: Verdict[], head: string) => {
      if (!rows.length) return
      out.push(`### ${title} (${rows.length})`)
      out.push("")
      out.push(head)
      out.push(head.replace(/[^|]/g, "-").replace(/\|-/g, "|---").replace(/-\|/g, "---|"))
      for (const v of rows) out.push(`| ${vocab ? `${tableOf(v.screen)} | ` : ""}${esc(v.ar)} | ${esc(v.en.join(" / "))} | ${cell(v.ours)}${v.closeness ? ` (${v.closeness})` : ""} |`)
      out.push("")
    }
    const vocab = s.startsWith("Vocabulary")
    const head = vocab ? "| Table | Prototype (ar) | Prototype (en) | Ours (closest key, ar / en) |" : "| Prototype (ar) | Prototype (en) | Ours (closest key, ar / en) |"
    section("English differs", mine.filter((v) => v.status === "en_differs"), head)
    section("Arabic differs", mine.filter((v) => v.status === "ar_differs"), head)
    section("Missing — labels", mine.filter((v) => v.status === "missing" && isLabel(v)), head)
    section("Missing — sentences", mine.filter((v) => v.status === "missing" && !isLabel(v)), head)
  }
  return out.join("\n") + "\n"
}

describe("the names-gap report", () => {
  it("is regenerated on demand and every pair has a verdict", () => {
    expect(VERDICTS.length).toBe(CANDIDATES.length)
    expect(VERDICTS.every((v) => ["ok", "en_differs", "ar_differs", "missing"].includes(v.status))).toBe(true)
    const text = report()
    expect(text).toContain("Summary")
    if (process.env.PROC20_WRITE_NAMES_GAP === "1") fs.writeFileSync(path.join(process.cwd(), "docs", "procurement-2.0-names-gap.md"), text, "utf8")
  })
})
