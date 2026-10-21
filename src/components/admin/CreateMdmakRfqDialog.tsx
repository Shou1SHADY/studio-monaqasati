"use client"

import { useState, useRef } from "react"
import { useTranslations, useLocale } from "next-intl"
import { useFirestore, useUser, useStorage } from "@/firebase"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Handshake, Plus, Trash2, Paperclip, X, AlertCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { MaterialSearchInput } from "@/components/materials/MaterialSearchInput"
import { MaterialBrowserDialog, type BrowserResult } from "@/components/materials/MaterialBrowserDialog"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { label as treeLabel, pathLabel, pickOf, unitsOf, type MaterialHit } from "@/lib/materials/tree"
import type { MaterialPick } from "@/lib/materials/types"
import {
  SAUDI_CITIES, CITIES_DISTRICTS,
  displayCity, displayDistrict,
} from "@/lib/constants"
import { createMdmakRfq } from "@/lib/mdmak-contractor"
import { unitOnPick } from "@/lib/rfq-products"

interface Props {
  open: boolean
  onClose: () => void
  onSuccess?: (rfqId: string) => void
}

interface ProductRow {
  id: string
  material: MaterialPick | null
  name: string
  quantity: string
  unit: string
  description: string
}

function emptyProduct(): ProductRow {
  return { id: Date.now().toString() + Math.random().toString(36).slice(2), material: null, name: "", quantity: "", unit: "", description: "" }
}

const specText = (m: MaterialPick) => [...m.specs.map((s) => `${s.name.ar} ${s.value.ar}`), ...(m.brand ? [m.brand.ar] : [])].join(" · ")

