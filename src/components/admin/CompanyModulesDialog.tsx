"use client"

// Admin → a company's components. A contractor's Project Management, Finance, HR and Manufacturing — and a supplier's CRM,
// Inventory, Finance, HR and Manufacturing — can be switched off for one company; everything else is core and stays
// on. A module that needs an off one goes off with it (HR needs Finance and Inventory; Manufacturing needs Inventory).
// The company's menu, tiles and pages follow at once.

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Callout } from "@/components/module-ui/Callout"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { COMPANY_MODULES, SALES_ONLY_OFF, forcedOffBy, offSet, optionalFor, withDependents, type ModulePortal, type OptionalModule } from "@/lib/company-modules"
import { setCompanyModules } from "@/lib/company-modules-writes"
import { readPending, warningsFor, type PendingByModule } from "@/lib/company-modules-pending"
import { COMPANY_PLANS, planOf, planTrialOf, type PlanDoc, type SupplierPlan } from "@/lib/supplier-plan"
import { PAID_TRIAL_DEFAULT_DAYS, parseTrialDays, trialDayText } from "@/lib/subscription-status"
import { TrialDaysInput } from "@/components/admin/TrialDaysInput"
import { setSupplierPlan } from "@/lib/supplier-plan-writes"

const LABEL: Record<OptionalModule, { name: string; desc: string }> = {
  "project-management": { name: "component_project_management", desc: "component_project_management_desc" },
  hr: { name: "component_hr", desc: "component_hr_desc" },
  manufacturing: { name: "component_manufacturing", desc: "component_manufacturing_desc" },
  crm: { name: "component_crm", desc: "supplier_component_crm_desc" },
  warehouses: { name: "component_inventory", desc: "component_inventory_desc" },
  payments: { name: "component_finance", desc: "component_finance_desc" },
}

