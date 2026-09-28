"use client"

// Supply › purchase orders on a PM project: the orders Procurement referred
// because they exceed their item's budget (R-25, `pmBudget.state = pending`).
// The project's approver answers — accept the overrun (the order goes on to its
// approver) or send it back to renegotiate the price, with the reason. Nothing
// shows while nothing waits.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Loader2, Scale } from "lucide-react"
import { collection, query, where } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Panel } from "@/components/module-ui/Panel"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { pmDate, pmMoney } from "@/lib/pm/format"
import { displayPoNumber } from "@/lib/procurement/format"
import { decidePmBudget, type BudgetDecision } from "@/lib/procurement/po-extra-writes"
import { PURCHASE_ORDERS } from "@/lib/procurement/types"
import { ProcWriteError } from "@/lib/procurement/writes"

type Referred = { id: string; docNumber: string; supplierName?: string; status?: string; pmBudget?: { state?: string; over?: number | null; askedByName?: string | null; askedAt?: string | null } | null }

export function PmBudgetDecisions({ projectId, orgId, access, actor }: { projectId: string; orgId: string | null; access: PmAccess; actor: { uid: string; name: string | null } }) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const approver = !access.ctx.archived && access.has("approve")
  const money = access.has("money")
  const q = useMemoFirebase(
    () => (firestore && orgId && approver ? query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", orgId), where("projectId", "==", projectId)) : null),
    [firestore, orgId, approver, projectId]
  )
  const { data } = useCollection(q)
  const rows = useMemo(() => ((data ?? []) as unknown as Referred[]).filter((po) => po.status === "awaiting_approval" && po.pmBudget?.state === "pending"), [data])
  const [open, setOpen] = useState<{ po: Referred; decision: BudgetDecision } | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  if (!approver || rows.length === 0) return null

  const decide = async () => {
    if (!firestore || !open) return
    setBusy(true)
    try {
      await decidePmBudget(firestore, { uid: actor.uid, name: actor.name ?? "" }, open.po.id, { decision: open.decision, note })
      toast({ title: t(`budget.done_${open.decision}`, { no: displayPoNumber(open.po.docNumber, locale) }) })
      setOpen(null)
      setNote("")
    } catch (err) {
      console.error(err)
      toast({ title: err instanceof ProcWriteError && err.code === "reason_required" ? t("budget.note_required") : t("error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Panel title={t("budget.title")} icon={Scale} count={rows.length} bodyClassName="p-0">
        <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("budget.sub")}</p>
        <ul className="divide-y">
          {rows.map((po) => (
            <li key={po.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">
                  <span dir="ltr">{displayPoNumber(po.docNumber, locale)}</span>
                  {po.supplierName ? <span className="font-normal text-muted-foreground" dir="auto"> — {po.supplierName}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[money && po.pmBudget?.over ? t("budget.over", { amount: pmMoney(po.pmBudget.over) }) : null, po.pmBudget?.askedByName ? t("budget.asked", { name: po.pmBudget.askedByName, date: po.pmBudget.askedAt ? pmDate(po.pmBudget.askedAt, locale) : "—" }) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpen({ po, decision: "renegotiate" })}>
                  {t("budget.renegotiate")}
                </Button>
                <Button size="sm" className="bg-module text-module-foreground hover:bg-module/90" onClick={() => setOpen({ po, decision: "accepted" })}>
                  {t("budget.accept")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Panel>
      <Dialog open={Boolean(open)} onOpenChange={(o) => !busy && !o && setOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{open ? t(`budget.${open.decision === "accepted" ? "accept" : "renegotiate"}_title`, { no: displayPoNumber(open.po.docNumber, locale) }) : ""}</DialogTitle>
            <DialogDescription>{open?.decision === "accepted" ? t("budget.accept_desc") : t("budget.renegotiate_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="pm-budget-note">
              {t("budget.note")}
              {open?.decision === "renegotiate" && <span className="text-destructive"> *</span>}
            </Label>
            <Textarea id="pm-budget-note" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void decide()} disabled={busy || (open?.decision === "renegotiate" && !note.trim())}>
              {busy && <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" />}
              {open?.decision === "accepted" ? t("budget.accept") : t("budget.renegotiate")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
