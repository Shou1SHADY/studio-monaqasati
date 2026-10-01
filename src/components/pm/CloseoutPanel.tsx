"use client"

// File › Closeout on a PM 1.0 project (WF-26, ARC-01, CST-04, SC-04). A project
// ends with its last document, not its last pour: the closeout list — every row
// must hold, each row opens the screen that settles it — and the one "Close &
// archive" gate; once archived, the final snapshot, frozen and never
// recomputed. Rows that depend on Finance (collection, retention release,
// paying a subcontractor) wait for Finance and carry no button here (WAIT-01).
// Below, what the project taught — numbers, not opinions.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc } from "firebase/firestore"
import { Archive, BookOpen, CheckCircle2, Clock, Coins, Loader2, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { useProjectCost } from "@/hooks/useProjectCost"
import { useSupplyWorld } from "@/hooks/useSupplyWorld"
import { PmAccessError } from "@/lib/pm/access"
import type { Acceptances } from "@/lib/pm/acceptance"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import type { PmCertificate } from "@/lib/pm/certificate-writes"
import { CLOSE_ROW_TAB, closeBlocks, closeoutRows, materialLost, projectLessons, storeHoldings, subDues, type ArchiveSnapshot, type CloseRow } from "@/lib/pm/closeout"
import { openMoneyRows, shownCloseRows } from "@/lib/pm/closeout-view"
import { itemCosts, projectCost } from "@/lib/pm/cost"
import { closeAndArchive, PmCloseError, type CloseActor } from "@/lib/pm/closeout-writes"
import { PM_LETTERS, type PmLetter } from "@/lib/pm/correspondence"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { PM_NCRS, type PmNcr } from "@/lib/pm/ncr"
import { PM_PUNCH, type PunchItem } from "@/lib/pm/punch"
import { PM_OBSTACLES, type PmObstacle } from "@/lib/pm/site"
import { PM_SUB_CERTIFICATES, PM_SUBCONTRACTS, type PmSubCertificate, type PmSubcontract } from "@/lib/pm/subcontract"
import { PM_VARIATIONS, type PmVariation } from "@/lib/pm/variation"
import { cn } from "@/lib/utils"
import { usePmIndirect } from "@/hooks/usePmIndirect"
import { onSite, PM_PLANT, type PmPlant } from "@/lib/pm/plant"

const AMOUNT_ROWS = new Set<CloseRow["key"]>(["unbilled", "overdue", "retention"])
const FINANCE_ROWS = new Set<CloseRow["key"]>(["overdue", "retention", "subs"])

type PmBlock = {
  acceptances?: Acceptances
  cutPool?: number
  retentionHeld?: number
  retentionReleased?: boolean
  fin?: ArchiveSnapshot | null
  closedOn?: string | null
  closedByName?: string | null
}

export function CloseoutPanel({
  projectId,
  lifecycle,
  hasClient,
  pm,
  items,
  access,
  actor,
  sections,
  warehouseId,
  managerName,
  onOpen,
}: {
  projectId: string
  lifecycle: string
  hasClient: boolean
  pm: PmBlock
  items: Array<{ id: string; code: string; description: string; unit: string; division: string; quantity: number; rate: number; executed: number; billed: number; estCost?: number }>
  access: PmAccess
  actor: CloseActor
  /** The project's enabled sections: the store and subcontractor rows follow them. */
  sections?: string[]
  warehouseId?: string | null
  managerName?: string | null
  /** Opens the screen that settles a row (a project tab key). */
  onOpen?: (tab: string) => void
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const money = access.has("money")
  const clientMoney = money && access.has("client")
  const storeOn = (sections ?? []).includes("store")
  const subsOn = (sections ?? []).includes("subs")
  const projectRef = useMemoFirebase(() => (firestore ? doc(firestore, "projects", projectId) : null), [firestore, projectId])
  const { data: projectDoc } = useDoc<{ organizationId?: string }>(projectRef)
  const orgId = projectDoc?.organizationId ?? null
  // The project's OWN store ledger (pmStore) — a company warehouse is not its custody.
  const supply = useSupplyWorld(projectId, orgId)
  const costWorld = useProjectCost(projectId, orgId, money)
  const indirect = usePmIndirect(projectId, orgId, money)

  const sub = (name: string, on = true) => (firestore && on ? collection(firestore, "projects", projectId, name) : null)
  const punchQ = useMemoFirebase(() => sub(PM_PUNCH), [firestore, projectId])
  const { data: punch } = useCollection(punchQ)
  const certQ = useMemoFirebase(() => sub(PM_CERTIFICATES, money), [firestore, projectId, money])
  const { data: certs } = useCollection(certQ)
  const ncrQ = useMemoFirebase(() => sub(PM_NCRS), [firestore, projectId])
  const { data: ncrs } = useCollection(ncrQ)
  const voQ = useMemoFirebase(() => sub(PM_VARIATIONS), [firestore, projectId])
  const { data: vos } = useCollection(voQ)
  const scQ = useMemoFirebase(() => sub(PM_SUBCONTRACTS), [firestore, projectId])
  const { data: contracts } = useCollection(scQ)
  const scCertQ = useMemoFirebase(() => sub(PM_SUB_CERTIFICATES), [firestore, projectId])
  const { data: subCerts } = useCollection(scCertQ)
  const letterQ = useMemoFirebase(() => sub(PM_LETTERS), [firestore, projectId])
  const { data: letters } = useCollection(letterQ)
  const obsQ = useMemoFirebase(() => sub(PM_OBSTACLES), [firestore, projectId])
  const { data: obstacles } = useCollection(obsQ)
  const plantQ = useMemoFirebase(() => sub(PM_PLANT), [firestore, projectId])
  const { data: plant } = useCollection(plantQ)
  const seatQ = useMemoFirebase(() => sub("members"), [firestore, projectId])
  const { data: members } = useCollection(seatQ)
  const storeLines = useMemo(() => (storeOn ? storeHoldings(supply.stores, items).lines : null), [storeOn, supply.stores, items])
  const lost = useMemo(() => (storeOn || supply.stores.length ? materialLost(supply.stores, supply.costOf) : null), [storeOn, supply.stores, supply.costOf])
  const closingCost = useMemo(() => {
    if (!money || costWorld.isLoading) return null
    const costItems = items.map((i) => ({ ...i, estCost: i.estCost ?? 0 }))
    const { items: costs, unassigned } = itemCosts({ items: costItems, pos: costWorld.pos, issues: costWorld.issues, projectWarehouseId: warehouseId ?? null, subcontracts: costWorld.subcontracts, direct: costWorld.direct })
    const c = projectCost({ items: costItems, costs, unassigned, variations: costWorld.variations, baseValue: 0, penalty: 0, indirect: { budget: indirect.budget, actual: indirect.actual } })
    return { actual: c.actual, earned: c.earned }
  }, [money, costWorld, items, warehouseId, indirect.budget, indirect.actual])

  const rows = useMemo(() => {
    const scList = (contracts ?? []) as unknown as PmSubcontract[]
    return closeoutRows({
      hasClient,
      acceptances: pm.acceptances ?? {},
      punch: (punch ?? []) as unknown as PunchItem[],
      ncrs: (ncrs ?? []) as unknown as PmNcr[],
      variations: (vos ?? []) as unknown as PmVariation[],
      items,
      cutPool: pm.cutPool ?? 0,
      certificates: (certs ?? []) as unknown as PmCertificate[],
      retentionHeld: pm.retentionHeld ?? 0,
      retentionReleased: pm.retentionReleased === true,
      storeLines,
      subs: subsOn || scList.length ? subDues(scList, (subCerts ?? []) as unknown as PmSubCertificate[]) : null,
      letters: (letters ?? []) as unknown as PmLetter[],
      plantOnSite: plant?.length ? onSite(plant as unknown as Array<Pick<PmPlant, "status">>).length : null,
      today: todayDay(),
    })
  }, [hasClient, pm, punch, items, certs, ncrs, vos, contracts, subCerts, letters, storeLines, subsOn, plant])
  const blocked = closeBlocks(rows)
  // Without money the certificates are not read — their rows are not shown rather
  // than shown wrong; without the client side they are not this person's to see.
  const shown = shownCloseRows(rows, clientMoney)
  const left = shown.filter((r) => !r.ok)
  const openMoney = openMoneyRows(rows, clientMoney)
  const canClose = access.allowed("project.close") && lifecycle === "done"

  const lessons = useMemo(
    () =>
      projectLessons({
        ncrs: (ncrs ?? []) as unknown as PmNcr[],
        obstacles: (obstacles ?? []) as unknown as PmObstacle[],
        seats: (members ?? []).filter((m) => typeof (m as { pmRole?: unknown }).pmRole === "string").length,
      }),
    [ncrs, obstacles, members]
  )

  const close = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      await closeAndArchive(firestore, access.ctx, projectId, actor, closingCost)
      toast({ title: t("close.done") })
      setConfirming(false)
    } catch (err) {
      console.error(err)
      const msg = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmCloseError ? (err.code === "not_done" ? "close.not_done" : "close.blocked_toast") : "error.save"
      toast({ title: t(msg), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const sentence = (r: CloseRow): string => {
    if (r.ok) {
      if (r.key === "prov") return pmDate(pm.acceptances?.prov?.on, locale)
      if (r.key === "final") return pmDate(pm.acceptances?.final?.on, locale)
      return t(`close.ok.${r.key}`)
    }
    if (r.key === "final") return pm.acceptances?.prov?.on ? t("close.why.final_from", { date: pmDate(pm.acceptances.prov.on, locale) }) : t("close.why.final")
    if (r.key === "subs") {
      const parts: string[] = []
      if ((r.n ?? 0) > 0.5) parts.push(money ? t("close.why.subs", { amount: pmMoney(r.n ?? 0) }) : t("close.why.subs_hidden"))
      if ((r.m ?? 0) > 0) parts.push(t("close.why.subs_pending", { count: r.m ?? 0 }))
      return parts.join(" · ")
    }
    if (AMOUNT_ROWS.has(r.key)) return t(`close.why.${r.key}`, { amount: pmMoney(r.n ?? 0) })
    return t(`close.why.${r.key}`, { count: r.n ?? 0 })
  }

  const lessonsPanel = <LessonsPanel lessons={lessons} money={money} lost={lost} />

  if (lifecycle === "closed" && pm.fin) {
    const f = pm.fin
    return (
      <div className="space-y-4">
        <Panel title={t("close.archived_title")} icon={Lock}>
          <Callout tone="info" className="mb-4">
            {t("close.archived_note", { date: pmDate(pm.closedOn, locale), who: pm.closedByName || "—" })}
          </Callout>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {money && <KeyValueRow label={t("close.snap.contract")} value={pmMoney(f.contractValue)} ltr />}
            {money && <KeyValueRow label={t("close.snap.earned")} value={pmMoney(f.earned)} ltr />}
            {money && <KeyValueRow label={t("close.snap.certified")} value={pmMoney(f.certified)} ltr />}
            {money && f.actualCost != null && <KeyValueRow label={t("close.snap.actual_cost")} value={pmMoney(f.actualCost)} ltr />}
            {money && f.margin != null && (
              <KeyValueRow
                label={t("close.snap.margin")}
                value={
                  <span dir="ltr" className="inline-flex items-center gap-1.5">
                    {f.marginPct != null && <b className={cn(f.marginPct > 10 ? "text-success" : "text-warning")}>{f.marginPct}%</b>}
                    <span>· {pmMoney(f.margin)}</span>
                  </span>
                }
              />
            )}
            {money && <KeyValueRow label={t("close.snap.retention")} value={pmMoney(f.retentionHeld)} ltr />}
            {money && <KeyValueRow label={t("close.snap.advance")} value={pmMoney(f.advanceRecovered)} ltr />}
            <KeyValueRow
              label={t("close.snap.duration")}
              value={
                <span className="inline-flex items-center gap-2">
                  <span dir="ltr">
                    {f.actualDays ?? "—"} / {f.contractDays ?? "—"}
                  </span>
                  {f.delayDays !== null &&
                    (f.delayDays > 0 ? <StatusPill tone="bad">{t("close.snap.late", { count: f.delayDays })}</StatusPill> : <StatusPill tone="ok">{t("close.snap.on_time")}</StatusPill>)}
                </span>
              }
            />
            <KeyValueRow label={t("close.snap.contract_days")} value={f.contractDays === null ? "—" : t("days", { count: f.contractDays })} />
            <KeyValueRow label={t("close.snap.actual_days")} value={f.actualDays === null ? "—" : t("days", { count: f.actualDays })} />
            <KeyValueRow label={t("close.snap.closed_on")} value={pmDate(f.closedOn, locale)} />
            <KeyValueRow label={t("close.snap.manager")} value={<span dir="auto">{managerName || "—"}</span>} />
          </div>
          {money && f.actualCost == null && <p className="mt-2 text-xs text-muted-foreground">{t("close.snap.cost_note")}</p>}
        </Panel>
        {lessonsPanel}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Panel
        title={
          <span className="inline-flex items-center gap-2">
            {t("close.title_full")}
            <StatusPill tone={left.length ? "warn" : "ok"}>
              <span dir="ltr">
                {shown.length - left.length}/{shown.length}
              </span>
            </StatusPill>
          </span>
        }
        icon={Archive}
      >
        <p className="mb-3 text-xs text-muted-foreground">{t("close.sub")}</p>
        <ul className="space-y-1.5">
          {shown.map((r) => {
            const tab = CLOSE_ROW_TAB[r.key]
            const body = (
              <>
                {r.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" /> : <Clock size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{t(`close.row.${r.key}`)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {sentence(r)}
                    {!r.ok && FINANCE_ROWS.has(r.key) && ` ${t("close.waits_finance")}`}
                  </span>
                </span>
                {!r.ok && <StatusPill tone="warn">{t("close.pending")}</StatusPill>}
              </>
            )
            const cls = cn("flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-start text-sm", r.ok ? "border-success/20" : "border-warning/30 bg-warning/5")
            return (
              <li key={r.key}>
                {onOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpen(tab)}
                    className={cn(cls, "transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2")}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            )
          })}
        </ul>
        {!clientMoney && hasClient && <p className="mt-2 text-xs text-muted-foreground">{t("close.money_hidden")}</p>}
        <div className="mt-3 space-y-2">
          {left.length > 0 && <Callout tone="warn">{t("close.left_note", { count: left.length })}</Callout>}
          {openMoney.length > 0 && (
            <div role="note" className="flex gap-2.5 rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm leading-relaxed">
              <Coins size={17} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
              <span>
                {t("close.money_title")}: {openMoney.map((r) => sentence(r)).join(" · ")}
              </span>
            </div>
          )}
          {blocked.length === 0 && (
            <div role="note" className="flex gap-2.5 rounded-xl border border-success/25 bg-success/5 px-3.5 py-3 text-sm leading-relaxed">
              <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              <span>{t("close.all_clear")}</span>
            </div>
          )}
        </div>
        {access.allowed("project.close") && (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant={blocked.length ? "outline" : "default"} onClick={() => setConfirming(true)} disabled={!canClose || blocked.length > 0}>
              <Archive size={16} className="me-1.5" aria-hidden="true" />
              {t("close.button")}
            </Button>
            <span className="text-xs text-muted-foreground">{lifecycle !== "done" ? t("close.not_done") : t("close.archive_hint")}</span>
          </div>
        )}

        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("close.confirm_title")}</DialogTitle>
              <DialogDescription>{t("close.confirm_desc")}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
                {t("cancel")}
              </Button>
              <Button variant="destructive" onClick={() => void close()} disabled={busy}>
                {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
                {t("close.button")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Panel>
      {lessonsPanel}
    </div>
  )
}

function LessonsPanel({ lessons, money, lost }: { lessons: ReturnType<typeof projectLessons>; money: boolean; lost: number | null }) {
  const t = useTranslations("Portal.PM")
  const card = (tone: string, title: string, body: string) => (
    <div className={cn("rounded-xl border px-3.5 py-3 text-sm leading-relaxed", tone)}>
      <p className="font-bold">{title}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
    </div>
  )
  return (
    <Panel title={t("close.lessons.title")} icon={BookOpen}>
      <p className="mb-3 text-xs text-muted-foreground">{t("close.lessons.sub")}</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {money &&
          card(
            "border-destructive/25 bg-destructive/5",
            t("close.lessons.rework", { amount: pmMoney(lessons.rework) }),
            t("close.lessons.rework_note", { count: lessons.ncrs })
          )}
        {money && lost !== null && card("border-warning/25 bg-warning/5", t("close.lessons.lost", { amount: pmMoney(lost) }), t("close.lessons.lost_note"))}
        {card(
          "border-cta/20 bg-cta/5",
          t("close.lessons.obstacles", { count: lessons.obstaclesClosed }),
          lessons.avgResponseDays === null ? t("close.lessons.obstacles_note") : t("close.lessons.obstacles_avg", { count: lessons.avgResponseDays })
        )}
        {card("border-success/25 bg-success/5", t("close.lessons.team", { count: lessons.team }), t("close.lessons.team_note"))}
      </div>
    </Panel>
  )
}
