"use client"

// «بالمادة — قارن واجمع» (Procurement 2.0, INC-05, WF-07): the incoming requests read by material. Under each material its path and
// specifications; in how many requests, each with its place, quantity and need-by date; the total; the nearest last day to order;
// the last price paid for THAT specification (or «لا شراء سابق بهذه المواصفة»). Pick the materials worth combining and open them in
// one draft RFQ — each quantity stays with its request and its place.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Layers } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { fmtDay } from "@/components/procurement/need-bits"
import { byMaterial, combinable, combineHref } from "@/lib/procurement/by-material"
import { displayNeedRef, displayPoNumber } from "@/lib/procurement/format"
import type { NeedRow } from "@/lib/procurement/need-desk"
import type { PriceHistoryEntry } from "@/lib/procurement/prices"
import { sarLtr } from "@/lib/riyal"

const qty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-US")

export function ByMaterialView({ rows, history, canCombine }: { rows: NeedRow[]; history: PriceHistoryEntry[]; canCombine: boolean }) {
  const t = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const ar = locale === "ar"
  const groups = useMemo(() => byMaterial(rows, history), [rows, history])
  const multi = combinable(groups)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const toggle = (k: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  const chosen = groups.filter((g) => picked.has(g.key))

  return (
    <div className="space-y-3">
      {multi.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl bg-info/10 px-3 py-2 text-xs">
          <Layers size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t("bymat_hint", { count: multi.length })}</span>
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-start text-xs text-muted-foreground">
              <th className="w-8 p-3" />
              <th className="p-3 text-start font-semibold">{t("bymat_material")}</th>
              <th className="p-3 text-start font-semibold">{t("bymat_in_requests")}</th>
              <th className="p-3 text-start font-semibold">{t("bymat_total")}</th>
              <th className="p-3 text-start font-semibold">{t("bymat_nearest")}</th>
              <th className="p-3 text-start font-semibold">{t("bymat_last_price")}</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                  {t("bymat_empty")}
                </td>
              </tr>
            ) : (
              groups.map((g) => (
                <tr key={g.key} className={g.requests > 1 ? "border-b bg-module/5 align-top" : "border-b align-top"}>
                  <td className="p-3">
                    {canCombine && <Checkbox checked={picked.has(g.key)} onCheckedChange={() => toggle(g.key)} aria-label={t("bymat_select", { name: g.name })} />}
                  </td>
                  <td className="p-3">
                    <b dir="auto">{g.name}</b>
                    {g.path.ar && (
                      <p className="text-xs text-muted-foreground" dir="auto">
                        {ar ? g.path.ar : g.path.en}
                      </p>
                    )}
                    {g.specs.length > 0 && (
                      <p className="mt-1 flex flex-wrap gap-1">
                        {g.specs.map((s) => (
                          <span key={s.name.ar} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px]" dir="auto">
                            {ar ? s.value.ar : s.value.en}
                          </span>
                        ))}
                      </p>
                    )}
                  </td>
                  <td className="p-3">
                    <ul className="space-y-1">
                      {g.items.map((i) => (
                        <li key={i.rowKey} className="text-xs" dir="auto">
                          <b>{displayNeedRef(i.requestNo, locale)}</b> {i.place} · <b className="tabular-nums" dir="ltr">{qty(i.qty)}</b> {g.unit}
                          {i.needBy && <span className="text-muted-foreground"> · {t("bymat_by", { date: fmtDay(i.needBy, locale) })}</span>}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="p-3">
                    <b className="tabular-nums" dir="ltr">{qty(g.total)}</b> <span className="text-xs text-muted-foreground">{g.unit}</span>
                    {g.requests > 1 && (
                      <p>
                        <StatusPill tone="info">{t("bymat_from", { count: g.requests })}</StatusPill>
                      </p>
                    )}
                  </td>
                  <td className="p-3 text-xs">
                    {g.lastOrderDay ? (
                      <StatusPill tone={g.lastOrderIn != null && g.lastOrderIn <= 2 ? "bad" : g.lastOrderIn != null && g.lastOrderIn <= 7 ? "warn" : "mute"}>
                        {fmtDay(g.lastOrderDay, locale)}
                      </StatusPill>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3 text-xs">
                    {g.last ? (
                      <>
                        <b className="tabular-nums" dir="ltr">{sarLtr(g.last.price.toLocaleString("en-US"))}</b>
                        <p className="text-muted-foreground" dir="ltr">
                          {displayPoNumber(g.last.poNumber || "", locale)} · {fmtDay(g.last.day, locale)}
                        </p>
                      </>
                    ) : (
                      <span className="text-muted-foreground">{t("bymat_no_last")}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {canCombine && chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card px-4 py-3" role="region" aria-label={t("bymat_selection")}>
          <b className="text-sm">{t("bymat_selected", { count: chosen.length })}</b>
          <span className="ms-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setPicked(new Set())}>
              {t("bymat_clear")}
            </Button>
            <Button asChild size="sm" className="gap-1.5">
              <Link href={combineHref(groups, picked)}>
                <Layers size={13} aria-hidden="true" /> {t("bymat_combine")}
              </Link>
            </Button>
          </span>
        </div>
      )}
    </div>
  )
}
