"use client"

// «أمر مباشر لخدمة أو مقطوعية» (the prototype's poFree, orders tab head):
// transport, a daily rental, sundries — what never arrives as a line from
// another module. A description, the supplier (never a subcontractor — his
// contract lives in Project Management), the project it is charged to or none
// (a general expense), the agreed value and the day it is due. It goes to
// approval like every direct order; the rules are in `service-order.ts`.

import { useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { collection, query, where } from "firebase/firestore"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, Info, Loader2, ShoppingCart } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "@/i18n/routing"
import { createServiceOrder } from "@/lib/procurement/direct-writes"
import { displayDocNumber } from "@/lib/procurement/format"
import { addDays, supplierKey, todayOf } from "@/lib/procurement/po"
import { serviceOrderValue, serviceSupplierOk } from "@/lib/procurement/service-order"
import type { SupplierRecord } from "@/lib/procurement/supplier-file"
import type { ProcActor, ProcurementPolicies, PurchaseOrder } from "@/lib/procurement/types"
import { ProcWriteError } from "@/lib/procurement/writes"
import { sarLtr } from "@/lib/riyal"

const NONE = "__none__"
const money = (n: number) => sarLtr(n.toLocaleString("en-US", { maximumFractionDigits: 2 }))

export function ServiceOrderDialog({
  open,
  onOpenChange,
  orders,
  supplierRecords,
  policies,
  actor,
  orgId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orders: PurchaseOrder[]
  supplierRecords: SupplierRecord[]
  policies: ProcurementPolicies
  actor: ProcActor
  orgId: string
}) {
  const t = useTranslations("Portal.Shared")
  const tProc = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const firestore = useFirestore()
  const router = useRouter()
  const { toast } = useToast()
  const today = todayOf(new Date())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const projectsQ = useMemoFirebase(() => (firestore && orgId && open ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId, open])
  const { data: projectDocs } = useCollection<{ name?: string; title?: string; archived?: boolean }>(projectsQ)
  const projects = useMemo(() => (projectDocs || []).filter((p) => !p.archived).map((p) => ({ id: p.id, name: p.name || p.title || "" })).sort((a, b) => a.name.localeCompare(b.name)), [projectDocs])

  const suppliers = useMemo(() => {
    const seen = new Map<string, { key: string; orgId: string | null; userId: string | null; name: string }>()
    for (const r of supplierRecords) if (serviceSupplierOk(r.kind)) seen.set(r.supplierOrgId, { key: r.supplierOrgId, orgId: r.supplierOrgId, userId: r.supplierOrgId, name: r.supplierName })
    const subs = new Set(supplierRecords.filter((r) => !serviceSupplierOk(r.kind)).map((r) => r.supplierOrgId))
    for (const o of orders) {
      const key = o.isGuestSupplier ? supplierKey(o) : o.supplierOrgId
      if (!seen.has(key) && !subs.has(key)) seen.set(key, { key, orgId: o.isGuestSupplier ? null : o.supplierOrgId, userId: o.supplierUserId, name: o.supplierName })
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [orders, supplierRecords])

  const schema = z.object({
    description: z.string().trim().min(1, t("svc_err_description")),
    supplier: z.string().min(1, t("svc_err_supplier")),
    project: z.string(),
    value: z.string().refine((v) => serviceOrderValue(v) > 0, t("svc_err_value")),
    dueBy: z.string().refine((v) => !v || v >= today, t("svc_err_due")),
  })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { description: "", supplier: "", project: NONE, value: "", dueBy: addDays(today, 3) } })
  const [valueText, supplierPick, projectPick] = useWatch({ control: form.control, name: ["value", "supplier", "project"] })
  const value = serviceOrderValue(valueText)
  const ownerApproves = value > policies.managerApprovalLimit || actor.canApprove || actor.isOwner
  const errors = form.formState.errors

  const close = (next: boolean) => {
    if (busy) return
    if (!next) {
      form.reset()
      setError(null)
    }
    onOpenChange(next)
  }

  const submit = form.handleSubmit(async (v) => {
    if (!firestore) return
    const picked = suppliers.find((s) => s.key === v.supplier)
    if (!picked) return
    const project = projects.find((p) => p.id === v.project) || null
    setBusy(true)
    setError(null)
    try {
      const po = await createServiceOrder(firestore, actor, {
        organizationId: orgId,
        description: v.description,
        supplier: { orgId: picked.orgId, userId: picked.userId, name: picked.name },
        value: v.value,
        dueBy: v.dueBy || null,
        projectId: project?.id ?? null,
        projectName: project?.name ?? null,
        policies,
      })
      toast({ title: t("dor_placed", { number: displayDocNumber(po.docNumber, locale) }) })
      form.reset()
      onOpenChange(false)
      router.push(`/contractor/rfqs/orders?po=${po.id}`)
    } catch (err) {
      console.error(err)
      setError(err instanceof ProcWriteError ? tProc(`err_${err.code}`, err.params) : t("dor_failed"))
    } finally {
      setBusy(false)
    }
  })

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart size={18} className="text-cta" aria-hidden="true" />
            {t("svc_title")}
          </DialogTitle>
          <DialogDescription>{t("svc_sub")}</DialogDescription>
        </DialogHeader>

        <form id="svc-order" onSubmit={submit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="svc-desc">{t("svc_description")}</Label>
            <Input id="svc-desc" dir="auto" placeholder={t("svc_description_ph")} aria-invalid={Boolean(errors.description)} {...form.register("description")} />
            {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="svc-supplier">{t("dor_supplier")}</Label>
              <Select value={supplierPick} onValueChange={(v) => form.setValue("supplier", v, { shouldValidate: form.formState.isSubmitted })}>
                <SelectTrigger id="svc-supplier" aria-invalid={Boolean(errors.supplier)}>
                  <SelectValue placeholder={t("dor_choose")} />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.supplier && <p className="text-xs text-destructive">{errors.supplier.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="svc-project">{t("svc_project")}</Label>
              <Select value={projectPick} onValueChange={(v) => form.setValue("project", v)}>
                <SelectTrigger id="svc-project">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>{t("svc_no_project")}</SelectItem>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="svc-value">{t("svc_value")}</Label>
              <Input id="svc-value" type="number" inputMode="decimal" min={0} dir="ltr" className="tabular-nums" aria-invalid={Boolean(errors.value)} {...form.register("value")} />
              {errors.value && <p className="text-xs text-destructive">{errors.value.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="svc-due">{t("svc_due")}</Label>
              <Input id="svc-due" type="date" min={today} dir="ltr" aria-invalid={Boolean(errors.dueBy)} {...form.register("dueBy")} />
              {errors.dueBy && <p className="text-xs text-destructive">{errors.dueBy.message}</p>}
            </div>
          </div>

          <div className="rounded-xl border border-module/20 bg-module/5 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-black text-module">
              <Info size={13} aria-hidden="true" /> {t("dor_effects")}
            </p>
            <ul className="space-y-1 text-xs leading-relaxed text-foreground">
              {value > 0 && (
                <li className="flex gap-1.5">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                  <span>{t("dor_effect_value", { value: money(value) })}</span>
                </li>
              )}
              <li className="flex gap-1.5">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                <span>{t(ownerApproves ? "dor_effect_owner" : "dor_effect_manager")}</span>
              </li>
              <li className="flex gap-1.5">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                <span>{t("dor_effect_after")}</span>
              </li>
            </ul>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            {t("acc_cancel")}
          </Button>
          <Button type="submit" form="svc-order" disabled={busy} className="gap-1.5 bg-module text-module-foreground hover:bg-module/90">
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
            {t("dor_prepare")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
