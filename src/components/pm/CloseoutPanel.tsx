"use client"

// File › Closeout on a PM 1.0 project (WF-26, ARC-01, CST-04). The closeout
// list — every row must hold — and the one "Close & archive" gate; once
// archived, the final snapshot, frozen and never recomputed. Rows that depend
// on Finance (collection, retention release) wait for Finance and carry no
// button here (WAIT-01).

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Archive, CheckCircle2, CircleAlert, Loader2, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import type { Acceptances } from "@/lib/pm/acceptance"
import { PM_CERTIFICATES } from "@/lib/pm/certificate"
import type { PmCertificate } from "@/lib/pm/certificate-writes"
import { closeBlocks, closeoutRows, type ArchiveSnapshot, type CloseRow } from "@/lib/pm/closeout"
import { closeAndArchive, PmCloseError, type CloseActor } from "@/lib/pm/closeout-writes"
import { pmDate, pmMoney, todayDay } from "@/lib/pm/format"
import { PM_PUNCH, type PunchItem } from "@/lib/pm/punch"
import { cn } from "@/lib/utils"

const MONEY_ROWS = new Set<CloseRow["key"]>(["unbilled", "in_progress", "overdue", "retention"])
const FINANCE_ROWS = new Set<CloseRow["key"]>(["overdue", "retention"])

export function CloseoutPanel({
  projectId,
  lifecycle,
  hasClient,
  pm,
  items,
  access,
  actor,
}: {
  projectId: string
  lifecycle: string
  hasClient: boolean
  pm: { acceptances?: Acceptances; cutPool?: number; retentionHeld?: number; retentionReleased?: boolean; fin?: ArchiveSnapshot | null; closedOn?: string | null; closedByName?: string | null }
  items: Array<{ rate: number; executed: number; billed: number }>
  access: PmAccess
  actor: CloseActor
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const money = access.has("money")

  const punchQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_PUNCH) : null), [firestore, projectId])
  const { data: punch } = useCollection(punchQ)
  const certQ = useMemoFirebase(() => (firestore && money ? collection(firestore, "projects", projectId, PM_CERTIFICATES) : null), [firestore, projectId, money])
  const { data: certs } = useCollection(certQ)

  const rows = useMemo(
    () =>
      closeoutRows({
        hasClient,
        acceptances: pm.acceptances ?? {},
        punch: (punch ?? []) as unknown as PunchItem[],
        items,
        cutPool: pm.cutPool ?? 0,
        certificates: (certs ?? []) as unknown as PmCertificate[],
        retentionHeld: pm.retentionHeld ?? 0,
        retentionReleased: pm.retentionReleased === true,
        today: todayDay(),
      }),
    [hasClient, pm, punch, items, certs]
  )
  const blocked = closeBlocks(rows)
  // Without money the certificates are not read — their rows are not shown rather than shown wrong.
  const shown = money ? rows : rows.filter((r) => !MONEY_ROWS.has(r.key))
  const canClose = access.allowed("project.close") && lifecycle === "done"

  const close = async () => {
    if (!firestore) return
    setBusy(true)
    try {
      await closeAndArchive(firestore, access.ctx, projectId, actor)
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

  if (lifecycle === "closed" && pm.fin) {
    const f = pm.fin
    return (
      <Panel title={t("close.archived_title")} icon={Lock}>
        <Callout tone="info" className="mb-4">
          {t("close.archived_note", { date: pmDate(pm.closedOn, locale), who: pm.closedByName || "—" })}
        </Callout>
        <div className="grid gap-x-6 sm:grid-cols-2">
          {money && <KeyValueRow label={t("close.snap.contract")} value={pmMoney(f.contractValue)} ltr />}
          {money && <KeyValueRow label={t("close.snap.earned")} value={pmMoney(f.earned)} ltr />}
          {money && <KeyValueRow label={t("close.snap.certified")} value={pmMoney(f.certified)} ltr />}
          {money && <KeyValueRow label={t("close.snap.retention")} value={pmMoney(f.retentionHeld)} ltr />}
          <KeyValueRow label={t("close.snap.contract_days")} value={f.contractDays === null ? "—" : t("days", { count: f.contractDays })} />
          <KeyValueRow label={t("close.snap.actual_days")} value={f.actualDays === null ? "—" : t("days", { count: f.actualDays })} />
          <KeyValueRow label={t("close.snap.delay")} value={f.delayDays === null ? "—" : t("days", { count: f.delayDays })} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("close.snap.cost_note")}</p>
      </Panel>
    )
  }

  return (
    <Panel title={t("close.title")} icon={Archive}>
      <ul className="space-y-1.5">
        {shown.map((r) => (
          <li key={r.key} className={cn("flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm", r.ok ? "border-success/20" : "border-destructive/25 bg-destructive/5")}>
            {r.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" /> : <CircleAlert size={16} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />}
            <div className="min-w-0">
              <p className="font-semibold">{t(`close.row.${r.key}`)}</p>
              {!r.ok && (
                <p className="text-xs text-muted-foreground">
                  {r.key === "in_progress" ? t("close.why.in_progress", { count: r.n ?? 0 }) : MONEY_ROWS.has(r.key) ? t(`close.why.${r.key}`, { amount: pmMoney(r.n ?? 0) }) : t(`close.why.${r.key}`, { count: r.n ?? 0 })}
                  {FINANCE_ROWS.has(r.key) && ` ${t("close.waits_finance")}`}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!money && hasClient && <p className="mt-2 text-xs text-muted-foreground">{t("close.money_hidden")}</p>}
      {access.allowed("project.close") && (
        <div className="mt-4 space-y-2">
          {lifecycle !== "done" && <Callout tone="info">{t("close.not_done")}</Callout>}
          <Button variant="destructive" onClick={() => setConfirming(true)} disabled={!canClose || blocked.length > 0}>
            <Archive size={16} className="me-1.5" aria-hidden="true" />
            {t("close.button")}
          </Button>
          {blocked.length > 0 && <p className="text-xs text-muted-foreground">{t("close.blocked", { count: blocked.length })}</p>}
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
  )
}
