"use client"

// Manufacturing requests — demand from Sales, a project, or Procurement.
// Each is screened on arrival (make-or-buy verdict per line) and the answer
// routes it: work orders, a cost estimate, or back to the buyer — never
// silence. An unanswered request visibly ages.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Inbox, Clock, Loader2, Plus, Factory, Calculator, ShoppingCart, FolderKanban, HandCoins } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { cn } from "@/lib/utils"
import type { MfgData } from "@/hooks/useMfgData"
import type { ManufacturingRequest, MfgRequestLine } from "@/lib/sales-orders"
import { acceptManufacturingRequest, rejectManufacturingRequest } from "@/lib/sales-order-writes"
import { daysFrom, verdict, type MfgProduct, type Verdict } from "@/lib/manufacturing-engine"
import { answerMfgRequestV2, createMfgRequestV2 } from "@/lib/manufacturing-writes"

const fmtQty = (n: number) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })
const fmtMoney = (n: number) => Number(Math.round(n) || 0).toLocaleString("en-US")
const today = () => new Date().toISOString().slice(0, 10)

function requestLines(r: ManufacturingRequest): MfgRequestLine[] {
  if (r.lines?.length) return r.lines
  return [{ productId: null, itemName: r.itemName, unit: r.unit, quantity: r.quantity }]
}

function productForLine(data: MfgData, line: MfgRequestLine): MfgProduct | null {
  if (line.productId) return data.productById.get(line.productId) || null
  const byName = data.products.find((p) => p.name.trim() === line.itemName.trim())
  return byName || null
}

function ageHours(r: ManufacturingRequest): number {
  if (!r.requestedAt) return 0
  return Math.max(0, (Date.now() - new Date(r.requestedAt).getTime()) / 3600000)
}

export function MfgRequestsView({ data }: { data: MfgData }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const { can } = usePermissions()
  const [segment, setSegment] = useState<"new" | "answered" | "all">("new")
  const [answering, setAnswering] = useState<ManufacturingRequest | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const list = useMemo(
    () =>
      data.requests.filter((r) =>
        segment === "new" ? r.status === "new" : segment === "answered" ? r.status !== "new" : true
      ),
    [data.requests, segment]
  )
  const canRequest = can("projects.edit") || can("sales.manage") || data.canManage

  return (
    <div className="space-y-4" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl bg-muted p-0.5 gap-0.5">
          {(["new", "answered", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSegment(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-colors",
                segment === s ? "bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t(`mfg2_req_seg_${s}`)}
              <span className="ms-1.5 tabular-nums text-[10px] text-muted-foreground">
                {s === "new"
                  ? data.requests.filter((r) => r.status === "new").length
                  : s === "answered"
                    ? data.requests.filter((r) => r.status !== "new").length
                    : data.requests.length}
              </span>
            </button>
          ))}
        </div>
        {canRequest && (
          <Button size="sm" className="ms-auto gap-1.5" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> {t("mfg2_new_request")}
          </Button>
        )}
      </div>

      {segment === "new" && (
        <p className="text-xs text-muted-foreground border rounded-xl bg-cta/5 border-cta/20 px-4 py-2.5">
          {t("mfg2_req_window_note", { hours: data.settings.answerWindowHours })}
        </p>
      )}

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground border border-dashed rounded-xl p-8 text-center">{t("mfg2_req_empty")}</p>
      ) : (
        list.map((r) => <RequestCard key={r.id} data={data} request={r} onAnswer={() => setAnswering(r)} />)
      )}

      {answering && <AnswerDialog data={data} request={answering} onClose={() => setAnswering(null)} />}
      {showCreate && <NewRequestDialog data={data} onClose={() => setShowCreate(false)} />}
    </div>
  )
}

function sourceBadge(r: ManufacturingRequest, t: ReturnType<typeof useTranslations>) {
  const kind = r.sourceKind || (r.orderId ? "sales" : "project")
  const map = {
    sales: { icon: HandCoins, cls: "bg-rose-100 text-rose-700", label: t("mfg2_req_src_sales") },
    project: { icon: FolderKanban, cls: "bg-cta/10 text-cta", label: t("mfg2_req_src_project") },
    procurement: { icon: ShoppingCart, cls: "bg-teal-100 text-teal-700", label: t("mfg2_req_src_procurement") },
  }[kind]
  const Icon = map.icon
  return (
    <Badge className={cn("border-none gap-1 text-[10px]", map.cls)}>
      <Icon size={10} /> {map.label}
    </Badge>
  )
}

