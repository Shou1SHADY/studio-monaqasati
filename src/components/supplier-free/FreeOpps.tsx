"use client"

// Quote requests (PRD RFQ-01…14, WF-19): what contractors ask of this supplier in his field and cities, and the
// invitations that name him. At volume — segments with counts, specialty chips whose counts follow the other
// filters, deadline groups counted over the WHOLE list, 24 then more, select-and-archive, cards or rows.

import { useEffect, useMemo, useState } from "react"
import { Clock, Info, PenLine, Search, Send } from "lucide-react"
import { Link } from "@/i18n/routing"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Callout } from "@/components/module-ui/Callout"
import { useToast } from "@/hooks/use-toast"
import { displayCategory, displayCity } from "@/lib/constants"
import { cn } from "@/lib/utils"
import { PAGE_SIZE, type OppFilter } from "@/lib/supplier-free/world-logic"
import type { Deal } from "@/lib/supplier-free/types"
import { RequestCard, RequestRow } from "./RequestCard"
import { FreePage, GroupHead, ShowMore, ViewToggle, stk, useListSelection, useQueryState, useViewMode, type PageKpi } from "./ui"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { useFree } from "./useFree"

const GROUPS = [
  { k: "ogSoon", tone: "r" as const, f: (L: { daysTo: (s: string) => number }, d: Deal) => L.daysTo(d.deadline) <= 1 },
  { k: "ogWeek", tone: "a" as const, f: (L: { daysTo: (s: string) => number }, d: Deal) => L.daysTo(d.deadline) <= 7 },
  { k: "ogLater", tone: "m" as const, f: () => true },
]

