"use client"

// My quotes (PRD OFR-07…14, WF-20): every quote ends in a result — won with its order, awarded to another, closed
// with no award, withdrawn, or the order declined. Groups in working order (need reply, nearest first · awaiting the
// decision · won · closed without an order), each with its count and value from the WHOLE list; "new" on results until opened.

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Award, Clock, FileText, Search, Send } from "lucide-react"
import { Link } from "@/i18n/routing"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { displayCategory } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { r2, type OfferSeg } from "@/lib/supplier-free/deal-logic"
import { PAGE_SIZE, type OfferFilter } from "@/lib/supplier-free/world-logic"
import type { Deal } from "@/lib/supplier-free/types"
import { FreePage, GroupHead, Pill, ShowMore, ViewToggle, VerifiedMark, docWord, useQueryState, useViewMode, type PageKpi } from "./ui"
import { OfferPill } from "./Pills"
import { useActions } from "./ActionsProvider"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { useFree, type Free } from "./useFree"

const GROUPS: { k: string; seg: OfferSeg; tone: "a" | "b" | "g" | "m"; sum: boolean }[] = [
  { k: "osReply", seg: "reply", tone: "a", sum: true },
  { k: "osWait", seg: "wait", tone: "b", sum: true },
  { k: "osWon", seg: "won", tone: "g", sum: true },
  { k: "osLost", seg: "lost", tone: "m", sum: false },
]

function hint(f: Free, d: Deal): { txt: string; tone?: "bad" | "warn" | "mute" } {
  const { t, fmt, L, rel } = f
  const o = d.offer
  const s = L.offerSt(d)
  const urg = (x: string) => {
    const n = L.daysTo(x)
    return n <= 1 ? ("bad" as const) : n <= 3 ? ("warn" as const) : ("mute" as const)
  }
  if (!o) return { txt: "" }
  if (s === "reduce" && o.reduce) return { txt: t("ocReplyBy", { x: fmt.date(o.reduce.by) }), tone: urg(o.reduce.by) }
  if (s === "sample" && o.sample) return { txt: t("ocSampleBy", { x: fmt.date(o.sample.by) }), tone: urg(o.sample.by) }
  if (s === "sampleSent" && o.sample) return { txt: t("ocSampleOn", { x: fmt.date(o.sample.sentAt) }) }
  if (s === "review") return { txt: L.daysTo(d.deadline) >= 0 ? t("ocOpenTill", { x: fmt.date(d.deadline) }) : t("ocClosedAgo", { r: rel(d.deadline) }) }
  return { txt: fmt.date(L.offAt(d)) }
}

function why(f: Free, d: Deal): string {
  const w = d.offer?.out?.why
  const s = f.L.offerSt(d)
  return w && (s === "lost" || s === "noaward") ? f.t("ocWhy", { w: f.t(`why_${w}` as "why_price") }) : ""
}

function StepButton({ f, d, href }: { f: Free; d: Deal; href: (p: Record<string, string | null>) => string }) {
  const act = useActions()
  const s = f.L.offerSt(d)
  const cls = "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  if (s === "reduce")
    return (
      <Link href={href({ deal: d.id }) as never} scroll={false} className={cn(cls, "bg-cta text-cta-foreground hover:bg-cta/90")}>
        {f.t("btnReply")}
      </Link>
    )
  if (s === "sample")
    return (
      <button type="button" onClick={() => act.open("sample-sent", d.id)} className={cn(cls, "bg-cta text-cta-foreground hover:bg-cta/90")}>
        {f.t("btnSampleShort")}
      </button>
    )
  if (s === "won" && d.po)
    return (
      <Link href={`/supplier/orders?q=${encodeURIComponent(d.po.no)}` as never} className={cn(cls, "border bg-card hover:bg-muted/50")}>
        <FileText size={13} aria-hidden="true" />
        {docWord(f, "po", d.po.no)}
      </Link>
    )
  return null
}

