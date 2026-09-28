"use client"

// «مرتجعات المشاريع» — Inventory's desk for what PM projects send back to a
// main warehouse (project store move t=ret). The project logged it and waits
// «بانتظار المخزون»; the keeper confirms it arrived, the move closes on the
// project and the quantity lands on the named warehouse's stock in the same act.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, PackageCheck, Undo2 } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { ModuleHeader } from "@/components/module-ui/ModuleHeader"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useFirestore, useUser } from "@/firebase"
import { useOrgPmSupply } from "@/hooks/useOrgPmSupply"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import { doneReturns, pendingReturns, type ReturnRow } from "@/lib/inventory/project-supply"
import { InvDeskError, receiveProjectReturn } from "@/lib/inventory/project-supply-writes"
import { pmDate, todayDay } from "@/lib/pm/format"
import { PmSupplyError } from "@/lib/pm/supply-writes"

const OLD_AFTER_DAYS = 7
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 })

export function ProjectReturnsDesk() {
  const t = useTranslations("Portal.InvPm")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { can, profile, isLoading: permLoading } = usePermissions()
  const { toast } = useToast()
  const allowed = can("warehouses.manage") || can("warehouses.receive")
  const orgId = ((profile?.organizationId as string) || user?.uid) ?? null
  const { loading, projects, stores } = useOrgPmSupply(allowed ? orgId : null, { stores: true })
  const today = todayDay()
  const waiting = useMemo(() => pendingReturns(projects, stores, today), [projects, stores, today])
  const done = useMemo(() => doneReturns(projects, stores, 10), [projects, stores])
  const [open, setOpen] = useState<ReturnRow | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!firestore || !open) return
    setBusy(true)
    try {
      await receiveProjectReturn(firestore, { uid: user?.uid ?? "", name: (profile?.name as string) || user?.displayName || "", allowed }, { projectId: open.projectId, storeId: open.storeId, index: open.index })
      toast({ title: t("ret.done_toast", { q: qty(open.qty), unit: open.unit, material: open.material, warehouse: open.warehouseName || "—" }) })
      setOpen(null)
    } catch (err) {
      console.error(err)
      const block = err instanceof InvDeskError || err instanceof PmSupplyError ? err.blocks[0] : null
      toast({ title: block ? t(`ret.block.${block}`) : t("err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <ModuleHeader icon={Undo2} title={t("ret.title")} description={t("ret.desc")} />
      {permLoading ? null : !allowed ? (
        <p className="text-sm text-muted-foreground">{t("no_permission")}</p>
      ) : loading ? (
        <div className="flex justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : (
        <>
          <Panel title={t("ret.waiting")} icon={Undo2} count={waiting.length || undefined}>
            {waiting.length === 0 ? (
              <EmptyState icon={PackageCheck} title={t("ret.none")} description={t("ret.none_desc")} />
            ) : (
              <ul className="divide-y rounded-xl border">
                {waiting.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1 basis-64 space-y-0.5">
                      <p className="text-sm font-bold">
                        <span dir="auto">{r.material}</span>{" "}
                        <span className="tabular-nums" dir="ltr">
                          {qty(r.qty)} {r.unit}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("ret.from")}{" "}
                        <Link href={`/contractor/projects/${r.projectId}?tab=pmStore`} className="rounded-sm font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
                          {r.projectName || r.projectNo || "—"}
                        </Link>
                        {r.projectNo && (
                          <span className="ms-1" dir="ltr">
                            ({r.projectNo})
                          </span>
                        )}{" "}
                        · {t("ret.to", { warehouse: r.warehouseName || "—" })}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("ret.logged", { name: r.byName || "—", date: pmDate(r.on, locale) })}
                        {r.note && (
                          <span dir="auto">
                            {" "}
                            · {r.note}
                          </span>
                        )}
                      </p>
                    </div>
                    <StatusPill tone={r.age > OLD_AFTER_DAYS ? "warn" : "mute"}>{t("ret.age", { days: r.age })}</StatusPill>
                    <Button size="sm" onClick={() => setOpen(r)} disabled={busy}>
                      {t("ret.confirm")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {done.length > 0 && (
            <Panel title={t("ret.recent")} count={done.length}>
              <ul className="divide-y">
                {done.map((r) => (
                  <li key={r.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      <span dir="auto">{r.material}</span>{" "}
                      <span className="tabular-nums" dir="ltr">
                        {qty(r.qty)} {r.unit}
                      </span>{" "}
                      · <span dir="auto">{r.projectName}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{t("ret.received_by", { name: r.invByName || "—", warehouse: r.warehouseName || "—", date: pmDate(r.invOn, locale) })}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}

      <AlertDialog open={open !== null} onOpenChange={(o) => !o && !busy && setOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("ret.confirm")}</AlertDialogTitle>
            <AlertDialogDescription>
              {open ? t("ret.confirm_desc", { q: qty(open.qty), unit: open.unit, material: open.material, warehouse: open.warehouseName || "—", project: open.projectName || open.projectNo || "—" }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                void confirm()
              }}
            >
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("ret.confirm_btn")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
