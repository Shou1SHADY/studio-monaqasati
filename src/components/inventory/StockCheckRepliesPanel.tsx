"use client"

// Inventory's side of «قبل الشراء» for the team's «طلب مواد» (Procurement 2.0, INC-07, WF-04): Procurement asks the stores about every
// material of a request before buying it. Each line is answered once — the stores issue it, issue part, hold it for another purpose,
// or have none — and what they issue is not bought. A line unanswered when its window ends is bought in full; a late answer is
// refused. (A project's request is answered in the panel above, which tells Procurement too.)

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { ClipboardList, Loader2, PackageCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { beforeError } from "@/components/procurement/BeforeBuying"
import { fmtDay } from "@/components/procurement/need-bits"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useIncomingDocs } from "@/hooks/useIncomingDocs"
import { useReplyClock } from "@/hooks/useReplyClock"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import { incomingAct } from "@/lib/procurement/incoming-client"
import { stockQuestions, STOCK_KINDS, type StockKind, type WaitingLine } from "@/lib/procurement/stock-check"
import { cn } from "@/lib/utils"

const qty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-US")

export function StockCheckRepliesPanel({ hideWhenEmpty = false }: { hideWhenEmpty?: boolean }) {
  const t = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const { user } = useUser()
  const { can, profile } = usePermissions()
  const allowed = can("warehouses.manage") || can("warehouses.receive")
  const orgId = ((profile?.organizationId as string) || user?.uid) ?? null
  const { docs, loading } = useIncomingDocs(allowed ? orgId : null)
  const clock = useReplyClock(allowed ? orgId : null)
  const rows = useMemo(() => stockQuestions(docs, clock), [docs, clock])
  const [open, setOpen] = useState<WaitingLine | null>(null)
  if (!allowed || (hideWhenEmpty && !loading && rows.length === 0)) return null
  return (
    <Panel title={t("before_inv_title")} icon={ClipboardList} count={rows.length || undefined}>
      <p className="mb-3 text-xs text-muted-foreground">{t("before_inv_desc")}</p>
      {loading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="animate-spin text-muted-foreground" size={24} aria-hidden="true" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={PackageCheck} title={t("before_inv_none")} />
      ) : (
        <ul className="divide-y rounded-xl border">
          {rows.map((r) => (
            <li key={`${r.mrKey}#${r.line}`} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1 basis-64 space-y-0.5">
                <p className="text-sm font-bold">
                  <span dir="auto">{r.name}</span>{" "}
                  <span className="tabular-nums" dir="ltr">
                    {qty(r.qty)} {r.unit}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground" dir="auto">
                  {r.no}
                </p>
              </div>
              <StatusPill tone="warn">{t("before_inv_until", { date: fmtDay(r.until, locale) })}</StatusPill>
              <Button size="sm" className="h-8" onClick={() => setOpen(r)}>
                {t("before_inv_reply")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {open && orgId && <ReplyDialog key={`${open.mrKey}#${open.line}`} orgId={orgId} row={open} onClose={() => setOpen(null)} />}
    </Panel>
  )
}

function ReplyDialog({ orgId, row, onClose }: { orgId: string; row: WaitingLine; onClose: () => void }) {
  const t = useTranslations("Portal.Procurement")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [kind, setKind] = useState<StockKind>("issue")
  const [warehouseId, setWarehouseId] = useState<string | null>(null)
  const [give, setGive] = useState("")
  const [why, setWhy] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const whQ = useMemoFirebase(() => (firestore ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: whData } = useCollection(whQ)
  const mains = ((whData || []) as Array<{ id: string; name?: string; projectId?: string | null; isOutbound?: boolean }>).filter((w) => !w.projectId && !w.isOutbound)

  const giving = kind === "issue" || kind === "part"
  const amount = kind === "part" ? parseFloat(give) : kind === "issue" ? row.qty : 0
  const ready = (kind !== "part" || (amount > 0 && amount < row.qty)) && (!giving || Boolean(warehouseId)) && (kind !== "tied" || why.trim().length >= 2)

  const send = async () => {
    setBusy(true)
    setError(null)
    const res = await incomingAct({ action: "stock-reply", mrKey: row.mrKey, line: row.line, kind, give: kind === "part" ? amount : null, warehouseId: giving ? warehouseId : null, why: why.trim() || null })
    setBusy(false)
    if (!res.ok) {
      setError(beforeError(t, res.reason))
      return
    }
    toast({ title: t("before_inv_saved", { material: row.name }) })
    onClose()
  }

  const chip = (on: boolean) =>
    cn(
      "min-h-9 rounded-full border px-3 py-1 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
      on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
    )

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("before_inv_dialog")}</DialogTitle>
          <DialogDescription>
            <span dir="auto">{row.name}</span> ·{" "}
            <span dir="ltr">
              {qty(row.qty)} {row.unit}
            </span>{" "}
            · <span dir="auto">{row.no}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("before_inv_dialog")}>
            {STOCK_KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} className={chip(kind === k)} onClick={() => setKind(k)} disabled={busy}>
                {t(`before_inv_kind_${k}`)}
              </button>
            ))}
          </div>
          {giving && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("before_inv_from")}</p>
              {mains.length ? (
                <div className="flex flex-wrap gap-2" role="group" aria-label={t("before_inv_from")}>
                  {mains.map((w) => (
                    <button key={w.id} type="button" aria-pressed={warehouseId === w.id} className={chip(warehouseId === w.id)} onClick={() => setWarehouseId(w.id)} disabled={busy} dir="auto">
                      {w.name || w.id}
                    </button>
                  ))}
                </div>
              ) : (
                <Callout tone="warn">{t("before_inv_no_wh")}</Callout>
              )}
            </div>
          )}
          {kind === "part" && (
            <div className="space-y-1.5">
              <Label htmlFor="inv-give">{t("before_inv_give", { qty: qty(row.qty), unit: row.unit })}</Label>
              <Input id="inv-give" type="number" min="0" step="any" dir="ltr" value={give} onChange={(e) => setGive(e.target.value)} disabled={busy} />
            </div>
          )}
          {kind !== "issue" && (
            <div className="space-y-1.5">
              <Label htmlFor="inv-why">{kind === "tied" ? t("before_inv_why_tied") : t("before_inv_why")}</Label>
              <Input id="inv-why" value={why} onChange={(e) => setWhy(e.target.value)} disabled={busy} dir="auto" maxLength={300} />
            </div>
          )}
          {error && <Callout tone="warn">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("before_cancel")}
          </Button>
          <Button onClick={() => void send()} disabled={busy || !ready}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("before_inv_send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
