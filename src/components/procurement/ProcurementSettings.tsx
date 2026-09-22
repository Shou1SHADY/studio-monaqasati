"use client"

// الإعدادات والحدود — Procurement's policies (PRD 3.0 §6.4), who does what
// (§3), and what the module owns, reads and never does (§1.3–1.4). The
// policies are the numbers the rules gate money with: a limit is a number
// that blocks for real, enforced in firestore.rules, and this form is its
// reflection. `resolvePolicies` sanitises before the write so a blank or a
// negative never reaches the document. Saved as `procurementSettings/{orgId}`.

import type { ElementType, ReactNode } from "react"
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { doc, serverTimestamp, setDoc } from "firebase/firestore"
import { Ban, BookOpen, Check, Eye, Loader2, Lock, Save, Settings2, Shield, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Link } from "@/i18n/routing"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { resolvePolicies } from "@/lib/procurement/policies"
import { DEFAULT_POLICIES, PROCUREMENT_SETTINGS, type ProcurementPolicies } from "@/lib/procurement/types"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

type NumericKey = Exclude<keyof ProcurementPolicies, "sealOffersUntilDeadline">

/** Field order on the form — money first, then counts, then days. */
const FIELDS: Array<{ key: NumericKey; unit: "sar" | "percent" | "count" | "days" }> = [
  { key: "managerApprovalLimit", unit: "sar" },
  { key: "directPurchaseCap", unit: "sar" },
  { key: "competitionThreshold", unit: "sar" },
  { key: "minOffers", unit: "count" },
  { key: "overReceiptTolerancePercent", unit: "percent" },
  { key: "rfqWindowDays", unit: "days" },
  { key: "awardCycleDays", unit: "days" },
  { key: "supplierAcceptanceDays", unit: "days" },
  { key: "splitWindowDays", unit: "days" },
]

const nonNegative = z.coerce.number().min(0)
const schema = z.object({
  managerApprovalLimit: nonNegative,
  directPurchaseCap: nonNegative,
  competitionThreshold: nonNegative,
  minOffers: z.coerce.number().int().min(1),
  overReceiptTolerancePercent: z.coerce.number().min(0).max(100),
  rfqWindowDays: z.coerce.number().int().min(0),
  awardCycleDays: z.coerce.number().int().min(0),
  supplierAcceptanceDays: z.coerce.number().int().min(0),
  splitWindowDays: z.coerce.number().int().min(0),
  sealOffersUntilDeadline: z.boolean(),
})
type FormValues = z.infer<typeof schema>

/** The four roles and the permission each maps to (DESIGN §Permissions). */
const ROLES: Array<{ id: "owner" | "manager" | "buyer" | "expediter" | "receiver"; permission: string | null }> = [
  { id: "owner", permission: null },
  { id: "manager", permission: "po.approve" },
  { id: "buyer", permission: "offers.accept" },
  { id: "expediter", permission: "po.expedite" },
  { id: "receiver", permission: "deliveries.confirm" },
]

const BOUNDARY_LISTS: Array<{ id: "owns" | "reads" | "never"; icon: ElementType; tone: string; count: number }> = [
  { id: "owns", icon: Check, tone: "text-success", count: 6 },
  { id: "reads", icon: Eye, tone: "text-module", count: 6 },
  { id: "never", icon: Ban, tone: "text-destructive", count: 6 },
]