export function CreateMdmakRfqDialog({ open, onClose, onSuccess }: Props) {
  const t = useTranslations("Portal.Admin.Rfqs")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const storage = useStorage()
  const { toast } = useToast()
  const { index: tree } = useMaterialTree()
  const [browse, setBrowse] = useState<{ rowId: string; query: string; freeText: string | null } | null>(null)

  const [title, setTitle] = useState("")
  const [products, setProducts] = useState<ProductRow[]>([emptyProduct()])
  const [city, setCity] = useState("")
  const [district, setDistrict] = useState("")
  const [deadline, setDeadline] = useState("")
  const [estimatedBudget, setEstimatedBudget] = useState("")
  const [notes, setNotes] = useState("")
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setTitle("")
    setProducts([emptyProduct()])
    setCity("")
    setDistrict("")
    setDeadline("")
    setEstimatedBudget("")
    setNotes("")
    setPdfFile(null)
    setError("")
  }

  const handleClose = () => {
    if (loading) return
    reset()
    onClose()
  }

  const updateProduct = (id: string, field: keyof ProductRow, value: string) => {
    setProducts(prev => prev.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  const addProduct = () => setProducts(prev => [...prev, emptyProduct()])
  const removeProduct = (id: string) => setProducts(prev => prev.length > 1 ? prev.filter(p => p.id !== id) : prev)

  const handlePublish = async () => {
    setError("")

    const validProducts = products.filter(p => p.material && p.quantity.trim() && p.unit.trim())

    if (!title.trim()) return setError(t("mdmak_rfq_val_title"))
    if (validProducts.length === 0) return setError(t("mdmak_rfq_val_product"))
    if (!city) return setError(t("mdmak_rfq_val_city"))
    if (!deadline) return setError(t("mdmak_rfq_val_deadline"))
    if (!firestore || !user) return

    setLoading(true)
    try {
      let pdfUrl: string | null = null
      let pdfStoragePath: string | null = null
      if (pdfFile && storage) {
        pdfStoragePath = `mdmak-rfqs/${Date.now()}_${pdfFile.name}`
        const storageRef = ref(storage, pdfStoragePath)
        const snap = await uploadBytes(storageRef, pdfFile)
        pdfUrl = await getDownloadURL(snap.ref)
      }

      const { rfqId } = await createMdmakRfq(firestore, user.uid, {
        title: title.trim(),
        products: validProducts.map(p => {
          const m = p.material as MaterialPick
          return {
            name: p.name || treeLabel(m.path[m.path.length - 1], "ar"),
            quantity: Number(p.quantity),
            unitOfMeasure: p.unit,
            description: [specText(m), p.description].filter(Boolean).join(" · "),
            category: m.path[0]?.ar || "",
            subCategory: (m.path[1] || m.path[0])?.ar || "",
            material: m,
            materialPath: pathLabel(m.path, "ar", true),
          }
        }),
        city,
        district,
        deadline,
        estimatedBudget: estimatedBudget ? Number(estimatedBudget.replace(/\D/g, "")) : null,
        notes,
        pdfUrl,
        pdfStoragePath,
      })

      toast({ title: t("mdmak_rfq_success_toast"), description: t("mdmak_rfq_success_desc") })
      reset()
      onSuccess?.(rfqId)
      onClose()
    } catch {
      toast({ title: t("mdmak_rfq_error_toast"), variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <div className="h-9 w-9 rounded-xl bg-accent/10 flex items-center justify-center">
              <Handshake size={18} className="text-accent" />
            </div>
            {t("mdmak_rfq_dialog_title")}
          </DialogTitle>
          <DialogDescription>{t("mdmak_rfq_dialog_desc")}</DialogDescription>
        </DialogHeader>

        {error && (
          <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-xl text-sm text-destructive flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-5 pt-1">
          <div className="space-y-1.5">
            <Label className="font-semibold">{t("mdmak_rfq_title_label")}</Label>
            <Input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t("mdmak_rfq_title_placeholder")}
              className="h-11 rounded-xl border-border"
            />
          </div>

          <div className="space-y-3">
            {products.map((product, index) => (
              <div key={product.id} className="p-4 bg-muted/30 rounded-2xl border border-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground">#{index + 1}</span>
                  {products.length > 1 && (
                    <Button variant="ghost" size="sm" onClick={() => removeProduct(product.id)} className="h-7 px-2 text-destructive hover:bg-destructive/10">
                      <Trash2 size={13} />
                    </Button>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">{t("mdmak_rfq_material_label")}</Label>
                  {product.material ? (
                    <div className="flex items-center justify-between gap-2 rounded-xl border bg-background px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold" dir="auto">{product.name || treeLabel(product.material.path[product.material.path.length - 1], locale)}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{pathLabel(product.material.path, locale, !product.material.outside)}</p>
                        {product.material.specs.length > 0 && <p className="truncate text-[11px] text-muted-foreground" dir="auto">{specText(product.material)}</p>}
                      </div>
                      <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => setProducts(prev => prev.map(p => p.id === product.id ? { ...p, material: null, name: "" } : p))}>
                        {t("mdmak_rfq_material_change")}
                      </Button>
                    </div>
                  ) : (
                    <MaterialSearchInput
                      index={tree}
                      onPick={(hit: MaterialHit) => {
                        if (!tree) return
                        const m = pickOf(tree, hit.node.id, hit.preset.map(p => ({ name: { ar: p.spec.ar, en: p.spec.en }, value: p.value })))
                        if (!m) return
                        const unit = unitsOf(tree, hit.node.id)[0]
                        setProducts(prev => prev.map(p => p.id === product.id ? { ...p, material: m, name: treeLabel(hit.node, locale), unit: unitOnPick(p.unit, unit ? treeLabel(unit, locale) : undefined) } : p))
                      }}
                      onBrowse={(q) => setBrowse({ rowId: product.id, query: q, freeText: null })}
                      onFreeText={(text) => setBrowse({ rowId: product.id, query: "", freeText: text })}
                    />
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground">{t("mdmak_rfq_quantity_label")}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={product.quantity}
                      onChange={e => updateProduct(product.id, "quantity", e.target.value)}
                      className="h-10 rounded-xl border-border"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground">{t("mdmak_rfq_unit_label")}</Label>
                    <Input
                      value={product.unit}
                      onChange={e => updateProduct(product.id, "unit", e.target.value)}
                      className="h-10 rounded-xl border-border"
                    />
                  </div>
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addProduct} className="w-full gap-2 rounded-xl border-dashed">
              <Plus size={14} />
              {t("mdmak_rfq_add_product")}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="font-semibold">{t("mdmak_rfq_city_label")}</Label>
              <SearchableSelect
                value={city}
                onChange={v => { setCity(v); setDistrict("") }}
                options={SAUDI_CITIES.map(c => ({ value: c, label: displayCity(c, locale) }))}
                placeholder={t("mdmak_rfq_select_city")}
                searchPlaceholder={t("mdmak_rfq_select_city")}
                noResultsText={t("mdmak_rfq_select_city")}
              />
            </div>
            {city && CITIES_DISTRICTS[city] && (
              <div className="space-y-1.5">
                <Label className="font-semibold">{t("mdmak_rfq_district_label")}</Label>
                <SearchableSelect
                  value={district}
                  onChange={setDistrict}
                  options={CITIES_DISTRICTS[city].map(d => ({ value: d, label: displayDistrict(d, locale) }))}
                  placeholder={t("mdmak_rfq_select_district")}
                  searchPlaceholder={t("mdmak_rfq_select_district")}
                  noResultsText={t("mdmak_rfq_select_district")}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="font-semibold">{t("mdmak_rfq_deadline_label")}</Label>
              <input
                type="date"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                dir="ltr"
                className="flex h-10 w-full rounded-xl border border-border bg-white px-3 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="font-semibold">{t("mdmak_rfq_budget_label")}</Label>
              <Input
                inputMode="numeric"
                dir="ltr"
                value={estimatedBudget}
                onChange={e => setEstimatedBudget(e.target.value.replace(/\D/g, ""))}
                className="h-10 rounded-xl border-border"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="font-semibold text-muted-foreground">{t("mdmak_rfq_notes_label")}</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              className="rounded-xl resize-none border-border text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="font-semibold text-muted-foreground">{t("mdmak_rfq_pdf_label")}</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={e => setPdfFile(e.target.files?.[0] ?? null)}
            />
            {pdfFile ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-accent/30 bg-accent/5 text-sm">
                <Paperclip size={14} className="text-accent shrink-0" />
                <span className="flex-1 truncate text-foreground font-medium">{pdfFile.name}</span>
                <button type="button" onClick={() => { setPdfFile(null); if (fileInputRef.current) fileInputRef.current.value = "" }} className="text-muted-foreground hover:text-destructive transition-colors">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="rounded-xl gap-2 w-full border-dashed">
                <Paperclip size={14} />
                {t("mdmak_rfq_pdf_btn")}
              </Button>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button variant="outline" onClick={handleClose} disabled={loading} className="rounded-xl">
            {t("mdmak_rfq_cancel")}
          </Button>
          <Button
            onClick={handlePublish}
            disabled={loading}
            className={cn("rounded-xl gap-2 bg-accent hover:bg-accent/90 text-primary font-bold shadow-lg shadow-accent/25 px-6")}
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Handshake size={15} />}
            {loading ? t("mdmak_rfq_publishing") : t("mdmak_rfq_publish")}
          </Button>
        </DialogFooter>
      </DialogContent>
      <MaterialBrowserDialog
        open={browse !== null}
        onOpenChange={(o) => !o && setBrowse(null)}
        index={tree}
        initialQuery={browse?.query ?? ""}
        freeText={browse?.freeText ?? null}
        onAdd={(r: BrowserResult) => {
          const rowId = browse?.rowId
          setBrowse(null)
          if (!rowId) return
          const leaf = r.pick.path[r.pick.path.length - 1]
          setProducts(prev => prev.map(p => p.id === rowId ? { ...p, material: r.pick, name: r.name || (leaf ? treeLabel(leaf, locale) : ""), unit: unitOnPick(p.unit, r.unit ? treeLabel(r.unit, locale) : undefined) } : p))
        }}
      />
    </Dialog>
  )
}