function verdictBadge(v: Verdict, t: ReturnType<typeof useTranslations>) {
  const map = {
    make: { cls: "bg-success/10 text-success", label: t("mfg2_verdict_make") },
    partial: { cls: "bg-amber-100 text-amber-700", label: t("mfg2_verdict_partial", { count: fmtQty(v.makeQty) }) },
    buy_price: { cls: "bg-amber-100 text-amber-700", label: t("mfg2_verdict_buy_price") },
    buy_capacity: { cls: "bg-destructive/10 text-destructive", label: t("mfg2_verdict_buy_capacity") },
  }[v.kind]
  return <Badge className={cn("border-none text-[10px]", map.cls)}>{map.label}</Badge>
}

function RequestCard({ data, request: r, onAnswer }: { data: MfgData; request: ManufacturingRequest; onAnswer: () => void }) {
  const t = useTranslations("Portal.Shared")
  const lines = requestLines(r)
  const hours = ageHours(r)
  const overdue = r.status === "new" && hours >= data.settings.answerWindowHours
  const neededDays = r.neededBy ? daysFrom(today(), r.neededBy) : 14

  return (
    <section className="rounded-xl border bg-white overflow-hidden">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3 border-b bg-muted/20">
        <Inbox size={15} className="text-cta shrink-0" />
        <b className="text-sm">{r.requestNumber}</b>
        {sourceBadge(r, t)}
        <span className="text-xs text-muted-foreground truncate">
          {r.projectName || r.contactName || (r.orderNumber ? `#${r.orderNumber}` : "")} · {r.createdByUserName}
          {r.neededBy && <> · {t("mfg2_needed_by")}: {r.neededBy}</>}
        </span>
        <span className="ms-auto flex items-center gap-2">
          {r.status === "new" ? (
            <Badge className={cn("border-none gap-1", overdue ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-700")}>
              <Clock size={10} />
              {overdue ? t("mfg2_req_overdue", { hours: Math.round(hours) }) : t("mfg2_req_awaiting")}
            </Badge>
          ) : (
            <Badge
              className={cn(
                "border-none",
                r.status === "accepted" || r.status === "partial"
                  ? "bg-success/10 text-success"
                  : r.status === "estimated"
                    ? "bg-violet-100 text-violet-700"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {t(`mfg2_req_state_${r.status}`)}
            </Badge>
          )}
          {r.status === "new" && data.canManage && (
            <Button size="sm" className="h-7 text-[11px]" onClick={onAnswer}>
              {t("mfg2_req_answer")}
            </Button>
          )}
        </span>
      </header>
      <div className="divide-y">
        {lines.map((line, i) => {
          const product = productForLine(data, line)
          const v = product ? verdict(product, line.quantity, Math.max(0, neededDays), data.scheduleInputs, data.departments, data.settings) : null
          return (
            <div key={i} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs">
              <span className="font-semibold">{line.itemName}</span>
              <span className="tabular-nums text-muted-foreground">
                {fmtQty(line.quantity)} {line.unit}
              </span>
              {r.status === "new" && (
                <span className="ms-auto flex items-center gap-2">
                  {v ? (
                    <>
                      {data.seesMoney && (
                        <span className="text-muted-foreground tabular-nums">
                          {fmtMoney(v.unitCost)} ﷼ {v.buyPrice != null && <>/ {fmtMoney(v.buyPrice)} ﷼ {t("mfg2_verdict_buy_label")}</>}
                        </span>
                      )}
                      {verdictBadge(v, t)}
                    </>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">{t("mfg2_no_product_card")}</Badge>
                  )}
                </span>
              )}
            </div>
          )
        })}
        {r.status !== "new" && (r.answerNote || r.rejectionReason) && (
          <p className="px-4 py-2.5 text-xs text-muted-foreground">
            {t("mfg2_req_answer_label")}: {r.answerNote || r.rejectionReason} · {r.decidedByUserName}
          </p>
        )}
      </div>
    </section>
  )
}

function AnswerDialog({ data, request: r, onClose }: { data: MfgData; request: ManufacturingRequest; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const lines = requestLines(r)
  const neededDays = r.neededBy ? Math.max(0, daysFrom(today(), r.neededBy)) : 14
  const [route, setRoute] = useState<"make" | "estimate" | "buy">("make")
  const [note, setNote] = useState("")
  const [makeQty, setMakeQty] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {}
    lines.forEach((line, i) => {
      const product = productForLine(data, line)
      const v = product ? verdict(product, line.quantity, neededDays, data.scheduleInputs, data.departments, data.settings) : null
      init[i] = String(v ? v.makeQty : line.quantity)
    })
    return init
  })
  const isLegacySales = !!r.orderId && !r.lines?.length

  const submit = async () => {
    if (!firestore || busy) return
    setBusy(true)
    try {
      if (route === "buy") {
        if (!note.trim()) {
          toast({ title: t("mfg2_err_reason_required"), variant: "destructive" })
          return
        }
        await rejectManufacturingRequest(firestore, { request: r, reason: note.trim(), actor: data.actor })
        toast({ title: t("mfg2_req_returned_toast") })
        onClose()
        return
      }
      if (route === "estimate") {
        const estimateLines = lines
          .map((line) => ({ product: productForLine(data, line), quantity: line.quantity }))
          .filter((l): l is { product: MfgProduct; quantity: number } => !!l.product)
        if (!estimateLines.length) {
          toast({ title: t("mfg2_err_needs_product_card"), variant: "destructive" })
          return
        }
        await answerMfgRequestV2(firestore, {
          request: r,
          route: "estimate",
          estimateLines,
          departments: data.departments,
          settings: data.settings,
          note: note || null,
          actor: data.actor,
        })
        toast({ title: t("mfg2_req_estimated_toast") })
        onClose()
        return
      }
      // make
      if (isLegacySales && !productForLine(data, lines[0])) {
        await acceptManufacturingRequest(firestore, { request: r, actor: data.actor })
        toast({ title: t("mfg_req_accepted_toast") })
        onClose()
        return
      }
      const makeLines = lines.map((line, i) => ({
        line,
        makeQuantity: Number(makeQty[i]) || 0,
        product: productForLine(data, line),
      }))
      if (!makeLines.some((l) => l.makeQuantity > 0)) {
        toast({ title: t("mfg2_err_quantity_required"), variant: "destructive" })
        return
      }
      if (makeLines.some((l) => l.makeQuantity > 0 && !l.product)) {
        toast({ title: t("mfg2_err_needs_product_card"), variant: "destructive" })
        return
      }
      await answerMfgRequestV2(firestore, {
        request: r,
        route: "make",
        makeLines,
        departments: data.departments,
        settings: data.settings,
        note: note || null,
        actor: data.actor,
      })
      toast({ title: t("mfg2_req_accepted_toast") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="text-base">{t("mfg2_req_answer_title", { number: r.requestNumber })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { key: "make", icon: Factory, label: t("mfg2_route_make"), hint: t("mfg2_route_make_hint") },
                ...(data.settings.features.estimates
                  ? [{ key: "estimate", icon: Calculator, label: t("mfg2_route_estimate"), hint: t("mfg2_route_estimate_hint") }]
                  : []),
                { key: "buy", icon: ShoppingCart, label: t("mfg2_route_buy"), hint: t("mfg2_route_buy_hint") },
              ] as Array<{ key: "make" | "estimate" | "buy"; icon: typeof Factory; label: string; hint: string }>
            ).map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => setRoute(o.key)}
                className={cn(
                  "rounded-xl border px-3 py-2.5 text-xs font-bold text-start",
                  route === o.key ? "border-primary bg-primary/5" : "border-border"
                )}
              >
                <o.icon size={13} className="mb-1" />
                {o.label}
                <span className="block font-normal text-muted-foreground mt-0.5">{o.hint}</span>
              </button>
            ))}
          </div>

          {route === "make" && (
            <div className="space-y-2">
              {lines.map((line, i) => {
                const product = productForLine(data, line)
                const v = product ? verdict(product, line.quantity, neededDays, data.scheduleInputs, data.departments, data.settings) : null
                return (
                  <div key={i} className="flex items-center gap-2 text-xs border rounded-xl px-3 py-2">
                    <span className="font-semibold flex-1 truncate">
                      {line.itemName}
                      <span className="text-muted-foreground font-normal"> · {t("mfg2_req_asked", { count: fmtQty(line.quantity), unit: line.unit })}</span>
                      {!product && <span className="block text-amber-600">{t("mfg2_no_product_card")}</span>}
                    </span>
                    {v && verdictBadge(v, t)}
                    <Input
                      type="number"
                      min="0"
                      max={line.quantity}
                      className="h-7 w-20 text-xs"
                      value={makeQty[i] ?? ""}
                      onChange={(e) => setMakeQty((m) => ({ ...m, [i]: e.target.value }))}
                      disabled={!product && !isLegacySales}
                    />
                  </div>
                )
              })}
              <p className="text-[11px] text-muted-foreground">{t("mfg2_req_make_rest_note")}</p>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-xs font-bold">{route === "buy" ? t("mfg2_field_reason") : t("mfg2_field_note_optional")}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={route === "buy" ? t("mfg2_buy_reason_ph") : ""} />
            <p className="text-[11px] text-muted-foreground">{t("mfg2_req_answer_returns_note", { name: r.createdByUserName })}</p>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>{t("crm_cancel")}</Button>
            <Button size="sm" disabled={busy} onClick={submit} className="gap-1.5">
              {busy && <Loader2 size={13} className="animate-spin" />}
              {t("mfg2_confirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NewRequestDialog({ data, onClose }: { data: MfgData; onClose: () => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [projectId, setProjectId] = useState("")
  const [neededBy, setNeededBy] = useState("")
  const [note, setNote] = useState("")
  const [rows, setRows] = useState<Array<{ productId: string; quantity: string }>>([{ productId: "", quantity: "" }])

  const submit = async () => {
    if (!firestore || busy) return
    const lines: MfgRequestLine[] = rows.flatMap((r) => {
      const p = data.productById.get(r.productId)
      const quantity = Number(r.quantity) || 0
      return p && quantity > 0 ? [{ productId: p.id, itemName: p.name, unit: p.unit, quantity }] : []
    })
    if (!lines.length) {
      toast({ title: t("mfg2_err_quantity_required"), variant: "destructive" })
      return
    }
    setBusy(true)
    try {
      const project = data.projects.find((p) => p.id === projectId)
      await createMfgRequestV2(firestore, {
        organizationId: data.orgId,
        sourceKind: "project",
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
        neededBy: neededBy || null,
        lines,
        note: note || null,
        actor: data.actor,
      })
      toast({ title: t("mfg2_request_sent_toast", { hours: data.settings.answerWindowHours }) })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="text-base">{t("mfg2_new_request")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs font-bold">{t("mfg2_field_project")}</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue placeholder={t("mfg2_field_project")} /></SelectTrigger>
                <SelectContent>
                  {data.projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-bold">{t("mfg2_field_needed_by")}</Label>
              <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
            </div>
          </div>
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <Select value={row.productId} onValueChange={(v) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, productId: v } : x)))}>
                  <SelectTrigger><SelectValue placeholder={t("mfg2_field_product")} /></SelectTrigger>
                  <SelectContent>
                    {data.products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                type="number"
                min="0"
                step="any"
                placeholder={t("mfg2_field_quantity")}
                value={row.quantity}
                onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
              />
            </div>
          ))}
          <Button size="sm" variant="outline" className="gap-1 h-7 text-[11px]" onClick={() => setRows((rs) => [...rs, { productId: "", quantity: "" }])}>
            <Plus size={11} /> {t("mfg2_add_line")}
          </Button>
          <div className="space-y-1">
            <Label className="text-xs font-bold">{t("mfg2_field_note_optional")}</Label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>{t("crm_cancel")}</Button>
            <Button size="sm" disabled={busy} onClick={submit} className="gap-1.5">
              {busy && <Loader2 size={13} className="animate-spin" />}
              {t("mfg2_send_request")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
