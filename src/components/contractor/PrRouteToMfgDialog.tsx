"use client"

// Procurement routes a project need to make (D4, T1 —
// procurement.make_request.created). Projects ask Procurement; Procurement
// decides what is made in the workshop and sends it as a manufacturing
// request carrying the purchase request, the PM's request and the cost item.
// Manufacturing answers — make, partly, or decline with a reason — and the
// answer is read back on the purchase request.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { AlertTriangle, CheckCircle2, Factory, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { cn, sanitizeDecimalInput } from "@/lib/utils"
import { itemKey, type MfgProduct, type MfgSettings } from "@/lib/manufacturing-engine"
import { routeNeedToManufacturing, type Actor } from "@/lib/manufacturing-writes"
import { emitMfgEvent, mfgLinks } from "@/lib/mfg-events"
import { purchaseRequestRef } from "@/lib/mfg-outside"
import { RecordedAsLine, errText } from "@/components/inventory/MfgOutsideBits"

export interface RoutablePurchaseRequest {
  id: string
  title: string
  items: Array<{ name: string; quantity: string; unit: string }>
  notes?: string | null
}

type Line = { include: boolean; productId: string; quantity: string }

/** The card a PM's line most likely means: same name, else one name inside the other. */
function matchProduct(name: string, products: MfgProduct[]): string {
  const k = itemKey(name)
  if (!k) return ""
  const exact = products.find((p) => itemKey(p.name) === k)
  if (exact) return exact.id
  const near = products.find((p) => itemKey(p.name).includes(k) || k.includes(itemKey(p.name)))
  return near?.id || ""
}