export function ProcurementSettings() {
  const t = useTranslations("Portal.ProcSettings")
  const tShared = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const { actor, orgId, policies, loading } = useProcurementWorld()
  const mayEdit = actor.isOwner || actor.canApprove
  const [saving, setSaving] = useState(false)

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: policies })
  // The document arrives after the first render: seed the form once it does,
  // and never over a form the member has started editing.
  useEffect(() => {
    if (!loading && !form.formState.isDirty) form.reset(policies)
  }, [loading, policies, form])

  /** The PRD's reference value, as the placeholder and the hint under each box. */
  const fmtRef = (key: NumericKey, unit: "sar" | "percent" | "count" | "days") => {
    const v = DEFAULT_POLICIES[key]
    if (unit === "sar") return sarLtr(v.toLocaleString("en-US"))
    if (unit === "percent") return `${v}%`
    return v.toLocaleString("en-US")
  }

  const onSubmit = async (values: FormValues) => {
    if (!firestore || !orgId || !user || !mayEdit) return
    setSaving(true)
    try {
      const clean = resolvePolicies(values)
      await setDoc(
        doc(firestore, PROCUREMENT_SETTINGS, orgId),
        { ...clean, organizationId: orgId, updatedAt: serverTimestamp(), updatedById: user.uid },
        { merge: true }
      )
      form.reset(clean)
      toast({ title: t("saved") })
    } catch (err) {
      console.error(err)
      toast({ title: t("saveFailed"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <ProcurementHeader icon={Settings2} title={t("page.title")} description={t("page.subtitle")} />

      {loading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          {/* ── Policies ── */}
          <Section title={t("policies.title")} subtitle={t("policies.subtitle")} icon={Shield}>
            {!mayEdit && (
              <p className="flex items-center gap-1.5 border-b px-4 py-2 text-[11px] text-muted-foreground">
                <Lock size={11} aria-hidden="true" />
                {t("policies.readOnly")}
              </p>
            )}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="divide-y">
                {FIELDS.map(({ key, unit }) => (
                  <FormField
                    key={key}
                    control={form.control}
                    name={key}
                    render={({ field }) => (
                      <FormItem className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_11rem] sm:items-start sm:gap-4">
                        <div className="min-w-0">
                          <FormLabel className="text-sm font-bold text-foreground">{t(`policy.${key}.label`)}</FormLabel>
                          <FormDescription className="text-[11px] leading-relaxed">{t(`policy.${key}.desc`)}</FormDescription>
                        </div>
                        <div>
                          <FormControl>
                            <div className="relative">
                              <Input
                                {...field}
                                type="number"
                                inputMode="decimal"
                                min={0}
                                step={unit === "sar" ? 100 : 1}
                                disabled={!mayEdit}
                                placeholder={fmtRef(key, unit)}
                                className="h-10 pe-14 text-end tabular-nums"
                                dir="ltr"
                                value={field.value ?? ""}
                              />
                              <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-[11px] font-semibold text-muted-foreground">{t(`unit.${unit}`)}</span>
                            </div>
                          </FormControl>
                          <p className="mt-1 text-[10px] text-muted-foreground" dir="auto">
                            {t("policies.reference", { value: fmtRef(key, unit) })}
                          </p>
                          <FormMessage className="text-[11px]" />
                        </div>
                      </FormItem>
                    )}
                  />
                ))}
                <FormField
                  control={form.control}
                  name="sealOffersUntilDeadline"
                  render={({ field }) => (
                    <FormItem className="flex items-start justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <FormLabel className="text-sm font-bold text-foreground">{t("policy.sealOffersUntilDeadline.label")}</FormLabel>
                        <FormDescription className="text-[11px] leading-relaxed">{t("policy.sealOffersUntilDeadline.desc")}</FormDescription>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!mayEdit} aria-label={t("policy.sealOffersUntilDeadline.label")} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                {mayEdit && (
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/20 px-4 py-3">
                    <p className="text-[11px] text-muted-foreground">{t("policies.enforced")}</p>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="ghost" size="sm" disabled={!form.formState.isDirty || saving} onClick={() => form.reset(policies)}>
                        {t("discard")}
                      </Button>
                      <Button type="submit" size="sm" className="gap-1.5" disabled={!form.formState.isDirty || saving}>
                        {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                        {t("save")}
                      </Button>
                    </div>
                  </div>
                )}
              </form>
            </Form>
          </Section>

          <div className="space-y-4">
            {/* ── Roles — read-only; the team page grants them ── */}
            <Section
              title={t("roles.title")}
              subtitle={t("roles.subtitle")}
              icon={Users}
              action={
                <Link href="/contractor/team" className="rounded-sm text-xs font-semibold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t("roles.teamLink")}
                </Link>
              }
            >
              <ul className="divide-y">
                {ROLES.map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-foreground">{t(`roles.${r.id}.name`)}</span>
                      <span className="ms-auto rounded-md bg-module/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-module" dir="ltr">
                        {r.permission ?? t("roles.ownerBadge")}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground" dir="auto">
                      {t(`roles.${r.id}.desc`, { limit: sarLtr(policies.managerApprovalLimit.toLocaleString("en-US")) })}
                    </p>
                    {r.permission && <p className="mt-0.5 text-[10px] text-muted-foreground/80">{tShared(`perm_${r.permission.replace(".", "_")}`)}</p>}
                  </li>
                ))}
              </ul>
              <p className="border-t px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground" dir="auto">
                {t("roles.prices")}
              </p>
            </Section>

            {/* ── Boundaries — what we own, read, and never do ── */}
            <Section title={t("boundaries.title")} subtitle={t("boundaries.subtitle")} icon={BookOpen}>
              <div className="grid gap-px bg-border sm:grid-cols-3 lg:grid-cols-1">
                {BOUNDARY_LISTS.map(({ id, icon: Icon, tone, count }) => (
                  <div key={id} className="bg-white px-4 py-3">
                    <h3 className={cn("flex items-center gap-1.5 text-xs font-black", tone)}>
                      <Icon size={13} aria-hidden="true" />
                      {t(`boundaries.${id}.title`)}
                    </h3>
                    <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-foreground">
                      {Array.from({ length: count }, (_, i) => (
                        <li key={i} className="flex gap-1.5" dir="auto">
                          <span className={cn("mt-1.5 h-1 w-1 shrink-0 rounded-full bg-current", tone)} aria-hidden="true" />
                          <span>{t(`boundaries.${id}.item${i + 1}`)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, subtitle, icon: Icon, action, children }: { title: string; subtitle: string; icon: ElementType; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-white">
      <header className="flex items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-black text-foreground">
            <Icon size={15} className="shrink-0 text-module" aria-hidden="true" />
            {title}
          </h2>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{subtitle}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}
