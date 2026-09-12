"use client"

// Bridges between the legacy workshop view and the v2 (product-born) model:
// a self-contained v2 order dialog the legacy table can open, and the button
// that starts a work order from a product card.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Layers, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useMfgData } from "@/hooks/useMfgData"
import { possibleForDays, standardCost } from "@/lib/manufacturing-engine"
import { createWorkOrderFromProduct } from "@/lib/manufacturing-writes"
import { MfgOrderV2Dialog } from "./MfgOrderV2Dialog"

const fmtMoney = (n: number) => Number(Math.round(n) || 0).toLocaleString("en-US")

/** Opens the rich v2 dialog for a work order id — loads its own data so the
 * legacy view only needs the id. */
export function MfgOrderV2DialogStandalone({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const data = useMfgData()
  const { can } = usePermissions()
  const order = data.v2Orders.find((o) => o.id === orderId) || null
  if (!order) return null
  return (
    <MfgOrderV2Dialog
      order={order}
      product={data.productById.get(order.productId || "") || null}
      departments={data.departments}
      settings={data.settings}
      notes={data.notesByOrder.get(order.id) || []}
      schedule={data.schedule.get(order.id) || null}
      warehouses={data.warehouses}
      actor={data.actor}
      orgId={data.orgId}
      canManage={data.canManage}
      canWork={data.canWork}
      canQc={data.canQc}
      canCost={data.canCost}
      seesMoney={data.seesMoney}
      canReceive={can("warehouses.receive") || can("warehouses.manage")}
      onClose={onClose}
    />
  )
}

/** "New order from a product card" — the card brings its route, BOM and
 * standard time; the form only asks what the card cannot know. */
export function MfgNewOrderFromProductButton() {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const data = useMfgData()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [productId, setProductId] = useState("")
  const [quantity, setQuantity] = useState("")
  const [neededBy, setNeededBy] = useState("")
  const [sourceKind, setSourceKind] = useState<"project" | "quotation" | "stock">("project")
  const [projectId, setProjectId] = useState("")
  const [contactName, setContactName] = useState("")
  const [quotationNumber, setQuotationNumber] = useState("")

  if (!data.canManage && !data.canCost) return null
  if (!data.products.length) return null

  const product = data.productById.get(productId)
  const qty = Number(quantity) || 0
  const std = product && qty > 0 ? standardCost(product, data.departments, data.settings, qty) : null
  const possible =
    product && qty > 0 && data.settings.features.time
      ? possibleForDays(product, qty, data.scheduleInputs, data.departments)
      : null

  const submit = async () => {
    if (!firestore || busy || !product) return
    if (!(qty > 0)) {
      toast({ title: t("mfg2_err_quantity_required"), variant: "destructive" })
      return
    }
    setBusy(true)
    try {
      const project = data.projects.find((p) => p.id === projectId)
      await createWorkOrderFromProduct(firestore, {
        organizationId: data.orgId,
        product,
        quantity: qty,
        neededBy: neededBy || null,
        source:
          sourceKind === "project"
            ? { kind: "project", projectId: project?.id ?? null, projectName: project?.name ?? null }
            : sourceKind === "quotation"
              ? { kind: "quotation", contactName: contactName || null, quotationNumber: quotationNumber || null, quotationWon: true }
              : { kind: "stock" },
        actor: data.actor,
      })
      toast({ title: t("mfg2_order_created_toast") })
      setOpen(false)
      setQuantity("")
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" className="gap-2" onClick={() => setOpen(true)}>
        <Layers size={15} /> {t("mfg2_new_order_from_product")}
      </Button>
      {open && (
        <Dialog open onOpenChange={(v) => !v && setOpen(false)}>
          <DialogContent className="max-w-lg" dir={locale === "ar" ? "rtl" : "ltr"}>
            <DialogHeader>
              <DialogTitle className="text-base">{t("mfg2_new_order_from_product")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2 space-y-1">
                  <Label className="text-xs font-bold">{t("mfg2_field_product")}</Label>
                  <Select value={productId} onValueChange={setProductId}>
                    <SelectTrigger><SelectValue placeholder={t("mfg2_field_product")} /></SelectTrigger>
                    <SelectContent>
                      {data.products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold">
                    {t("mfg2_field_quantity")}
                    {product ? ` (${product.unit})` : ""}
                  </Label>
                  <Input type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs font-bold">{t("mfg2_field_source")}</Label>
                  <Select value={sourceKind} onValueChange={(v) => setSourceKind(v as typeof sourceKind)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="project">{t("mfg2_source_project")}</SelectItem>
                      <SelectItem value="quotation">{t("mfg2_source_quotation")}</SelectItem>
                      <SelectItem value="stock">{t("mfg2_source_stock")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-bold">{t("mfg2_field_needed_by")}</Label>
                  <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
                </div>
              </div>
              {sourceKind === "project" && (
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
              )}
              {sourceKind === "quotation" && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs font-bold">{t("mfg2_field_client")}</Label>
                    <Input value={contactName} onChange={(e) => setContactName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-bold">{t("mfg2_est_quote_number")}</Label>
                    <Input value={quotationNumber} onChange={(e) => setQuotationNumber(e.target.value)} placeholder="Q-XXXXXX" />
                  </div>
                </div>
              )}
              {product && qty > 0 && (
                <div className="rounded-xl border bg-muted/10 px-3 py-2.5 text-xs space-y-1">
                  {std && data.seesMoney && (
                    <p>
                      {t("mfg2_cost_standard")}: <b className="tabular-nums">{fmtMoney(std.total)} ﷼</b>
                      {data.settings.features.time && <> · {Math.round(std.hours)} {t("mfg2_hours_short")}</>}
                    </p>
                  )}
                  {possible != null && <p>{t("mfg2_est_earliest", { days: possible })}</p>}
                  {product.requiresMeasurement && <p className="text-amber-700">{t("mfg2_block_measurement")}</p>}
                  {product.requiresDrawingApproval && <p className="text-amber-700">{t("mfg2_block_drawing")}</p>}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setOpen(false)}>{t("crm_cancel")}</Button>
                <Button size="sm" disabled={busy || !product} onClick={submit} className="gap-1.5">
                  {busy && <Loader2 size={13} className="animate-spin" />}
                  {t("mfg2_create_order_btn")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
