"use client"

// The Pulse's delivery-units card (the prototype's side panel): each unit's
// progress with its state — handed over, ready, or its date at risk.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Box } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { usePmUnits } from "@/hooks/usePmUnits"
import { pmPct, todayDay } from "@/lib/pm/format"
import { isOpenOrFailed, PM_INSPECTIONS, type PmInspection } from "@/lib/pm/inspection"
import { isOpenPunch, PM_PUNCH, type PunchItem } from "@/lib/pm/punch"
import { UNIT_DONE_AT, unitBlocks, unitFigures, unitState, unitTight } from "@/lib/pm/units"
import { cn } from "@/lib/utils"

export function UnitsPulsePanel({ projectId, items, startedOn, onDetails }: { projectId: string; items: Array<{ id?: string; rate: number }>; startedOn: string | null; onDetails: () => void }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const today = todayDay()
  const { units } = usePmUnits(projectId, true)
  const punchQ = useMemoFirebase(() => (firestore && units.length ? collection(firestore, "projects", projectId, PM_PUNCH) : null), [firestore, projectId, units.length])
  const wirQ = useMemoFirebase(() => (firestore && units.length ? collection(firestore, "projects", projectId, PM_INSPECTIONS) : null), [firestore, projectId, units.length])
  const { data: punchData } = useCollection(punchQ)
  const { data: wirData } = useCollection(wirQ)
  const rows = useMemo(() => {
    const priced = items.filter((i): i is { id: string; rate: number } => Boolean(i.id))
    const open = { punch: ((punchData ?? []) as unknown as PunchItem[]).filter(isOpenPunch), inspections: ((wirData ?? []) as unknown as PmInspection[]).filter(isOpenOrFailed) }
    return units.map((u) => {
      const f = unitFigures(u, priced)
      const tight = unitTight(u, f, startedOn, today)
      return { u, f, tight, state: unitState(u, unitBlocks(u, priced, open), tight) }
    })
  }, [units, items, punchData, wirData, startedOn, today])

  if (!units.length) return null
  return (
    <Panel
      title={t("units.tab")}
      icon={Box}
      actions={
        <Button size="sm" variant="outline" onClick={onDetails}>
          {t("units.pulse_details")}
        </Button>
      }
      bodyClassName="flex flex-col gap-2"
    >
      {rows.map(({ u, f, tight, state }) => (
        <div key={u.id} className="flex items-center gap-2">
          <b className="min-w-16 truncate text-xs" dir="auto">
            {u.name}
          </b>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted" role="presentation">
            <span className={cn("block h-full rounded-full", f.progress >= UNIT_DONE_AT ? "bg-success" : tight ? "bg-warning" : "bg-module")} style={{ width: `${Math.min(100, f.progress)}%` }} />
          </div>
          <span className="min-w-10 text-end text-[11px] font-bold tabular-nums" dir="ltr">
            {pmPct(f.progress / 100)}
          </span>
          {state === "done" && <StatusPill tone="ok">{t("units.pulse_done")}</StatusPill>}
          {state === "ready" && <StatusPill tone="info">{t("units.pulse_ready")}</StatusPill>}
          {state === "risk" && <StatusPill tone="warn">{t("units.pulse_risk")}</StatusPill>}
        </div>
      ))}
    </Panel>
  )
}
