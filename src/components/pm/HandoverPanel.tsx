"use client"

// File › Handover on a PM 1.0 project (WF-25). Provisional handover at ≥ 99%
// progress starts the defects period from the contract in force; final
// acceptance needs the provisional and a closed punch list. Each tells Finance
// once (prj:HND); the retention they make claimable is shown to money holders —
// claiming it is Finance's.

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
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { defectsEnd, defectsLeft, finalBlocks, progressOf, provisionalBlocks, PROVISIONAL_AT, retentionClaimable, type Acceptances } from "@/lib/pm/acceptance"
import { PmAcceptanceError, recordFinal, recordProvisional, type AcceptanceActor } from "@/lib/pm/acceptance-writes"
import { inForce, PM_ADDENDA, type PmAddendum } from "@/lib/pm/addenda"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
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
}: {
  projectId: string
  lifecycle: string
  original: ContractTerms
  acceptances: Acceptances
  retentionHeld: number
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
  const finB = finalBlocks({ archived, lifecycle, acceptances, openPunch })
  const dlpEnd = acceptances.prov ? defectsEnd(acceptances.prov.on, terms.defectsDays) : null
  const dlpOver = dlpEnd ? dlpEnd <= todayDay() : false
  const left = dlpEnd ? defectsLeft(dlpEnd, todayDay()) : null
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

  return (
    <Panel title={t("hnd.title")} icon={KeyRound}>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-xl border p-3">
          <h4 className="flex items-center gap-2 text-sm font-bold">
            <Flag size={15} className="text-module" aria-hidden="true" />
            {t("hnd.prov")}
          </h4>
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
          ) : !canProv ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("hnd.not_recorded")}</p>
          ) : (
            canProv && (
              <div className="mt-3 space-y-2">
                <BlockingReasons title={t("hnd.cannot")} reasons={provB.map((b) => t(`hnd.block.${b}`, { at: PROVISIONAL_AT }))} />
                <Button onClick={() => void run("prov")} disabled={busy !== null || provB.length > 0}>
                  {busy === "prov" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
                  {t("hnd.record_prov")}
                </Button>
              </div>
            )
          )}
        </section>

        <section className="rounded-xl border p-3">
          <h4 className="flex items-center gap-2 text-sm font-bold">
            <FlagTriangleRight size={15} className="text-module" aria-hidden="true" />
            {t("hnd.final")}
          </h4>
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
            <p className="mt-2 text-xs text-muted-foreground">{t(acceptances.prov ? "hnd.by_manager" : "hnd.not_recorded")}</p>
          ) : (
            canFinal && (
              <div className="mt-3 space-y-2">
                {acceptances.prov && dlpEnd && !dlpOver && <Callout tone="warn">{t("hnd.before_dlp", { date: pmDate(dlpEnd, locale) })}</Callout>}
                <BlockingReasons title={t("hnd.cannot")} reasons={finB.map((b) => t(`hnd.block.${b}`, { at: PROVISIONAL_AT, count: openPunch }))} />
                <Button onClick={() => void run("final")} disabled={busy !== null || finB.length > 0}>
                  {busy === "final" && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
                  {t("hnd.record_final")}
                </Button>
              </div>
            )
          )}
          {acceptances.prov && !acceptances.final && dlpOver && <Callout tone="block" className="mt-3">{t("hnd.dlp_over")}</Callout>}
        </section>
      </div>

      {access.has("client") && access.has("money") && retentionHeld > 0 && (
        <div className="mt-4 rounded-xl border p-3">
          <KeyValueRow label={t("hnd.ret_held")} value={pmMoney(retentionHeld)} ltr />
          <KeyValueRow label={t("hnd.ret_claimable", { rule: t(`terms.opt.retentionRelease.${terms.retentionRelease}`) })} value={pmMoney(retentionClaimable(retentionHeld, terms.retentionRelease, acceptances))} ltr strong />
          <p className="mt-1 text-xs text-muted-foreground">{t("hnd.ret_note")}</p>
        </div>
      )}
      <Callout tone="info" className="mt-4">
        {t("hnd.event_note")}
      </Callout>
    </Panel>
  )
}