function OfferCard({ f, d, href }: { f: Free; d: Deal; href: (p: Record<string, string | null>) => string }) {
  const { t, fmt, L } = f
  const c = L.C(d.c)
  const o = d.offer
  const g = L.offerSeg(d)
  const h = hint(f, d)
  const v = L.curV(d)
  if (!o) return null
  const ver = o.v.length > 1 ? ` · ${t("ocVer", { n: o.v.length })}` : ""
  const foot = L.offerSt(d) === "sample" && o.sample ? t("ocSampleWhat", { w: o.sample.what }) : (g === "reply" || g === "wait") && v ? t("ocValidTill", { x: fmt.date(v.valid) }) : why(f, d)
  const edge = g === "reply" ? "border-s-4 border-s-warning" : g === "won" ? "border-s-4 border-s-success" : g === "lost" ? "border-s-4 border-s-muted-foreground/40" : ""
  return (
    <article className={cn("flex flex-col gap-2 rounded-xl border bg-card p-3.5 transition-shadow hover:shadow-md", edge)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <OfferPill f={f} d={d} />
        {L.isNewResult(d) && <span className="rounded-full bg-cta px-2 py-0.5 text-[10px] font-black text-white">{t("newTag")}</span>}
        <span className="flex-1" />
        {h.tone ? <Pill tone={h.tone} dot>{h.txt}</Pill> : <span className="text-[11px] text-muted-foreground">{h.txt}</span>}
      </div>
      <Link href={href({ deal: d.id }) as never} scroll={false} className="line-clamp-2 text-start text-sm font-bold leading-snug hover:text-module" dir="auto">
        {d.title}
      </Link>
      <p className="text-xs text-muted-foreground">
        <bdi>{c?.name}</bdi> <VerifiedMark f={f} verified={!!c?.verified} /> · {docWord(f, "rfq", d.rfq)}
      </p>
      <p className="text-sm">
        <b className="tabular-nums" dir="ltr">{fmt.money(L.offerTotal(d))}</b>{" "}
        {L.offerSt(d) === "reduce" && o.reduce ? <span className="rounded bg-warning/10 px-1.5 py-0.5 text-xs font-bold text-warning">{t("ocAsk", { v: fmt.money(o.reduce.target) })}</span> : <span className="text-xs text-muted-foreground">{t("beforeVat")}{ver}</span>}
      </p>
      <div className="mt-auto flex items-center gap-2 pt-1">
        <span className="me-auto text-[11px] text-muted-foreground">{foot}</span>
        <StepButton f={f} d={d} href={href} />
      </div>
    </article>
  )
}

function OfferRow({ f, d, href }: { f: Free; d: Deal; href: (p: Record<string, string | null>) => string }) {
  const { t, fmt, L } = f
  const c = L.C(d.c)
  const o = d.offer
  const g = L.offerSeg(d)
  const h = hint(f, d)
  const v = L.curV(d)
  if (!o || !v) return null
  const ver = o.v.length > 1 ? t("ocVer", { n: o.v.length }) : ""
  return (
    <tr className="border-b last:border-b-0 hover:bg-muted/30">
      <td className="max-w-[300px] px-3 py-2.5">
        <Link href={href({ deal: d.id }) as never} scroll={false} className="block truncate text-sm font-bold hover:text-module" dir="auto">
          {d.title}
        </Link>
        {L.isNewResult(d) && <span className="me-1 rounded-full bg-cta px-1.5 text-[10px] font-black text-white">{t("newTag")}</span>}
        <span className="text-xs text-muted-foreground">
          <bdi>{c?.name}</bdi> <VerifiedMark f={f} verified={!!c?.verified} /> · {docWord(f, "rfq", d.rfq)}
        </span>
      </td>
      <td className="px-3 text-sm">
        <b className="tabular-nums" dir="ltr">{fmt.money(L.offerTotal(d))}</b>
        <span className="block text-xs text-muted-foreground">{L.offerSt(d) === "reduce" && o.reduce ? t("ocAsk", { v: fmt.money(o.reduce.target) }) : t("beforeVat")}</span>
      </td>
      <td className="hidden whitespace-nowrap px-3 text-xs xl:table-cell">
        {fmt.date(v.at)}
        <span className="block text-muted-foreground">{[g === "reply" || g === "wait" ? t("ocValidTill", { x: fmt.date(v.valid) }) : "", ver].filter(Boolean).join(" · ")}</span>
      </td>
      <td className="px-3">
        <OfferPill f={f} d={d} />
        <span className={cn("mt-0.5 block text-xs", h.tone === "bad" ? "text-destructive" : h.tone === "warn" ? "text-warning" : "text-muted-foreground")}>{[h.txt, why(f, d)].filter(Boolean).join(" · ")}</span>
      </td>
      <td className="whitespace-nowrap px-3 text-end">
        <StepButton f={f} d={d} href={href} />
      </td>
    </tr>
  )
}

export function FreeOffers() {
  const f = useFree()
  const { t, L } = f
  const q = useQueryState()
  const [view, setView] = useViewMode("offers")
  const [n, setN] = useState(PAGE_SIZE)
  const seg = (["all", "reply", "wait", "won", "lost"] as const).find((x) => x === q.get("seg")) || "all"
  const filter: OfferFilter = { seg, c: q.get("c"), cat: q.get("cat"), sort: q.get("sort") === "value" ? "value" : "", q: q.get("q") }
  const key = JSON.stringify(filter)
  useEffect(() => setN(PAGE_SIZE), [key])
  const list = useMemo(() => L.myOffers(filter), [L, key])
  const pool = useMemo(() => L.myOffers({ ...filter, cat: "" }), [L, key])
  const base = useMemo(() => L.myOffers({}), [L])
  const page = list.slice(0, n)
  const filtered = !!(filter.c || filter.cat || filter.q)
  const cnt = (k: string) => base.filter((d) => k === "all" || L.offerSeg(d) === k).length
  const reply = base.filter((d) => L.offerSeg(d) === "reply")
  const wait = base.filter((d) => L.offerSeg(d) === "wait")
  const cons = [...new Set(base.map((d) => d.c))].sort((a, b) => (L.C(a)?.name || "").localeCompare(L.C(b)?.name || "", f.locale))
  const catN = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of pool) m.set(d.cat, (m.get(d.cat) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [pool])
  const href = q.href
  const due = reply.map((d) => L.offDue(d) as string).sort()[0]

  const groupOf = (d: Deal) => (seg === "all" ? GROUPS.find((g) => g.seg === L.offerSeg(d)) || null : null)
  const blocks: { g: (typeof GROUPS)[number] | null; items: Deal[] }[] = []
  for (const d of page) {
    const g = groupOf(d)
    const last = blocks[blocks.length - 1]
    if (!last || last.g !== g) blocks.push({ g, items: [d] })
    else last.items.push(d)
  }
  const gHead = (g: (typeof GROUPS)[number]) => {
    const inG = list.filter((d) => L.offerSeg(d) === g.seg)
    return <GroupHead label={t(g.k as "osAll")} n={inG.length} value={g.sum ? f.fmt.money(Math.round(inG.reduce((s, d) => s + L.offerTotal(d), 0))) : undefined} tone={g.tone === "a" ? "a" : g.tone === "g" ? "g" : "m"} />
  }

  const kpis: PageKpi[] = [
    { id: "reply", icon: Send, label: t("ofkReply2"), value: reply.length, sub: due ? t("ofkReplyNext", { x: f.rel(due) }) : t("ofkReplySub2"), tone: reply.length ? "warn" : "up", href: href({ seg: "reply" }) },
    { id: "wait", icon: Clock, label: t("ofkWait2"), value: f.fmt.kM(r2(wait.reduce((s, d) => s + L.offerTotal(d), 0))), unit: f.fmt.cur, sub: f.pl("pl_offer", wait.length), tone: "neutral", href: href({ seg: "wait" }) },
    { id: "won", icon: Award, label: t("osWon"), value: cnt("won"), sub: t("ofkWonSub"), tone: "up", href: href({ seg: "won" }) },
  ]
  const select = "h-9 rounded-lg border bg-card px-2.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  const chip = (on: boolean) => cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold", on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")
  return (
    <FreePage
      icon={Send}
      title={t("navOffers")}
      description={t("offSub")}
      action={
        <Link href="/supplier/rfqs" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-cta px-3 text-sm font-bold text-cta-foreground hover:bg-cta/90">
          <Search size={15} aria-hidden="true" />
          {t("heroCta")}
        </Link>
      }
      kpis={kpis}
    >
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedNav
          ariaLabel={t("navOffers")}
          active={seg}
          onSelect={(id) => q.set({ seg: id === "all" ? "" : id })}
          segments={[
            { id: "all", label: t("osAll"), count: cnt("all") },
            { id: "reply", label: t("osReply"), count: cnt("reply"), tone: "warn" },
            { id: "wait", label: t("osWait"), count: cnt("wait") },
            { id: "won", label: t("osWon"), count: cnt("won") },
            { id: "lost", label: t("osLost"), count: cnt("lost") },
          ]}
        />
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              q.set({ q: String(new FormData(e.currentTarget).get("q") || "") })
            }}
          >
            <input name="q" defaultValue={filter.q || ""} key={filter.q || ""} placeholder={t("offSearchPh")} aria-label={t("offSearchPh")} className="h-9 w-56 rounded-lg border bg-card px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </form>
          <NativeSelect aria-label={t("thContractor")} className={select} value={filter.c || ""} onChange={(e) => q.set({ c: e.target.value })}>
            <option value="">{t("allContractors")}</option>
            {cons.map((c) => (
              <option key={c} value={c}>
                {L.C(c)?.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label={t("sortBy")} className={select} value={filter.sort || "recent"} onChange={(e) => q.set({ sort: e.target.value === "value" ? "value" : "" })}>
            <option value="recent">{t("sortRecent")}</option>
            <option value="value">{t("sortValue")}</option>
          </NativeSelect>
          <ViewToggle view={view} onChange={setView} f={f} />
        </div>
      </div>
      {catN.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("fCat")}>
          <button type="button" aria-pressed={!filter.cat} onClick={() => q.set({ cat: "" })} className={chip(!filter.cat)}>
            {t("allCats")} <b className="tabular-nums">{pool.length}</b>
          </button>
          {catN.map(([c, k]) => (
            <button key={c} type="button" aria-pressed={filter.cat === c} onClick={() => q.set({ cat: filter.cat === c ? "" : c })} className={chip(filter.cat === c)}>
              {displayCategory(c, f.locale)} <b className="tabular-nums">{k}</b>
            </button>
          ))}
        </div>
      )}
      {!list.length ? (
        <EmptyState
          icon={Send}
          title={t(filtered ? "listEmptyF" : (`offEmpty_${seg}` as "offEmpty_all"))}
          action={
            filtered ? (
              <Link href={href({ c: "", cat: "", q: "" }) as never} className="inline-flex h-9 items-center rounded-lg border bg-card px-3 text-sm font-bold">
                {t("clearFilters")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {list.length > PAGE_SIZE && <p className="text-xs text-muted-foreground">{t("showingN", { a: f.fmt.n(page.length), b: f.fmt.n(list.length) })}</p>}
          {view === "rows" ? (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <table className="w-full text-start">
                <thead className="border-b bg-muted/40 text-[11px] font-bold text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{t("thRequest")}</th>
                    <th className="px-3 text-start">{t("thOfferVal")}</th>
                    <th className="hidden px-3 text-start xl:table-cell">{t("thSent")}</th>
                    <th className="px-3 text-start">{t("thState")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {blocks.map((b, i) => (
                    <FragmentRows key={i} head={b.g ? gHead(b.g) : null}>
                      {b.items.map((d) => (
                        <OfferRow key={d.id} f={f} d={d} href={href} />
                      ))}
                    </FragmentRows>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            blocks.map((b, i) => (
              <div key={i}>
                {b.g && gHead(b.g)}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {b.items.map((d) => (
                    <OfferCard key={d.id} f={f} d={d} href={href} />
                  ))}
                </div>
              </div>
            ))
          )}
          <ShowMore f={f} shown={page.length} total={list.length} onMore={() => setN((x) => x + PAGE_SIZE)} />
        </>
      )}
    </FreePage>
  )
}

function FragmentRows({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <>
      {head && (
        <tr className="bg-muted/30">
          <td colSpan={5} className="px-3 py-1.5">
            {head}
          </td>
        </tr>
      )}
      {children}
    </>
  )
}
