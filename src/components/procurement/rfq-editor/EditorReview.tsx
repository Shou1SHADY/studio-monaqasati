"use client"

// Step 3 — «المراجعة» (PUR-01 p.4, PUR-03 p.2): what will happen, exactly, before it
// does — one RFQ with every material, who it reaches by sub-category, the deadline, the
// pricing, the terms, the delivery — and the warnings that do not stop it (a material
// with no spec, one outside the list, a unit kept that is not the tree's). «انشر» is
// pressed only here, on both roads (the editor and the incoming request's panel).

import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Info } from "lucide-react"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { sarLtr } from "@/lib/riyal"
import type { Audience, Pricing } from "./EditorPublish"

export interface ReviewModel {
  lines: number
  subs: number
  groups: number
  audience: Audience
  /** Public: how many suppliers, and the favourite among them. */
  reach: number
  favourite: string | null
  perSub: Array<{ name: string; count: number }>
  privateCount: number
  directName: string | null
  deadline: string | null
  daysToDeadline: number | null
  pricing: Pricing
  /** The visitor link will be made (ED-08). */
  link: boolean
  terms: string
  delivery: string
  files: string[]
  /** The internal budget, as typed: the supplier never sees it. */
  budget: string | null
  noSpec: string[]
  outside: string[]
  unitDiffers: string[]
}

export function EditorReview({ model, fmtDay }: { model: ReviewModel; fmtDay: (d: string) => string }) {
  const t = useTranslations("Portal.ProcEditor")
  const locale = useLocale()
  const m = model
  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-module/10 px-4 py-3 text-sm font-semibold text-foreground">
        {m.pricing === "line" ? t("rev_lead_line", { count: m.lines }) : t("rev_lead_total", { count: m.lines })}
      </p>
      <div className="rounded-xl border px-4">
        <KeyValueRow label={t("rev_materials")} value={t("rev_materials_v", { count: m.lines, subs: m.subs, groups: m.groups })} />
        {m.audience === "public" && (
          <>
            <KeyValueRow label={t("rev_reaches")} value={`${t("reach_public", { count: m.reach })}${m.favourite ? ` ${t("reach_fav", { name: m.favourite })}` : ""}`} />
            {m.perSub.length > 0 && <KeyValueRow label={t("rev_by_sub")} value={`${m.perSub.map((s) => `${s.name} ${s.count}`).join(" · ")} (${t("rev_distinct", { count: m.reach })})`} />}
          </>
        )}
        {m.audience === "private" && <KeyValueRow label={t("rev_reaches")} value={t("rev_private", { count: m.privateCount })} />}
        {m.audience === "direct" && <KeyValueRow label={t("rev_reaches")} value={m.directName || "—"} />}
        {m.deadline && <KeyValueRow label={t("deadline")} value={`${fmtDay(m.deadline)}${m.daysToDeadline != null ? ` · ${t("in_days", { count: m.daysToDeadline })}` : ""}`} />}
        <KeyValueRow label={t("rev_link")} value={m.link ? t("rev_link_on") : t("rev_link_off")} />
        <KeyValueRow label={t("pricing")} value={m.pricing === "line" ? t("pricing_line") : t("pricing_total")} />
        <KeyValueRow label={t("rev_terms")} value={m.terms} />
        <KeyValueRow label={t("rev_delivery")} value={m.delivery} />
        {m.files.length > 0 && <KeyValueRow label={t("attachments")} value={m.files.join(locale === "ar" ? "، " : ", ")} />}
        {m.budget && (
          <KeyValueRow
            label={t("budget")}
            value={
              <span>
                <b className="tabular-nums" dir="ltr">
                  {sarLtr(m.budget)}
                </b>{" "}
                <span className="text-xs font-normal text-muted-foreground">{t("budget_hidden")}</span>
              </span>
            }
          />
        )}
      </div>
      {m.audience === "public" && m.reach === 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {t("rev_reach_none")}
        </p>
      )}
      {m.noSpec.map((n) => (
        <p key={`s-${n}`} className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {t("rev_no_spec", { name: n })}
        </p>
      ))}
      {m.outside.map((n) => (
        <p key={`o-${n}`} className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {t("rev_outside", { name: n })}
        </p>
      ))}
      {m.unitDiffers.map((n) => (
        <p key={`u-${n}`} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {t("rev_unit_kept", { name: n })}
        </p>
      ))}
    </div>
  )
}
