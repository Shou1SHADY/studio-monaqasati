"use client"

// New work order — two steps. First where it is for and what it is (the
// product card brings its route, bill of materials and standard time); then the
// date, reviewed against what capacity allows, what it will cost against buying
// it, the gates it will wait on, and whether the stores can cover it.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Factory, FileText, FolderKanban, Layers, Warehouse } from "lucide-react"
import { useRouter } from "@/i18n/routing"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useOrgStock, stockKey } from "@/hooks/useOrgStock"
import { cn, sanitizeDecimalInput } from "@/lib/utils"
import { possibleForDays, round2, standardCost, stationQueueDays } from "@/lib/manufacturing-engine"
import { createWorkOrderFromProduct } from "@/lib/manufacturing-writes"
import { useMfgUi } from "./MfgUiContext"
import { MfgChip, MfgChoiceCards, MfgEffects, MfgField, MfgFormModal, MfgNote, MfgReview, departmentIcon, fmtMoney, fmtQty, useMfgDate } from "./ui/MfgUi"

type SourceKind = "project" | "quotation" | "stock"

export function MfgNewOrderWizard({ onClose, onCreated }: { onClose: () => void; onCreated: (orderId: string) => void }) {
  const t = useTranslations("Portal.Shared")
  const router = useRouter()
  const firestore = useFirestore()
  const { toast } = useToast()
  const ui = useMfgUi()
  const { data, perms, base } = ui
  const d = useMfgDate()

  const [step, setStep] = useState(0)
  const [source, setSource] = useState<SourceKind>("project")
  const [projectId, setProjectId] = useState("")
  const [client, setClient] = useState("")
  const [quoteNumber, setQuoteNumber] = useState("")
  const [quoteWon, setQuoteWon] = useState(true)
  const [productId, setProductId] = useState(data.products[0]?.id || "")
  const [qty, setQty] = useState("")
  const [neededBy, setNeededBy] = useState("")
  const [busy, setBusy] = useState(false)
  const [showErrors, setShowErrors] = useState(false)

  const product = data.productById.get(productId)
  const q = Number(qty) || 0
  const stock = useOrgStock(data.warehouses, step === 1)
  const std = product && q > 0 ? standardCost(product, data.departments, data.settings, q) : null
  const possible = product && q > 0 && data.settings.features.time ? possibleForDays(product, q, data.scheduleInputs, data.departments) : null
  const possibleDate = possible != null ? new Date(Date.now() + possible * 86400000).toISOString().slice(0, 10) : null
  const late = !!possibleDate && !!neededBy && possibleDate > neededBy
  const buyTotal = product?.referenceBuyPrice != null && q > 0 ? round2(product.referenceBuyPrice * q) : null
  const shortages = useMemo(() => {
    if (!product || q <= 0 || stock.loading) return []
    const need = new Map<string, { name: string; unit: string; qty: number }>()
    for (const b of product.bom || []) {
      const amount = b.qtyPerUnit * q * (b.withWaste ? 1 + (product.wastePercent || 0) / 100 : 1)
      const key = stockKey(b.itemName)
      const prev = need.get(key)
      need.set(key, { name: b.itemName, unit: b.unit, qty: round2((prev?.qty || 0) + amount) })
    }
    return Array.from(need.entries())
      .map(([key, n]) => ({ ...n, available: stock.byName.get(key) || 0 }))
      .filter((n) => n.qty > n.available + 1e-9)
  }, [product, q, stock])

  const step0Error =
    !product ? t("mfg3_new_err_product") : q <= 0 ? t("mfg3_err_qty") : source === "project" && !projectId ? t("mfg3_new_err_project") : source === "quotation" && !client.trim() ? t("mfg3_new_err_client") : null
  const step1Error = !neededBy ? t("mfg3_new_err_date") : null

  const next = () => {
    setShowErrors(true)
    if (step0Error) return
    setShowErrors(false)
    setStep(1)
  }

  const submit = async () => {
    setShowErrors(true)
    if (!firestore || !product || step0Error || step1Error || busy) return
    setBusy(true)
    try {
      const project = data.projects.find((p) => p.id === projectId)
      const res = await createWorkOrderFromProduct(firestore, {
        organizationId: data.orgId,
        product,
        quantity: q,
        neededBy,
        source:
          source === "project"
            ? { kind: "project", projectId: project?.id ?? null, projectName: project?.name ?? null }
            : source === "quotation"
              ? { kind: "quotation", contactName: client.trim(), quotationNumber: quoteNumber.trim() || null, quotationWon: quoteWon }
              : { kind: "stock" },
        actor: data.actor,
      })
      toast({ title: t("mfg3_new_toast", { number: res.orderNumber }) })
      onCreated(res.id)
    } catch (err) {
      console.error(err)
      toast({ title: t("mfg_save_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const blockers = product
    ? [
        product.requiresMeasurement && t("mfg3_new_gate_measurement"),
        product.requiresDrawingApproval && t("mfg3_new_gate_drawing"),
        product.requiresSlabApproval && t("mfg3_new_gate_slab"),
      ].filter(Boolean)
    : []

  return (
    <MfgFormModal
      open
      onClose={onClose}
      icon={Factory}
      title={t("mfg3_new_title")}
      subtitle={t("mfg3_new_subtitle")}
      steps={[t("mfg3_new_step_source"), t("mfg3_new_step_review")]}
      step={step}
      busy={busy}
      error={showErrors ? (step === 0 ? step0Error : step1Error) : null}
      onBack={() => setStep(0)}
      onNext={next}
      onConfirm={() => void submit()}
      confirmLabel={t("mfg3_new_confirm")}
      size="lg"
    >
      {step === 0 ? (
        <>
          <MfgChoiceCards
            value={source}
            onChange={setSource}
            columns={3}
            options={[
              { id: "project", icon: FolderKanban, title: t("mfg3_new_src_project"), description: t("mfg3_new_src_project_desc") },
              { id: "quotation", icon: FileText, title: t("mfg3_new_src_quotation"), description: t("mfg3_new_src_quotation_desc") },
              { id: "stock", icon: Warehouse, title: t("mfg3_new_src_stock"), description: t("mfg3_new_src_stock_desc") },
            ]}
          />
          {source === "project" && (
            <MfgField label={t("mfg3_new_project")} required>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue placeholder={t("mfg3_new_project")} /></SelectTrigger>
                <SelectContent>
                  {data.projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MfgField>
          )}
          {source === "quotation" && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MfgField label={t("mfg3_f_client")} required htmlFor="new-client">
                <Input id="new-client" value={client} onChange={(e) => setClient(e.target.value)} />
              </MfgField>
              <MfgField label={t("mfg3_new_quote_no")} hint={t("mfg3_new_quote_no_hint")} htmlFor="new-quote">
                <Input id="new-quote" dir="ltr" value={quoteNumber} onChange={(e) => setQuoteNumber(e.target.value)} placeholder="Q-XXXXXX" />
              </MfgField>
              <label className="flex items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2.5 text-xs sm:col-span-2">
                <span>
                  <b className="block">{t("mfg3_new_quote_won")}</b>
                  <span className="text-muted-foreground">{t("mfg3_new_quote_won_hint")}</span>
                </span>
                <Switch checked={quoteWon} onCheckedChange={setQuoteWon} aria-label={t("mfg3_new_quote_won")} />
              </label>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem]">
            <MfgField label={t("mfg3_new_product")} required hint={t("mfg3_new_product_hint")}>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger><SelectValue placeholder={t("mfg3_new_product")} /></SelectTrigger>
                <SelectContent>
                  {data.products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MfgField>
            <MfgField label={t("mfg3_f_quantity")} required htmlFor="new-qty">
              <div className="relative">
                <Input id="new-qty" inputMode="decimal" dir="ltr" value={qty} onChange={(e) => setQty(sanitizeDecimalInput(e.target.value))} className="pe-14" />
                {product && <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-[11px] text-muted-foreground">{product.unit}</span>}
              </div>
            </MfgField>
          </div>
          {product && (
            <div className="rounded-xl border bg-white px-3.5 py-3">
              <p className="mb-2 text-[11px] font-bold text-muted-foreground">{t("mfg3_new_route")}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {product.route.map((r, i) => {
                  const dept = data.departments.find((x) => x.id === r.departmentId)
                  const Icon = departmentIcon(dept?.name || r.departmentName, r.onSite)
                  return (
                    <span key={`${r.departmentId}_${i}`} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-muted-foreground" aria-hidden="true">←</span>}
                      <MfgChip icon={Icon}>{dept?.name || r.departmentName}</MfgChip>
                    </span>
                  )
                })}
              </div>
              {std && data.settings.features.time && (
                <p className="mt-2 text-[11px] text-muted-foreground">{t("mfg3_new_std_time", { hours: fmtQty(std.hours) })}</p>
              )}
            </div>
          )}
          {!data.products.length && <MfgNote tone="warn">{t("mfg3_new_no_products")}</MfgNote>}
          <button
            type="button"
            onClick={() => { onClose(); router.push(`${base}/orders?seg=legacy&quick=1`) }}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Layers size={12} aria-hidden="true" /> {t("mfg3_new_quick_link")}
          </button>
        </>
      ) : (
        <>
          <MfgField label={t("mfg3_new_needed_by")} required hint={t("mfg3_new_needed_by_hint")} htmlFor="new-date">
            <Input id="new-date" type="date" dir="ltr" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className="max-w-xs" />
          </MfgField>
          <MfgReview
            rows={[
              [t("mfg3_f_order"), product ? `${product.name} × ${fmtQty(q)} ${product.unit}` : "—"],
              [
                t("mfg3_new_for"),
                source === "project"
                  ? data.projects.find((p) => p.id === projectId)?.name || "—"
                  : source === "quotation"
                    ? [client, quoteNumber].filter(Boolean).join(" · ")
                    : t("mfg3_source_stock_name"),
              ],
              possibleDate && [
                t("mfg3_rel_possible"),
                <span key="p" className={cn("font-bold", neededBy ? (late ? "text-destructive" : "text-success") : "")}>
                  {d.short(possibleDate)}
                  {neededBy && (late ? ` — ${t("mfg3_new_after_needed", { days: d.dayDiff(possibleDate) - d.dayDiff(neededBy) })}` : ` — ${t("mfg3_new_on_time")}`)}
                </span>,
              ],
              product && data.settings.features.time && [
                t("mfg3_new_why"),
                product.route
                  .map((r) => {
                    const dept = data.departments.find((x) => x.id === r.departmentId)
                    return `${dept?.name || r.departmentName} ${dept ? stationQueueDays(data.scheduleInputs, dept) : 0}${t("mfg3_days_short")}`
                  })
                  .join(" + "),
              ],
              perms.seesMoney && std && [t("mfg3_rel_std_cost"), t("mfg3_new_cost_value", { total: fmtMoney(std.total), unit: fmtMoney(std.total / Math.max(q, 1)) })],
              perms.seesMoney && std && buyTotal != null && [
                t("mfg3_new_buy_ref"),
                <span key="b" className={std.total <= buyTotal ? "text-success" : "text-destructive"}>
                  {fmtMoney(buyTotal)} ﷼ — {std.total <= buyTotal ? t("mfg3_new_make_cheaper") : t("mfg3_new_buy_cheaper")}
                </span>,
              ],
            ]}
          />
          {late && <MfgNote tone="bad">{t("mfg3_new_late_note")}</MfgNote>}
          {blockers.map((b) => (
            <MfgNote key={b as string} tone="warn">{b}</MfgNote>
          ))}
          {source === "quotation" && !quoteWon && <MfgNote tone="bad">{t("mfg3_new_quote_not_won")}</MfgNote>}
          {shortages.length > 0 && (
            <MfgNote tone="warn" title={t("mfg3_rel_short_title")}>
              {shortages
                .slice(0, 3)
                .map((s) => t("mfg3_rel_short_line", { item: s.name, available: fmtQty(s.available), qty: fmtQty(s.qty), unit: s.unit }))
                .join(" · ")}
            </MfgNote>
          )}
          <MfgEffects
            items={[
              { text: t("mfg3_new_eff_created") },
              { text: t("mfg3_new_eff_to_release") },
              { text: t("mfg3_new_eff_nothing_reserved"), applies: false },
            ]}
          />
        </>
      )}
    </MfgFormModal>
  )
}