export function CompanyModulesDialog({ orgId, companyName, portal, onClose }: { orgId: string; companyName: string; portal: ModulePortal; onClose: () => void }) {
  const t = useTranslations("Portal.AdminModules")
  const tSide = useTranslations("Portal.Sidebar")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const ref = useMemoFirebase(() => (firestore ? doc(firestore, COMPANY_MODULES, orgId) : null), [firestore, orgId])
  const { data, isLoading } = useDoc(ref)
  const planRef = useMemoFirebase(() => (firestore && portal === "supplier" ? doc(firestore, COMPANY_PLANS, orgId) : null), [firestore, orgId, portal])
  const { data: planDoc, isLoading: planLoading } = useDoc(planRef)
  const [plan, setPlan] = useState<SupplierPlan>("free")
  const [initialPlan, setInitialPlan] = useState<SupplierPlan>("free")
  const [trialOn, setTrialOn] = useState(false)
  const [initialTrialOn, setInitialTrialOn] = useState(false)
  const [trialDays, setTrialDays] = useState(String(PAID_TRIAL_DEFAULT_DAYS))
  const [trialTouched, setTrialTouched] = useState(false)
  const [off, setOff] = useState<ReadonlySet<OptionalModule>>(new Set())
  const [ready, setReady] = useState(false)
  const [initial, setInitial] = useState<ReadonlySet<OptionalModule>>(new Set())
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingByModule | null>(null)

  useEffect(() => {
    if (isLoading || planLoading || ready) return
    const current = offSet(data as { off?: unknown } | null, portal)
    setOff(current)
    setInitial(current)
    const p = planOf(planDoc as PlanDoc | null)
    setPlan(p)
    setInitialPlan(p)
    const stored = planDoc as (PlanDoc & { planTrialDays?: unknown }) | null
    const hasTrial = planTrialOf(stored).phase !== "none"
    setTrialOn(hasTrial)
    setInitialTrialOn(hasTrial)
    if (hasTrial && typeof stored?.planTrialDays === "number") setTrialDays(String(stored.planTrialDays))
    setReady(true)
  }, [isLoading, planLoading, data, planDoc, portal, ready])

  const toggle = (id: OptionalModule, on: boolean) => {
    setPending(null)
    setOff((prev) => {
      const next = new Set(prev)
      if (on) next.delete(id)
      else next.add(id)
      return withDependents(next, portal)
    })
  }
  const preset = (list: readonly OptionalModule[]) => {
    setPending(null)
    setOff(withDependents(list, portal))
  }

  const warnings = pending ? warningsFor(initial, off, pending) : []
  const trialLength = plan === "full" && trialOn ? parseTrialDays(trialDays) : null
  const planChanged = plan !== initialPlan || (plan === "full" && (trialOn !== initialTrialOn || trialTouched))
  const trialInvalid = portal === "supplier" && plan === "full" && trialOn && trialLength === null
  const trialClock = planTrialOf(planDoc as PlanDoc | null)

  const fetchPending = async (): Promise<PendingByModule> => {
    if (!user) return {}
    const token = await user.getIdToken()
    const res = await fetch(`/api/admin/company-modules/pending?orgId=${encodeURIComponent(orgId)}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`pending ${res.status}`)
    const body = (await res.json()) as { data?: unknown }
    return readPending(body.data)
  }

  const save = async () => {
    if (!firestore || !user) return
    setBusy(true)
    try {
      const switchingOff = [...off].some((m) => !initial.has(m))
      if (switchingOff && !pending) {
        const found = await fetchPending()
        setPending(found)
        if (warningsFor(initial, off, found).length > 0) return
      }
      await setCompanyModules(firestore, orgId, [...off], { uid: user.uid, name: user.displayName || user.email || "" })
      if (portal === "supplier" && planChanged) await setSupplierPlan(firestore, orgId, plan, { uid: user.uid, name: user.displayName || user.email || "" }, trialLength ?? undefined)
      toast({ title: t("saved") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t("save_failed"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription dir="auto">{companyName}</DialogDescription>
        </DialogHeader>
        {!ready ? (
          <div className="flex justify-center p-6">
            <Loader2 className="animate-spin text-primary" size={22} aria-hidden="true" />
          </div>
        ) : (
          <div className="space-y-3">
            {portal === "supplier" && (
              <fieldset className="rounded-lg border p-3">
                <legend className="px-1 text-xs font-bold text-muted-foreground">{t("plan_title")}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["free", "full"] as const).map((p) => (
                    <label key={p} className={`flex cursor-pointer gap-2 rounded-lg border p-2.5 text-sm ${plan === p ? "border-primary bg-primary/5" : ""}`}>
                      <input type="radio" name="supplier-plan" className="mt-1" checked={plan === p} onChange={() => setPlan(p)} disabled={busy} />
                      <span>
                        <b className="block">{t(p === "free" ? "plan_free" : "plan_full")}</b>
                        <span className="text-xs text-muted-foreground">{t(p === "free" ? "plan_free_desc" : "plan_full_desc")}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {plan === "full" && (
                  <div className="mt-3 space-y-3 border-t pt-3 text-sm">
                    <label className="flex cursor-pointer items-center gap-2 font-bold">
                      <input type="checkbox" checked={trialOn} onChange={(e) => setTrialOn(e.target.checked)} disabled={busy} />
                      {t("plan_trial")}
                    </label>
                    {trialOn && (
                      <TrialDaysInput
                        id="plan-trial-days"
                        label={t("plan_trial_days")}
                        value={trialDays}
                        onChange={(v) => {
                          setTrialDays(v)
                          setTrialTouched(true)
                        }}
                        disabled={busy}
                      />
                    )}
                    {trialClock.phase === "running" && !trialTouched && <p className="text-xs text-muted-foreground">{t("plan_trial_running", { date: trialDayText(trialClock.endsAt, locale), count: trialClock.daysLeft ?? 0 })}</p>}
                    {trialOn && (trialTouched || trialClock.phase === "none") && <p className="text-xs text-muted-foreground">{t("plan_trial_restart")}</p>}
                  </div>
                )}
                {plan === "free" && trialClock.phase === "ended" && <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">{t("plan_trial_ended", { date: trialDayText(trialClock.endsAt, locale) })}</p>}
              </fieldset>
            )}
            {/* Most suppliers only sell: one press leaves Order Management, Sales and Governance. */}
            {portal === "supplier" && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => preset(SALES_ONLY_OFF)} disabled={busy} title={t("preset_sales_only_desc")}>
                  {t("preset_sales_only")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => preset([])} disabled={busy}>
                  {t("preset_all_on")}
                </Button>
              </div>
            )}
            <ul className="divide-y rounded-lg border">
              {optionalFor(portal).map((id) => {
                const on = !off.has(id)
                const forcedBy = forcedOffBy(id, off, portal)
                return (
                  <li key={id} className="flex items-center justify-between gap-3 px-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{tSide(LABEL[id].name)}</p>
                      <p className="text-xs text-muted-foreground">
                        {forcedBy ? t("needs_off", { module: tSide(LABEL[forcedBy].name) }) : tSide(LABEL[id].desc)}
                      </p>
                    </div>
                    <Switch checked={on} onCheckedChange={(v) => toggle(id, v)} aria-label={tSide(LABEL[id].name)} disabled={busy || forcedBy !== null} />
                  </li>
                )
              })}
            </ul>
            {warnings.length > 0 && (
              <Callout tone="warn">
                <p className="font-bold">{t("pending_title")}</p>
                <p className="mb-1 text-xs">{t("pending_intro")}</p>
                <ul className="space-y-1 text-xs">
                  {warnings.map((w) => (
                    <li key={w.module}>
                      <span className="font-bold">{tSide(LABEL[w.module].name)}</span>
                      <ul className="ms-4 list-disc">
                        {w.items.map((i) => (
                          <li key={i.key}>{t(`pending_${i.key}`, { count: i.count })}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
            <Callout tone="info">{t("note")}</Callout>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={!ready || busy || trialInvalid}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {warnings.length > 0 ? t("confirm_off") : t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
