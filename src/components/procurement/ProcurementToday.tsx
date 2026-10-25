"use client"

// اليوم — Procurement's Today (PRD 2.0 TDY-01…05): the route strip; one decision list — red first, then the nearest date, with five
// chips that always show their counts, seven rows and then «عرض N أخرى»; the things we wait on others for, tagged with WHO
// (المخزون · الورشة · المورد · المستلم · المالية), six and then «عرض N أخرى»; and the platform invitations. Everything on this screen is
// derived by `src/lib/procurement/today.ts` on every read — nothing here is stored, and a member who may not see money is handed no
// amount to hide. The three numbers above are the shell's (`ProcurementHeader`).

import type { ElementType, ReactNode } from "react"
import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, CheckCircle2, Hourglass, Loader2, Send } from "lucide-react"
import { Link } from "@/i18n/routing"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { RaiseMaterialRequest } from "@/components/procurement/RaiseMaterialRequest"
import { TodayFlow } from "@/components/procurement/TodayFlow"
import { TodayInvitations } from "@/components/procurement/TodayInvitations"
import { TodayItem } from "@/components/procurement/TodayItem"
import { TodayMoreButton } from "@/components/procurement/TodayMoreButton"
import { useStepSentence } from "@/components/procurement/PoBits"
import { Button } from "@/components/ui/button"
import { useModules } from "@/hooks/useCompanyModules"
import { usePermissions } from "@/hooks/usePermissions"
import { useProcTodayWorld } from "@/hooks/useTodayWorld"
import { runsRfqs } from "@/lib/procurement/rfq-access"
import { presentParams, type Params } from "@/lib/procurement/today-present"
import { TODAY_CHIPS, chipCounts, todayFlow, todayInvitations, todayTasks, todayWaits, type TodayChip, type Wait } from "@/lib/procurement/today"
import { cn } from "@/lib/utils"

export const CLIP_TASKS = 7
export const CLIP_WAITS = 6

const MODULE_TAG: Record<Wait["module"], string> = {
  supplier: "bg-violet/10 text-violet",
  finance: "bg-success/10 text-success",
  inventory: "bg-accent/10 text-accent",
  manufacturing: "bg-warning/10 text-warning",
  projects: "bg-pm/10 text-pm",
  receiver: "bg-module/10 text-module",
  approver: "bg-warning/10 text-warning",
}

