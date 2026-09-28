"use client"

// Inventory's reply on PM material requests (prototype: "Procurement asks the
// store; it replies with one of three — we read the reply, never make it").
// Each approved line not yet on an order is answered once: issued in full from
// a main store, partly (the rest is bought), or not at all with the reason.
// Only `lines[i].inv` is written; the project reads it on its request.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { ClipboardList, Loader2, PackageCheck } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useOrgPmSupply } from "@/hooks/useOrgPmSupply"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import { INV_WHY, issuedQty, onHandOf, replyBlocks, replyRows, type InvWhy, type ReplyKind, type ReplyRow, type StockRow } from "@/lib/inventory/project-supply"
import { InvDeskError, replyOnRequestLine } from "@/lib/inventory/project-supply-writes"
import { pmDate } from "@/lib/pm/format"
import { reqNo } from "@/lib/pm/supply"
import { cn } from "@/lib/utils"

const CLIP = 8
const qty = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 3 })
const KINDS: ReplyKind[] = ["issue", "part", "none"]

export function PmRequestRepliesPanel() {
  const t = useTranslations("Portal.InvPm")
  const locale = useLocale()
  const { user } = useUser()
  const { can, profile } = usePermissions()
  const allowed = can("warehouses.manage") || can("warehouses.receive")
  const orgId = ((profile?.organizationId as string) || user?.uid) ?? null
  const { loading, projects, requests } = useOrgPmSupply(allowed ? orgId : null, { requests: true })
  const rows = useMemo(() => replyRows(projects, requests), [projects, requests])
  const [open, setOpen] = useState<{ row: ReplyRow; kind: ReplyKind } | null>(null)
  const [all, setAll] = useState(false)

  if (!allowed) return null
  const shown = all ? rows : rows.slice(0, CLIP)

  return (
    <Panel title={t("rep.title")} icon={ClipboardList} count={rows.length || undefined}>
      <p className="mb-3 text-xs text-muted-foreground">{t("rep.desc")}</p>
      {loading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="animate-spin text-muted-foreground" size={24} aria-hidden="true" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={PackageCheck} title={t("rep.none")} />
      ) : (
        <>
          <ul className="divide-y rounded-xl border">
            {shown.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1 basis-64 space-y-0.5">
                  <p className="text-sm font-bold">
                    <span dir="auto">{r.line.name}</span>{" "}
                    <span className="tabular-nums" dir="ltr">
                      {qty(r.owed)} {r.line.unit}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <Link href={`/contractor/projects/${r.projectId}?tab=pmReq`} className="rounded-sm font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" dir="auto">
                      {r.projectName || r.projectNo || "—"}
                    </Link>{" "}
                    · {r.seq ? t("rep.req_no", { no: reqNo(r.seq) }) : "—"}
                    {r.line.code && (
                      <>
                        {" "}
                        · <span dir="ltr">{r.line.code}</span>
                      </>
                    )}{" "}
                    · {r.requestedBy || "—"}
                  </p>
                </div>
                {r.needBy && <StatusPill tone="info">{t("rep.need_by", { date: pmDate(r.needBy, locale) })}</StatusPill>}
                <div className="flex flex-wrap gap-1.5">
                  {KINDS.map((k) => (
                    <Button key={k} size="sm" variant={k === "issue" ? "default" : "outline"} className="h-8" onClick={() => setOpen({ row: r, kind: k })}>
                      {t(`rep.kind.${k}`)}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {rows.length > CLIP && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => setAll((v) => !v)}>
              {all ? t("show_less") : t("show_more", { count: rows.length - CLIP })}
            </Button>
          )}
        </>
      )}
      {open && orgId && <ReplyDialog key={open.row.key} orgId={orgId} row={open.row} initialKind={open.kind} allowed={allowed} onClose={() => setOpen(null)} />}
    </Panel>
  )
}

function ReplyDialog({ orgId, row, initialKind, allowed, onClose }: { orgId: string; row: ReplyRow; initialKind: ReplyKind; allowed: boolean; onClose: () => void }) {
  const t = useTranslations("Portal.InvPm")
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile } = usePermissions()
  const { toast } = useToast()
  const [kind, setKind] = useState<ReplyKind>(initialKind)
  const [warehouseId, setWarehouseId] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [why, setWhy] = useState<InvWhy | null>(null)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const whQ = useMemoFirebase(() => (firestore ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: whData } = useCollection(whQ)
  const mains = ((whData || []) as Array<{ id: string; name?: string; projectId?: string | null; isOutbound?: boolean }>).filter((w) => !w.projectId && !w.isOutbound)
  const itemsQ = useMemoFirebase(() => (firestore && warehouseId ? collection(firestore, "warehouses", warehouseId, "inventoryItems") : null), [firestore, warehouseId])
  const { data: itemsData, isLoading: itemsLoading } = useCollection(itemsQ)
  const onHand = warehouseId && !itemsLoading ? onHandOf((itemsData || []) as StockRow[], row.line.name, row.line.unit) ?? 0 : null

  const qn = kind === "part" ? parseFloat(q) : 0
  const gave = issuedQty(kind, qn, row.owed)
  const blocks = replyBlocks({ allowed, archived: false, request: { pm: true, status: "approved", withdrawn: false, poId: null }, line: row.line, kind, q: qn, why, warehouseId, onHand })

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      await replyOnRequestLine(firestore, { uid: user?.uid ?? "", name: (profile?.name as string) || user?.displayName || "", allowed }, {
        projectId: row.projectId,
        requestId: row.requestId,
        index: row.index,
        kind,
        q: qn,
        why: kind === "issue" ? null : why,
        whyText: kind === "issue" || !why ? null : t(`rep.why.${why}`),
        warehouseId: gave > 0 ? warehouseId : null,
        warehouseName: gave > 0 ? mains.find((w) => w.id === warehouseId)?.name ?? null : null,
        onHand,
        note: note || null,
      })
      toast({ title: t(`rep.saved.${kind}`, { material: row.line.name }) })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: err instanceof InvDeskError && err.blocks[0] ? t(`rep.block.${err.blocks[0]}`) : t("err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const chip = (on: boolean) =>
    cn(
      "min-h-9 rounded-full border px-3 py-1 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
      on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
    )
  const shownBlocks = blocks.filter((b) => b === "over_stock" || (b === "bad_qty" && q !== ""))

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("rep.dialog_title")}</DialogTitle>
          <DialogDescription>
            <span dir="auto">{row.line.name}</span> ·{" "}
            <span dir="ltr">
              {qty(row.owed)} {row.line.unit}
            </span>{" "}
            · <span dir="auto">{row.projectName}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("rep.kind_label")}>
            {KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} className={chip(kind === k)} onClick={() => setKind(k)} disabled={busy}>
                {t(`rep.kind.${k}`)}
              </button>
            ))}
          </div>

          {kind !== "none" && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{t("rep.from_wh")}</p>
              {mains.length ? (
                <div className="flex flex-wrap gap-2" role="group" aria-label={t("rep.from_wh")}>
                  {mains.map((w) => (
                    <button key={w.id} type="button" aria-pressed={warehouseId === w.id} className={chip(warehouseId === w.id)} onClick={() => setWarehouseId(w.id)} disabled={busy} dir="auto">
                      {w.name || w.id}
                    </button>
                  ))}
                </div>
              ) : (
                <Callout tone="warn">{t("rep.no_wh")}</Callout>
              )}
              {warehouseId && (
                <p className="text-xs text-muted-foreground">
                  {onHand === null ? t("rep.on_hand_loading") : t("rep.on_hand", { q: qty(onHand), unit: row.line.unit })}
                </p>
              )}
            </div>
          )}

          {kind === "part" && (
            <div className="space-y-1.5">
              <Label htmlFor="inv-rep-q">{t("rep.q_label", { owed: qty(row.owed), unit: row.line.unit })}</Label>
              <Input id="inv-rep-q" type="number" min="0" step="any" dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} disabled={busy} />
              {gave > 0 && gave < row.owed && <p className="text-xs text-muted-foreground">{t("rep.kept", { q: qty(row.owed - gave), unit: row.line.unit })}</p>}
            </div>
          )}

          {kind !== "issue" && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium">{kind === "part" ? t("rep.why_part") : t("rep.why_none")}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={t("rep.why_none")}>
                {INV_WHY.map((w) => (
                  <button key={w} type="button" aria-pressed={why === w} className={chip(why === w)} onClick={() => setWhy(w)} disabled={busy}>
                    {t(`rep.why.${w}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="inv-rep-note">{t("rep.note")}</Label>
            <Textarea id="inv-rep-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>

          {shownBlocks.map((b) => (
            <Callout key={b} tone="warn">
              {t(`rep.block.${b}`)}
            </Callout>
          ))}
          <p className="text-[11px] text-muted-foreground">{t("rep.foot")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("rep.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