export function PrRouteToMfgDialog({
  request,
  projectId,
  projectName,
  orgId,
  actor,
  products,
  settings,
  onClose,
}: {
  request: RoutablePurchaseRequest | null
  projectId: string
  projectName: string
  orgId: string
  actor: Actor
  products: MfgProduct[]
  settings: MfgSettings
  onClose: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { toast } = useToast()
  const cards = useMemo(() => products.filter((p) => !p.archived), [products])
  const productById = useMemo(() => new Map(cards.map((p) => [p.id, p])), [cards])
  const [lines, setLines] = useState<Line[]>([])
  const [neededBy, setNeededBy] = useState("")
  const [costItem, setCostItem] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!request) return
    setLines(
      request.items.map((it) => {
        const productId = matchProduct(it.name, cards)
        return { include: !!productId, productId, quantity: String(Number(it.quantity) || "") }
      })
    )
    setNeededBy("")
    setCostItem("")
    setNote(request.notes || "")
    setError(null)
  }, [request?.id]) // a new request opens fresh; the card list updating live keeps the draft

  if (!request) return null
  const ref = purchaseRequestRef(request.id)
  const chosen = lines
    .map((l, i) => ({ l, item: request.items[i], product: productById.get(l.productId) || null }))
    .filter((x) => x.l.include && x.product && Number(x.l.quantity) > 0)

  const patch = (i: number, p: Partial<Line>) => {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...p } : l)))
    setError(null)
  }

  const submit = async () => {
    if (!firestore || busy) return
    if (!chosen.length) {
      setError(t("mfx_err_lines_required"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const id = await routeNeedToManufacturing(firestore, {
        organizationId: orgId,
        projectId,
        projectName,
        purchaseRequestRef: ref,
        pmRequestRef: request.title || null,
        costItemName: costItem.trim() || null,
        neededBy: neededBy || null,
        lines: chosen.map((x) => ({ productId: x.product!.id, itemName: x.product!.name, unit: x.product!.unit, quantity: Number(x.l.quantity) })),
        note: note.trim() || null,
        actor,
      })
      // The link on the purchase request is a convenience: the status is also
      // found by the reference the request carries.
      try {
        await updateDoc(doc(firestore, "projects", projectId, "purchaseRequests", request.id), {
          mfgRequestId: id,
          mfgRoutedAt: new Date().toISOString(),
          mfgRoutedByName: actor.name,
          updatedAt: serverTimestamp(),
        })
      } catch (err) {
        console.warn("purchase request link not saved:", err)
      }
      // mfg.request.new — the workshop manager answers within the window (NT-01).
      await emitMfgEvent(firestore, {
        kind: "request_new",
        copy: t,
        organizationId: orgId,
        actor,
        to: [{ permission: "manufacturing.manage" }],
        params: {
          requestId: id,
          module: "@mfg4_module_projects",
          lines: `${chosen.map((x) => `${x.l.quantity} ${x.product!.unit} ${x.product!.name}`).join(" · ")} — ${projectName}`,
          needBy: neededBy || "—",
        },
        link: mfgLinks.request(id),
      })
      toast({ title: t("mfx_route_done", { ref }) })
      onClose()
    } catch (err) {
      console.error(err)
      setError(errText(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Factory size={18} className="text-cta" aria-hidden="true" />
            {t("mfx_route_title")}
          </DialogTitle>
          <DialogDescription>{t("mfx_route_desc", { hours: settings.answerWindowHours })}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <dl className="overflow-hidden rounded-xl border bg-white text-xs">
            <div className="flex gap-3 border-b border-border/60 px-3.5 py-2">
              <dt className="w-28 shrink-0 text-muted-foreground">{t("mfx_route_pr")}</dt>
              <dd className="font-semibold text-foreground">
                <span className="font-mono" dir="ltr">{ref}</span> · <span dir="auto">{request.title}</span>
              </dd>
            </div>
            <div className="flex gap-3 px-3.5 py-2">
              <dt className="w-28 shrink-0 text-muted-foreground">{t("mfx_route_project")}</dt>
              <dd className="font-semibold text-foreground" dir="auto">{projectName}</dd>
            </div>
          </dl>

          <div className="space-y-2">
            <Label>{t("mfx_route_lines")}</Label>
            <ul className="space-y-2">
              {request.items.map((it, i) => {
                const l = lines[i] || { include: false, productId: "", quantity: "" }
                const product = productById.get(l.productId) || null
                const unitDiffers = !!product && !!it.unit && itemKey(it.unit) !== itemKey(product.unit)
                return (
                  <li key={i} className={cn("space-y-2 rounded-xl border bg-white p-3", !l.include && "bg-muted/30")}>
                    <div className="flex items-center gap-2">
                      <Checkbox id={`mfx-route-line-${i}`} checked={l.include} onCheckedChange={(v) => patch(i, { include: v === true })} />
                      <label htmlFor={`mfx-route-line-${i}`} className="min-w-0 flex-1 cursor-pointer text-sm font-bold text-foreground" dir="auto">
                        {it.name}
                      </label>
                      <span className="text-xs text-muted-foreground" dir="ltr">
                        {it.quantity} {it.unit}
                      </span>
                    </div>
                    {l.include && (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_9rem]">
                        <Select value={l.productId || undefined} onValueChange={(v) => patch(i, { productId: v })}>
                          <SelectTrigger className="h-10 text-xs" aria-label={t("mfx_route_product_for", { item: it.name })}>
                            <SelectValue placeholder={t("mfx_route_pick_product")} />
                          </SelectTrigger>
                          <SelectContent>
                            {cards.map((p) => (
                              <SelectItem key={p.id} value={p.id} className="text-xs">
                                {p.name} — {p.unit}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="relative">
                          <Input
                            inputMode="decimal"
                            dir="ltr"
                            className="h-10 pe-12"
                            value={l.quantity}
                            aria-label={t("mfx_route_qty_for", { item: it.name })}
                            onChange={(e) => patch(i, { quantity: sanitizeDecimalInput(e.target.value) })}
                          />
                          {product && <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-[11px] text-muted-foreground">{product.unit}</span>}
                        </div>
                      </div>
                    )}
                    {l.include && unitDiffers && <p className="text-[11px] text-warning">{t("mfx_route_unit_differs", { unit: product!.unit, requested: it.unit })}</p>}
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mfx-route-need">{t("mfx_route_needed_by")}</Label>
              <Input id="mfx-route-need" type="date" dir="ltr" className="h-10" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mfx-route-cost">{t("mfx_route_cost_item")}</Label>
              <Input id="mfx-route-cost" className="h-10" value={costItem} onChange={(e) => setCostItem(e.target.value)} placeholder={t("mfx_route_cost_item_placeholder")} disabled={busy} dir="auto" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mfx-route-note">{t("mfx_route_note")}</Label>
            <Textarea id="mfx-route-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
          </div>

          <ul className="space-y-1 rounded-xl border bg-white px-3.5 py-2.5 text-xs text-slate-700">
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {t("mfx_route_effect_request")}
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              {t("mfx_route_effect_window", { hours: settings.answerWindowHours })}
            </li>
          </ul>

          <RecordedAsLine name={actor.name} />
        </div>

        <DialogFooter className="flex-wrap items-center gap-2">
          {error && (
            <span className="me-auto flex items-center gap-1.5 text-[11px] font-semibold text-destructive">
              <AlertTriangle size={13} aria-hidden="true" /> {error}
            </span>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("crm_cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !chosen.length} className="gap-2">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Factory size={15} />}
            {t("mfx_route_btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