/** «A، B و C» — the sources of the need, as the prototype's subtitle lists them. */
const listOf = (items: string[], locale: string): string => (items.length < 2 ? items.join("") : locale === "ar" ? `${items.slice(0, -1).join("، ")} و${items[items.length - 1]}` : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`)

export function ProcurementToday() {
  const t = useTranslations("Portal.ProcToday")
  const tProc = useTranslations("Portal.Procurement")
  const tCon = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const { can } = usePermissions()
  const { on } = useModules()
  const stepText = useStepSentence()
  // One world and one clock per visit, shared with the header's counts.
  const { loaded, world, actor, now, needs } = useProcTodayWorld()
  const { loading } = loaded
  // The same gate as the RFQs page's «طرح طلب عروض أسعار جديد» (rfq-access.ts): whoever runs RFQs, the owner only without staff.
  const runner = { ...loaded.actor, managesRfqs: can("rfq.manage") || can("rfq.create"), ownerHasTeam: loaded.actor.isOwner && needs.ownerHasTeam }
  const canCreate = runsRfqs(runner) && (can("rfq.create") || can("projects.publish") || can("offers.accept") || can("po.approve"))
  const tasks = useMemo(() => todayTasks(world, actor, now), [world, actor, now])
  const waits = useMemo(() => todayWaits(world, actor, now), [world, actor, now])
  const flow = useMemo(() => todayFlow(world, actor, now), [world, actor, now])
  const invitations = useMemo(() => todayInvitations(world.invitations || [], world.supplierRecords, now), [world.invitations, world.supplierRecords, now])
  const counts = useMemo(() => chipCounts(tasks), [tasks])

  const [chip, setChip] = useState<TodayChip | "all">("all")
  const [allTasks, setAllTasks] = useState(false)
  const [allWaits, setAllWaits] = useState(false)

  const shown = chip === "all" ? tasks : tasks.filter((x) => x.chip === chip)
  const visibleTasks = allTasks ? shown : shown.slice(0, CLIP_TASKS)
  const visibleWaits = allWaits ? waits : waits.slice(0, CLIP_WAITS)

  const sources = listOf([on("project-management") ? t("page.source_projects") : t("page.source_team"), on("manufacturing") ? t("page.source_workshop") : "", t("page.source_inventory")].filter(Boolean), locale)
  const present = (p: Params) => presentParams(p, locale, (key) => tProc(key))
  const waitSub = (w: Wait) => (w.step ? stepText(w.step) : t(w.subKey, present(w.subParams)))

  return (
    <div className="space-y-6">
      <ProcurementHeader
        title={t("page.title")}
        description={t("page.subtitle", { sources })}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <RaiseMaterialRequest orgId={loaded.orgId} />
            {canCreate && (
              <Button asChild className="gap-2 rounded-xl bg-module text-module-foreground hover:bg-module/90">
                <Link href="/contractor/rfqs/new">
                  <Send size={16} aria-hidden="true" />
                  {tCon("rfqv_new")}
                </Link>
              </Button>
            )}
          </div>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : (
        <>
          <TodayFlow tiles={flow} />
          <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            {/* ── Needs your decision — red first, then the nearest date ── */}
            <Panel testId="today-decisions" title={t("title")} icon={AlertTriangle} count={tasks.length}>
              <div className="border-b px-4 py-2.5">
                <ProcChipGroup<TodayChip | "all">
                  label={t("groups.all")}
                  active={chip}
                  onPick={(c) => {
                    setChip(c)
                    setAllTasks(false)
                  }}
                  items={(["all", ...TODAY_CHIPS] as Array<TodayChip | "all">).map((c) => ({ id: c, label: t(`groups.${c}`), count: counts[c] }))}
                />
              </div>
              {shown.length === 0 ? (
                <Empty icon={CheckCircle2} title={t("empty.title")} body={t("empty.body")} />
              ) : (
                <ul className="divide-y">
                  {visibleTasks.map((task) => (
                    <TodayItem key={task.id} task={task} />
                  ))}
                </ul>
              )}
              {shown.length > CLIP_TASKS && <TodayMoreButton open={allTasks} onClick={() => setAllTasks((v) => !v)} label={allTasks ? t("showLess") : t("showMore", { count: shown.length - CLIP_TASKS })} />}
            </Panel>

            <div className="space-y-4">
              {/* ── Waiting on others — no button, by design ── */}
              <Panel testId="today-waits" title={t("waits.title")} icon={Hourglass} count={waits.length}>
                {waits.length === 0 ? (
                  <Empty icon={CheckCircle2} title={t("waits.empty")} />
                ) : (
                  <ul className="divide-y">
                    {visibleWaits.map((w) => (
                      <li key={w.id}>
                        <Link href={w.href} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold leading-snug text-foreground" dir="auto">
                              {t(w.titleKey, present(w.titleParams))}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground" dir="auto">
                              {waitSub(w)}
                              {w.kind === "held_inspection" && w.reasonCode && <> · {tProc(`holdReason.${w.reasonCode}`)}</>}
                            </p>
                          </div>
                          <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold", MODULE_TAG[w.module])}>{t(`modules.${w.module}`)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {waits.length > CLIP_WAITS && <TodayMoreButton open={allWaits} onClick={() => setAllWaits((v) => !v)} label={allWaits ? t("showLess") : t("showMore", { count: waits.length - CLIP_WAITS })} />}
              </Panel>

              <TodayInvitations rows={invitations} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Panel({ testId, title, icon: Icon, count, children }: { testId: string; title: string; icon: ElementType; count?: number; children: ReactNode }) {
  return (
    <section data-testid={testId} className="min-w-0 overflow-hidden rounded-2xl border bg-card">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3.5">
        <h2 className="flex items-center gap-2 text-base font-black text-foreground">
          <Icon size={15} className="shrink-0 text-module" aria-hidden="true" />
          {title}
        </h2>
        {count != null && count > 0 && <span className="shrink-0 rounded-full bg-module/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-module">{count}</span>}
      </header>
      {children}
    </section>
  )
}

function Empty({ icon: Icon, title, body }: { icon: ElementType; title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
      <Icon size={20} className="text-success" aria-hidden="true" />
      <p className="text-sm font-bold text-foreground">{title}</p>
      {body && <p className="text-xs text-muted-foreground">{body}</p>}
    </div>
  )
}
