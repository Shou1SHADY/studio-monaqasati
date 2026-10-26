"use client"

// The two small questions the review asks (IMP 1.3): «اختر المادة من القائمة» — the list searched with the
// same words the matcher reads — and, for a material that is not in the list, «من أي فئة هذه المادة؟»
// because the category is what routes the RFQ to the right suppliers.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ChevronLeft, ChevronRight, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { foldSearchText } from "@/lib/search-text"
import { label, pathLabel, pathOf, shortSpecName, type MaterialIndex } from "@/lib/materials/tree"
import type { Matcher, MatchCandidate } from "@/lib/boq-import/materials-match"
import type { MaterialChoice } from "@/lib/boq-import/materials-review"

type Inside = Extract<MaterialChoice, { outside: false }>

function candidateOf(c: MatchCandidate): Inside {
  return { outside: false, nodeId: c.nodeId, specs: c.specs, brand: c.brand }
}

export function PickMaterial({ matcher, query, onQuery, onChoose, onOutside, onBack }: { matcher: Matcher; query: string; onQuery: (q: string) => void; onChoose: (c: Inside) => void; onOutside: () => void; onBack: () => void }) {
  const t = useTranslations("Portal.Procurement.import")
  const locale = useLocale()
  const index = matcher.index
  const results = useMemo(() => (query.trim() ? matcher.search(query) : []), [matcher, query])
  const closest = useMemo(() => (query.trim() && !results.length ? matcher.loose(query) : []), [matcher, query, results.length])

  const caption = (c: Inside) => {
    const node = index.byId.get(c.nodeId)
    if (!node) return ""
    const specs = c.specs.map((s) => `${label(shortSpecName(node.specs[s.spec]), locale)} ${label(node.specs[s.spec].options[s.option], locale)}`)
    const brand = c.brand != null && node.brands[c.brand] ? [label(node.brands[c.brand], locale)] : []
    return [pathLabel(pathOf(index, node.id).map((p) => ({ ar: p.ar, en: p.en })), locale), ...specs, ...brand].filter(Boolean).join(" · ")
  }
  const row = (c: Inside) => (
    <li key={`${c.nodeId}-${c.specs.map((s) => `${s.spec}.${s.option}`).join(",")}`}>
      <button type="button" onClick={() => onChoose(c)} className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0">
          <b className="block text-sm" dir="auto">
            {label(index.byId.get(c.nodeId) ?? null, locale)}
          </b>
          <span className="block truncate text-xs text-muted-foreground" dir="auto">
            {caption(c)}
          </span>
        </span>
        <ChevronLeft size={16} className="shrink-0 text-muted-foreground ltr:rotate-180" aria-hidden="true" />
      </button>
    </li>
  )

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t("pick_input")} aria-label={t("pick_input")} className="ps-9" dir="auto" autoFocus />
      </div>
      <ul className="space-y-1.5">
        {results.map((c) => row(candidateOf(c)))}
        {!results.length && closest.length > 0 && (
          <>
            <li className="px-1 text-xs text-muted-foreground">{t("pick_closest")}</li>
            {closest.map((id) => row({ outside: false, nodeId: id, specs: [], brand: null }))}
          </>
        )}
        {!results.length && !closest.length && <li className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{t("pick_none")}</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{t("pick_free_q")}</span>
        <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={onOutside}>
          {t("pick_free")}
        </Button>
        <Button type="button" variant="outline" size="sm" className="ms-auto gap-1" onClick={onBack}>
          <ChevronRight size={14} className="ltr:rotate-180" aria-hidden="true" /> {t("back")}
        </Button>
      </div>
    </div>
  )
}

export function PickCategory({ index, onChoose, onBack }: { index: MaterialIndex; onChoose: (sub: string) => void; onBack: () => void }) {
  const t = useTranslations("Portal.Procurement.import")
  const locale = useLocale()
  const [q, setQ] = useState("")
  const list = useMemo(() => {
    const words = foldSearchText(q).split(" ").filter(Boolean)
    const named = (id: string) => foldSearchText(pathOf(index, id).map((p) => `${p.ar} ${p.en}`).join(" "))
    return index.subs.filter((s) => words.every((w) => named(s.id).includes(w))).slice(0, 40)
  }, [index, q])
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("sub_input")} aria-label={t("sub_input")} className="ps-9" dir="auto" autoFocus />
      </div>
      <ul className="space-y-1.5">
        {list.map((s) => (
          <li key={s.id}>
            <button type="button" onClick={() => onChoose(s.id)} className="flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="min-w-0">
                <b className="block text-sm" dir="auto">
                  {label(s, locale)}
                </b>
                <span className="block truncate text-xs text-muted-foreground" dir="auto">
                  {pathLabel(pathOf(index, s.id).map((p) => ({ ar: p.ar, en: p.en })), locale)}
                </span>
              </span>
              <ChevronLeft size={16} className="shrink-0 text-muted-foreground ltr:rotate-180" aria-hidden="true" />
            </button>
          </li>
        ))}
        {!list.length && <li className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">{t("sub_none")}</li>}
      </ul>
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" className="gap-1" onClick={onBack}>
          <ChevronRight size={14} className="ltr:rotate-180" aria-hidden="true" /> {t("back")}
        </Button>
      </div>
    </div>
  )
}
