"use client"

// Inventory's desk for HR's exits (PRD HR EX-03, WF-16 step 2). Custody is
// Inventory's: when an employee leaves, HR asks here and waits — only this
// answer unlocks his settlement. What is missing is valued here and deducted
// in the settlement; nothing about his pay is shown.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Loader2, PackageCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ModuleHeader } from "@/components/module-ui/ModuleHeader"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import { HR_EXITS } from "@/lib/hr/collections"
import { clearCustody, type HrExit } from "@/lib/hr/exit-writes"
import { empNo, hrDate, hrMoney } from "@/lib/hr/format"
import { HrWriteError } from "@/lib/hr/write-guard"

export function HrCustodyDesk() {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { can, profile } = usePermissions()
  const { toast } = useToast()
  const allowed = can("warehouses.manage") || can("warehouses.receive")
  const orgId = ((profile?.organizationId as string) || user?.uid) ?? null
  const q = useMemoFirebase(() => (firestore && orgId && allowed ? query(collection(firestore, HR_EXITS), where("organizationId", "==", orgId)) : null), [firestore, orgId, allowed])
  const { data, isLoading } = useCollection(q)
  const exits = ((data ?? []) as unknown as HrExit[]).sort((a, b) => a.lastDay.localeCompare(b.lastDay))
  const waiting = exits.filter((x) => x.custody?.state === "requested")
  const done = exits.filter((x) => x.custody?.state === "cleared").slice(-10).reverse()
  const [open, setOpen] = useState<HrExit | null>(null)
  const [shortfall, setShortfall] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!firestore || !open) return
    setBusy(true)
    try {
      await clearCustody(firestore, { uid: user?.uid ?? "", name: (profile?.name as string) || null, allowed }, open.id, { shortfall: shortfall ? Number(shortfall) : null, note })
      toast({ title: t("custody.cleared_ok") })
      setOpen(null)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `exit.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <ModuleHeader icon={PackageCheck} title={t("custody.title")} description={t("custody.desc")} />
      {!allowed ? (
        <p className="text-sm text-muted-foreground">{t("custody.no_permission")}</p>
      ) : isLoading ? (
        <div className="flex justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : (
        <>
          <Panel title={t("custody.waiting")} icon={PackageCheck} count={waiting.length || undefined}>
            {waiting.length === 0 ? (
              <p className="py-3 text-center text-sm text-muted-foreground">{t("custody.none")}</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {waiting.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="text-sm font-bold">
                        <span dir="ltr">{empNo(x.no)}</span> · <span dir="auto">{x.employeeName}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{t("custody.line", { last: hrDate(x.lastDay, locale), asked: hrDate(x.custody.requestedAt, locale) })}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        setShortfall("")
                        setNote("")
                        setOpen(x)
                      }}
                    >
                      {t("custody.clear")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {done.length > 0 && (
            <Panel title={t("custody.done")} count={done.length}>
              <ul className="divide-y">
                {done.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span dir="auto">
                      {empNo(x.no)} · {x.employeeName}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      {(x.custody.shortfall ?? 0) > 0 && <StatusPill tone="warn">{t("custody.short", { amount: hrMoney(x.custody.shortfall) })}</StatusPill>}
                      {x.custody.byName} · {hrDate(x.custody.at, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("custody.clear")}</DialogTitle>
            <DialogDescription>{open ? `${empNo(open.no)} · ${open.employeeName}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="cu-short">{t("custody.shortfall")}</Label>
              <Input id="cu-short" type="number" min="0" step="any" dir="ltr" value={shortfall} onChange={(e) => setShortfall(e.target.value)} disabled={busy} />
              <p className="text-[11px] text-muted-foreground">{t("custody.shortfall_note")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cu-note">{t("req.note")}</Label>
              <Textarea id="cu-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("custody.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
