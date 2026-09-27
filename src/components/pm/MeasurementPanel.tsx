"use client"

// Execution › Measurement on a PM 1.0 project (WF-04). Sheets awaiting the PM
// are decisions with their age (and, for money holders, what approving them
// adds); the PM approves or sends back. Approved and returned sheets follow,
// newest first. Prices are shown only to holders of money.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Check, ClipboardList, Loader2, Ruler, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { DecisionRow } from "@/components/module-ui/DecisionRow"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { PM_SHEETS, sheetAge, sheetNo, sheetValue, type PmSheet, type SheetStatus } from "@/lib/pm/measurement"
import { approveSheet, PmSheetError, returnSheet, type SheetActor } from "@/lib/pm/measurement-writes"
import type { PricingBasis } from "@/lib/pm/terms"
import { WriteSheetDialog, type SheetItem } from "./WriteSheetDialog"

const TONE: Record<SheetStatus, PillTone> = { wait: "warn", ok: "ok", no: "bad" }

export function MeasurementPanel({
  projectId,
  basis,
  items,
  access,
  actor,
  onItemsChanged,
}: {
  projectId: string
  basis: PricingBasis
  items: SheetItem[]
  access: PmAccess
  actor: SheetActor
  onItemsChanged?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const today = todayDay()
  const [writing, setWriting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const sheetsQuery = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_SHEETS) : null), [firestore, projectId])
  const { data } = useCollection(sheetsQuery)
  const sheets = useMemo(() => ((data ?? []) as unknown as PmSheet[]).slice().sort((a, b) => b.seq - a.seq), [data])
  const waiting = sheets.filter((s) => s.status === "wait")
  const done = sheets.filter((s) => s.status !== "wait")
  const money = access.has("money")
  const canWrite = !access.ctx.archived && access.allowed("measurement.write")
  const canApprove = !access.ctx.archived && access.allowed("measurement.approve")
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const decide = async (s: PmSheet, how: "ok" | "no") => {
    if (!firestore) return
    setBusy(`${s.seq}:${how}`)
    try {
      if (how === "ok") {
        const r = await approveSheet(firestore, access.ctx, projectId, actor, s.seq)
        toast({ title: t("meas.approved", { no: sheetNo(s.seq) }), description: r.wentLive ? t("meas.went_live") : undefined })
        onItemsChanged?.()
      } else {
        await returnSheet(firestore, access.ctx, projectId, actor, s.seq, null)
        toast({ title: t("meas.returned", { no: sheetNo(s.seq) }) })
      }
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmSheetError && err.code === "not_waiting" ? "meas.not_waiting" : "error.save"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const linesText = (s: PmSheet) =>
    s.lines
      .map((l) => {
        const i = byId.get(l.itemId)
        const q = s.status === "ok" && l.approved != null ? l.approved : l.qty
        return `${i?.code ?? l.code ?? "?"} × ${q.toLocaleString("en-US", { maximumFractionDigits: 2 })}${s.status === "ok" && l.approved != null && l.approved < l.qty ? ` (${t("meas.cut", { qty: l.qty })})` : ""}`
      })
      .join(" · ")

  return (
    <Panel
      title={t("meas.title")}
      icon={Ruler}
      count={waiting.length || undefined}
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => setWriting(true)}>
            <ClipboardList size={15} className="me-1.5" aria-hidden="true" />
            {t("meas.new")}
          </Button>
        ) : null
      }
    >
      <Callout tone="info" className="mb-4">
        {t(basis === "lump" ? "meas.rule_lump" : "meas.rule_rem")}
      </Callout>

      {waiting.length > 0 && (
        <ul className="mb-4 divide-y overflow-hidden rounded-xl border">
          {waiting.map((s) => (
            <DecisionRow
              key={s.seq}
              severity="amber"
              icon={Ruler}
              title={t("meas.awaiting", { no: sheetNo(s.seq), who: s.byName || "—" })}
              detail={linesText(s)}
              age={t("days", { count: sheetAge(s.day, today) })}
              amount={money ? <span dir="ltr">{pmMoney(sheetValue(s.lines, items, basis))}</span> : undefined}
              action={
                canApprove ? (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => void decide(s, "ok")} disabled={busy !== null}>
                      {busy === `${s.seq}:ok` ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <Check size={14} className="me-1.5" aria-hidden="true" />}
                      {t("meas.approve")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void decide(s, "no")} disabled={busy !== null}>
                      <Undo2 size={14} className="me-1.5" aria-hidden="true" />
                      {t("meas.send_back")}
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ))}
        </ul>
      )}

      {sheets.length === 0 ? (
        <EmptyState icon={Ruler} title={t("meas.empty")} description={t("meas.empty_desc")} />
      ) : (
        done.length > 0 && (
          <ul className="space-y-2">
            {done.map((s) => (
              <li key={s.seq} className="rounded-xl border p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  {t("meas.no", { no: sheetNo(s.seq) })}
                  <StatusPill tone={TONE[s.status] ?? "mute"}>{t(`meas.status.${s.status}` as "meas.status.ok")}</StatusPill>
                  {s.self && <StatusPill tone="violet">{t("meas.self")}</StatusPill>}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("meas.line", { day: pmDate(s.day, locale), by: s.byName || "—", ok: s.okByName || "—" })}
                  {s.returnNote ? ` — ${s.returnNote}` : ""}
                </p>
                <p className="mt-1 text-xs" dir="ltr">
                  {linesText(s)}
                </p>
              </li>
            ))}
          </ul>
        )
      )}

      {canWrite && <WriteSheetDialog open={writing} onOpenChange={setWriting} projectId={projectId} access={access} actor={actor} items={items} basis={basis} onSaved={onItemsChanged} />}
    </Panel>
  )
}
