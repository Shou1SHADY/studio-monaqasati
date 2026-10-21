"use client"

// «سحبه المشروع» / «عدّله المشروع» on an RFQ or an order (PUR-01 p.5, step 6): what the project
// took back or reduced on the request this document answers, after it was published. Read from the
// request itself — the line's own close, with who and the day — so there is nothing to keep in step.
// The decision is Procurement's: cancel, adjust with the supplier, or keep. Shows nothing when the
// project changed nothing. Usage: `<ProjectChangedFlag from={rfq} />` (an order passes itself: it names
// its request in `purchaseSource`).

import { useMemo } from "react"
import { doc } from "firebase/firestore"
import { useLocale, useTranslations } from "next-intl"
import { useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { Callout } from "@/components/module-ui/Callout"
import { fmtDay, qty } from "@/components/procurement/need-bits"
import { displayNeedRef } from "@/lib/procurement/format"
import type { ProjectRequestDoc } from "@/lib/procurement/needs"
import { projectRequestsOf, requestChanges, type ProjectRequestRef } from "@/lib/procurement/project-change"
import type { NeedLinkedRfq } from "@/lib/procurement/rfq-view"
import { cn } from "@/lib/utils"

export function ProjectChangedFlag({ from, className }: { from: NeedLinkedRfq | null | undefined; className?: string }) {
  const sources = useMemo(() => (from ? projectRequestsOf(from) : []), [from])
  if (!sources.length) return null
  return (
    <div className={cn("space-y-2", className)}>
      {sources.map((source) => (
        <RequestFlag key={`${source.projectId}/${source.purchaseRequestId}/${source.line ?? ""}`} source={source} />
      ))}
    </div>
  )
}

function RequestFlag({ source }: { source: ProjectRequestRef }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const ref = useMemoFirebase(() => (firestore ? doc(firestore, "projects", source.projectId, "purchaseRequests", source.purchaseRequestId) : null), [firestore, source.projectId, source.purchaseRequestId])
  const { data } = useDoc<Omit<ProjectRequestDoc, "id">>(ref)
  if (!data) return null
  const changes = requestChanges({ pm: data.pm, status: data.status, lines: data.lines }, source.line)
  if (!changes.length) return null
  const number = data.pm ? displayNeedRef(`MR ${source.purchaseRequestId}`, locale) : ""
  return (
    <>
      {changes.map((c) => (
        <Callout key={c.kind} tone="warn" title={`${t(c.kind === "withdrawn" ? "pchg_withdrawn" : "pchg_changed")}${number ? ` · ${number}` : ""}`}>
          <p className="text-xs font-semibold text-foreground">{c.byName || c.on ? t("pchg_by", { name: c.byName || "—", date: c.on ? fmtDay(c.on, locale) : "—" }) : ""}</p>
          <ul className="mt-1 list-disc ps-5 text-xs">
            {c.lines.map((l) => (
              <li key={l.line} dir="auto">
                {c.kind === "withdrawn" ? t("pchg_line_withdrawn", { name: l.name, qty: qty(l.was), unit: l.unit }) : t("pchg_line_changed", { name: l.name, was: qty(l.was), now: qty(l.now), unit: l.unit })}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs">{t("pchg_decide")}</p>
        </Callout>
      ))}
    </>
  )
}