export function FreeOpps() {
  const f = useFree()
  const { t, L, archive } = f
  const q = useQueryState()
  const { toast } = useToast()
  const [view, setView] = useViewMode("opps")
  const [n, setN] = useState(PAGE_SIZE)

  const tab = (["all", "new", "invite", "arch"] as const).find((x) => x === q.get("tab")) || "all"
  const filter: OppFilter = {
    tab,
    cat: q.get("cat"),
    city: q.get("city"),
    c: q.get("c"),
    due: (q.get("due") as OppFilter["due"]) || "",
    sort: q.get("sort") === "new" ? "new" : "",
    q: q.get("q"),
  }
  const key = JSON.stringify(filter)
  useEffect(() => setN(PAGE_SIZE), [key])
  const [sel, setSel] = useListSelection(key)

  const list = useMemo(() => L.opps(filter), [L, key])
  const all = useMemo(() => L.opps({}), [L])
  const pool = useMemo(() => L.opps({ ...filter, cat: "" }), [L, key])
  const page = list.slice(0, n)
  const filtered = !!(filter.cat || filter.city || filter.c || filter.due || filter.q)
  const inviteN = all.filter((d) => d.channel === "invite").length
  const newN = all.filter(L.isNewReq).length
  const soonN = all.filter((d) => L.daysTo(d.deadline) <= 3).length
  const archN = L.opps({ tab: "arch" }).length

  const cities = useMemo(() => [...new Set(all.map(L.cityOf))], [all, L])
  const cons = useMemo(() => [...new Set(all.map((d) => d.c))], [all])
  const catN = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of pool) m.set(d.cat, (m.get(d.cat) || 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [pool])

  const href = q.href
  const setParam = (patch: Record<string, string>) => q.set(patch)

  const groupOf = (d: Deal) => (filter.sort === "new" || tab === "arch" ? null : GROUPS.find((g) => g.f(L, d)) || null)
  const groupN = (g: (typeof GROUPS)[number]) => list.filter((d) => GROUPS.find((x) => x.f(L, d)) === g).length
  const blocks: { g: (typeof GROUPS)[number] | null; items: Deal[] }[] = []
  for (const d of page) {
    const g = groupOf(d)
    const last = blocks[blocks.length - 1]
    if (!last || last.g !== g) blocks.push({ g, items: [d] })
    else last.items.push(d)
  }

  const selIds = Object.keys(sel).filter((k) => sel[k])
  const allSel = page.length > 0 && page.every((d) => sel[d.id])
  const onSelect = (id: string, on: boolean) => setSel((s) => ({ ...s, [id]: on }))
  const doArchive = async (ids: string[], on: boolean) => {
    await archive(ids, on)
    setSel({})
    toast({ title: t(on ? "tArchN" : "tUnarch", { n: ids.length }) })
  }

  const first = all[0]
  const kpis: PageKpi[] = [
    {
      id: "open",
      icon: Search,
      label: t("okOpen"),
      value: all.length,
      sub: newN ? t("okNewSub", { n: newN }) : t("okFieldSub", { n: all.length - inviteN }),
      tone: newN ? "warn" : "neutral",
      href: href({ tab: "new", cat: "", city: "", c: "", due: "", q: "" }),
    },
    { id: "invite", icon: Send, label: t("otInvite"), value: inviteN, sub: t("okInvSub"), tone: inviteN ? "warn" : "neutral", href: href({ tab: "invite" }) },
    { id: "soon", icon: Clock, label: t("okSoon"), value: soonN, sub: first ? t("okSoonSub2", { x: f.rel(first.deadline) }) : "—", tone: "warn", href: href({ due: "3" }) },
  ]

  const select = "h-9 rounded-lg border bg-card px-2.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  const profile = f.profile

  return (
    <FreePage
      icon={Search}
      title={t("oppT")}
      description={t("oppSub")}
      action={
        <Link href="/supplier/profile?tab=specs" className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-bold hover:bg-muted/50">
          <PenLine size={15} aria-hidden="true" />
          {t("editSpecs")}
        </Link>
      }
      kpis={kpis}
    >
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedNav
          variant="track"
          ariaLabel={t("oppT")}
          active={tab}
          onSelect={(id) => setParam({ tab: id === "all" ? "" : id })}
          segments={[
            { id: "all", label: t("otAll"), count: all.length },
            { id: "new", label: t("otNew"), count: newN, tone: "warn" },
            { id: "invite", label: t("otInvite"), count: inviteN },
            { id: "arch", label: t("otArch"), count: archN },
          ]}
        />
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              const v = new FormData(e.currentTarget).get("q")
              setParam({ q: String(v || "") })
            }}
            className="relative"
          >
            <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input name="q" defaultValue={filter.q || ""} key={filter.q || ""} placeholder={t("oppSearchPh")} aria-label={t("oppSearchPh")} className="h-9 w-56 rounded-lg border bg-card ps-8 pe-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </form>
          <NativeSelect aria-label={t("fCity")} className={select} value={filter.city || ""} onChange={(e) => setParam({ city: e.target.value })}>
            <option value="">{t("allCities")}</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {displayCity(c, f.locale)}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label={t("thContractor")} className={select} value={filter.c || ""} onChange={(e) => setParam({ c: e.target.value })}>
            <option value="">{t("allContractors")}</option>
            {cons.map((c) => (
              <option key={c} value={c}>
                {L.C(c)?.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect aria-label={t("fDeadline")} className={select} value={filter.due || ""} onChange={(e) => setParam({ due: e.target.value })}>
            <option value="">{t("allDue")}</option>
            <option value="3">{t("due3")}</option>
            <option value="7">{t("due7")}</option>
          </NativeSelect>
          <NativeSelect aria-label={t("sortBy")} className={select} value={filter.sort || "due"} onChange={(e) => setParam({ sort: e.target.value === "new" ? "new" : "" })}>
            <option value="due">{t("sortDue")}</option>
            <option value="new">{t("sortNew")}</option>
          </NativeSelect>
          <ViewToggle view={view} onChange={setView} f={f} />
        </div>
      </div>

      {tab !== "arch" && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("fCat")}>
          <button type="button" aria-pressed={!filter.cat} onClick={() => setParam({ cat: "" })} className={chip(!filter.cat)}>
            {t("allCats")} <b className="tabular-nums">{pool.length}</b>
          </button>
          {catN.map(([c, k]) => (
            <button key={c} type="button" aria-pressed={filter.cat === c} onClick={() => setParam({ cat: filter.cat === c ? "" : c })} className={chip(filter.cat === c)}>
              {displayCategory(c, f.locale)} <b className="tabular-nums">{k}</b>
            </button>
          ))}
        </div>
      )}

      {!list.length ? (
        <EmptyState
          icon={Search}
          title={t(filtered ? "oppEmptyF" : tab === "arch" ? "oppEmptyArch" : tab === "new" ? "oppEmptyNew" : "oppEmpty")}
          description={filtered ? undefined : t("oppEmptyX")}
          action={
            filtered ? (
              <Link href={href({ cat: "", city: "", c: "", due: "", q: "" }) as never} className="inline-flex h-9 items-center rounded-lg border bg-card px-3 text-sm font-bold">
                {t("clearFilters")}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {t("showingN", { a: f.fmt.n(page.length), b: f.fmt.n(list.length) })} ·{" "}
            <button type="button" className="font-bold text-module underline-offset-2 hover:underline" onClick={() => setSel(allSel ? {} : Object.fromEntries(page.map((d) => [d.id, true])))}>
              {allSel ? t("selNone") : t("selPage")}
            </button>
          </p>
          {view === "rows" ? (
            <div className={stk.wrap}>
              <table className={stk.table}>
                <thead className={stk.thead}>
                  <tr>
                    <th className="w-9" />
                    <th className="px-3 py-2 text-start">{t("thRequest")}</th>
                    <th className="hidden px-3 text-start xl:table-cell">{t("fCat")}</th>
                    <th className="px-3 text-start">{t("thFirstItem")}</th>
                    <th className="hidden px-3 text-start md:table-cell">{t("fNeedBy")}</th>
                    <th className="px-3 text-start">{t("fDeadline")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody className={stk.tbody}>
                  {blocks.map((b, i) => (
                    <GroupRows key={i} f={f} b={b} n={b.g ? groupN(b.g) : 0} sel={sel} onSelect={onSelect} href={href} archive={(id, on) => void doArchive([id], on)} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            blocks.map((b, i) => (
              <div key={i}>
                {b.g && <GroupHead label={t(b.g.k)} n={groupN(b.g)} tone={b.g.tone} />}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {b.items.map((d) => (
                    <RequestCard key={d.id} f={f} d={d} href={href} selected={!!sel[d.id]} onSelect={onSelect} onArchive={(id, on) => void doArchive([id], on)} />
                  ))}
                </div>
              </div>
            ))
          )}
          <ShowMore f={f} shown={page.length} total={list.length} onMore={() => setN((x) => x + PAGE_SIZE)} />
        </>
      )}

      {selIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-2xl bg-primary px-4 py-2.5 text-primary-foreground shadow-2xl">
          <b className="text-sm tabular-nums">{t("selN", { n: f.fmt.n(selIds.length) })}</b>
          <button type="button" onClick={() => void doArchive(selIds, tab !== "arch")} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-bold hover:bg-white/25">
            {tab === "arch" ? t("unarchive") : t("archSel")}
          </button>
          <button type="button" onClick={() => setSel({})} className="text-xs font-bold text-sidebar-foreground/80 hover:text-white">
            {t("cancel")}
          </button>
        </div>
      )}

      {profile && (
        <Callout tone="info">
          <span className="inline-flex items-start gap-1.5">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t("oppListSub", { s: profile.specializations.map((c) => displayCategory(c, f.locale)).join(t("listSep")) || "—", c: profile.coverageCities.map((c) => displayCity(c, f.locale)).join(t("listSep")) || "—" })}
          </span>
        </Callout>
      )}
    </FreePage>
  )
}

function chip(on: boolean) {
  return cn("inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", on ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground")
}

function GroupRows({
  f,
  b,
  n,
  sel,
  onSelect,
  href,
  archive,
}: {
  f: ReturnType<typeof useFree>
  b: { g: (typeof GROUPS)[number] | null; items: Deal[] }
  n: number
  sel: Record<string, boolean>
  onSelect: (id: string, on: boolean) => void
  href: (p: Record<string, string | null>) => string
  archive: (id: string, on: boolean) => void
}) {
  return (
    <>
      {b.g && (
        <tr className={cn("bg-muted/30", stk.tr)}>
          <td colSpan={7} className={cn("px-3 py-1.5", stk.head)}>
            <GroupHead label={f.t(b.g.k)} n={n} tone={b.g.tone} />
          </td>
        </tr>
      )}
      {b.items.map((d) => (
        <RequestRow key={d.id} f={f} d={d} href={href} selected={!!sel[d.id]} onSelect={onSelect} onArchive={archive} />
      ))}
    </>
  )
}
