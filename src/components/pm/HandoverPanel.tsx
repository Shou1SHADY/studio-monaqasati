"use client"

// File › Contract details › Handover & defects period on a PM 1.0 project
// (WF-25, prototype handPanel). Provisional handover at ≥ 99% progress starts
// the defects period from the contract in force; final acceptance needs the
// provisional and a closed punch list. Each tells Finance once (prj:HND); where
// the retention stands is shown to money holders — claiming and releasing it
// are Finance's.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Flag, FlagTriangleRight, KeyRound, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { defectsEnd, defectsLeft, finalBlocks, progressOf, provisionalBlocks, PROVISIONAL_AT, retentionClaimable, type Acceptances } from "@/lib/pm/acceptance"
import { PmAcceptanceError, recordFinal, recordProvisional, type AcceptanceActor } from "@/lib/pm/acceptance-writes"
import { inForce, PM_ADDENDA, type PmAddendum } from "@/lib/pm/addenda"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { retentionPhase } from "@/lib/pm/retention-phase"
import { isOpenPunch, PM_PUNCH, type PunchItem } from "@/lib/pm/punch"
import type { ContractTerms } from "@/lib/pm/terms"
import { cn } from "@/lib/utils"

export function HandoverPanel({
  projectId,
  lifecycle,
  original,
  acceptances,
  retentionHeld,
  items,
  access,
  actor,
  retentionReleased = false,
  retentionHalfReleased = false,
}: {
  projectId: string
  lifecycle: string
  original: ContractTerms
  acceptances: Acceptances
  retentionHeld: number
  /** Finance's facts: the whole retention, or the provisional half, has been released. */
  retentionReleased?: boolean
  retentionHalfReleased?: boolean
  items: Array<{ quantity: number; rate: number; executed: number }>
  access: PmAccess
  actor: AcceptanceActor
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState<"prov" | "final" | null>(null)
  const seesTerms = access.has("money") || access.has("approve")

  const punchQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_PUNCH) : null), [firestore, projectId])
  const { data: punch } = useCollection(punchQ)
  const addQ = useMemoFirebase(() => (firestore && seesTerms ? collection(firestore, "projects", projectId, PM_ADDENDA) : null), [firestore, projectId, seesTerms])
  const { data: addenda } = useCollection(addQ)
  const terms = useMemo(() => inForce(original, (addenda ?? []) as unknown as PmAddendum[]), [original, addenda])

  const openPunch = ((punch ?? []) as unknown as PunchItem[]).filter(isOpenPunch).length
  const progress = progressOf(items)
  const archived = access.ctx.archived
  const provB = provisionalBlocks({ archived, lifecycle, acceptances, progress })
  const dlpEnd = acceptances.prov ? defectsEnd(acceptances.prov.on, terms.defectsDays) : null
  const finB = finalBlocks({ archived, lifecycle, acceptances, openPunch, defectsEnd: dlpEnd, today: todayDay() })
  const dlpOver = dlpEnd ? dlpEnd <= todayDay() : false
  const left = dlpEnd ? defectsLeft(dlpEnd, todayDay()) : null
  const phase = retentionPhase({ acceptances, release: terms.retentionRelease, halfReleased: retentionHalfReleased, released: retentionReleased })
  const sent = <SourceBadge module="payments" label={t("hnd.sent_finance")} className="ms-1.5" />

  const run = async (which: "prov" | "final") => {
    if (!firestore) return
    setBusy(which)
    try {
      if (which === "prov") await recordProvisional(firestore, access.ctx, projectId, actor)
      else await recordFinal(firestore, access.ctx, projectId, actor)
      toast({ title: t(which === "prov" ? "hnd.prov_done" : "hnd.final_done") })
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmAcceptanceError && err.blocks[0] ? `hnd.block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  const canProv = access.allowed("handover.provisional")
  const canFinal = access.allowed("handover.final")

  const phaseHead = (icon: typeof Flag, title: string, done: boolean) => {
    const Icon = icon
    return (
      <h4 className="flex items-center gap-2 text-sm font-bold">
        <Icon size={15} className="shrink-0 text-module" aria-hidden="true" />
        <span className="min-w-0 flex-1">{title}</span>
        <StatusPill tone={done ? "ok" : "mute"}>{t(done ? "hnd.recorded" : "hnd.not_recorded")}</StatusPill>
      </h4>
    )
  }

  // UX-15: one panel, flat rows — provisional, final and the retention are divided by a line, not boxed in sub-cards.
  return (
    <Panel title={t("hnd.title")} icon={KeyRound} description={t("hnd.sub")} bodyClassName="p-0">
      <div className="divide-y">
        <section className="space-y-1 px-4 py-3" data-hnd-phase="prov">
          {phaseHead(Flag, t("hnd.prov"), Boolean(acceptances.prov))}
          <KeyValueRow label={t("hnd.progress", { at: PROVISIONAL_AT })} value={progress === null ? "—" : `${progress}%`} ltr />
          {acceptances.prov ? (
            <>
              <KeyValueRow
                label={t("hnd.recorded")}
                value={
                  <span>
                    {t("hnd.by_on", { who: acceptances.prov.byName || "—", date: pmDate(acceptances.prov.on, locale) })}
                    {sent}
                  </span>
                }
              />
              <KeyValueRow
                label={t("hnd.dlp_end", { days: terms.defectsDays })}
                value={
                  <span>
                    {pmDate(dlpEnd, locale)}
                    {left !== null && (
                      <span className={cn("ms-1.5 text-xs", left <= 0 ? "font-bold text-warning" : "text-muted-foreground")}>
                        · {left <= 0 ? t("hnd.dlp_ended", { count: -left }) : t("hnd.dlp_left", { count: left })}
                      </span>
                    )}
                  </span>
                }
              />
            </>
          ) : canProv ? (
            <div className="space-y-2 pt-2">
              <BlockingReasons title={t("hnd.cannot")} reasons={provB.map((b) => t(`hnd.block.${b}`, { at: PROVISIONAL_AT }))} />
              <Button size="sm" className="max-sm:min-h-11" onClick={() => void run("prov")} disabled={busy !== null || provB.length > 0}>
                {busy === "prov" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
                {t("hnd.record_prov")}
              </Button>
            </div>
          ) : null}
        </section>

        <section className="space-y-1 px-4 py-3" data-hnd-phase="final">
          {phaseHead(FlagTriangleRight, t("hnd.final"), Boolean(acceptances.final))}
          <KeyValueRow label={t("hnd.open_punch")} value={String(openPunch)} ltr />
          {acceptances.final ? (
            <KeyValueRow
              label={t("hnd.recorded")}
              value={
                <span>
                  {t("hnd.by_on", { who: acceptances.final.byName || "—", date: pmDate(acceptances.final.on, locale) })}
                  {sent}
                </span>
              }
            />
          ) : !canFinal ? (
            acceptances.prov ? <p className="pt-1 text-xs text-muted-foreground">{t("hnd.by_manager")}</p> : null
          ) : (
            <div className="space-y-2 pt-2">
              {acceptances.prov && dlpEnd && !dlpOver && <p className="text-xs font-semibold text-warning">{t("hnd.before_dlp", { date: pmDate(dlpEnd, locale) })}</p>}
              <BlockingReasons title={t("hnd.cannot")} reasons={finB.map((b) => t(`hnd.block.${b}`, { at: PROVISIONAL_AT, count: openPunch, date: dlpEnd ? pmDate(dlpEnd, locale) : "" }))} />
              <Button size="sm" className="max-sm:min-h-11" onClick={() => void run("final")} disabled={busy !== null || finB.length > 0}>
                {busy === "final" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
                {t("hnd.record_final")}
              </Button>
            </div>
          )}
          {acceptances.prov && !acceptances.final && dlpOver && <Callout tone="block" className="mt-2">{t("hnd.dlp_over")}</Callout>}
        </section>

        {access.has("client") && access.has("money") && retentionHeld > 0 && (
          <section className="px-4 py-3" data-hnd-phase="retention">
            <KeyValueRow
              label={t("hnd.ret_held")}
              value={
                <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                  <span dir="ltr">{pmMoney(retentionHeld)}</span>
                  <span className="text-xs font-normal text-muted-foreground">· {t(`hnd.ret_phase.${phase}`)}</span>
                  <SourceBadge module="payments" label={t("money.from_finance")} />
                </span>
              }
            />
            <KeyValueRow label={t("hnd.ret_claimable", { rule: t(`terms.opt.retentionRelease.${terms.retentionRelease}`) })} value={pmMoney(retentionClaimable(retentionHeld, terms.retentionRelease, acceptances))} ltr strong />
            <p className="mt-1 text-xs text-muted-foreground">{t("hnd.ret_note")}</p>
          </section>
        )}
        <p className="bg-muted/30 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">{t("hnd.event_note")}</p>
      </div>
    </Panel>
  )
}
