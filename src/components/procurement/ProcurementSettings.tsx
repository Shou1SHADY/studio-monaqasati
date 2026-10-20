"use client"

// الحدود والربط — Procurement's boundary with every other module (PRD 3.0
// §7.2, tab 8), in four segments: the purchase path (nine steps, one owner
// each, and the two ideas the module stands on), the integration contract
// (what reaches us, what we send, what happens when the other side is late),
// the policies and the roles, and what we never do, what is not built yet,
// where the modules disagree and what crossed the boundary lately.
//
// The policies are the numbers the rules gate money with: a limit is a number
// that blocks for real, and this form is its reflection. Each carries the chip
// of the module that owns it. `resolvePolicies` sanitises before the write so a
// blank or a negative never reaches the document. Saved as
// `procurementSettings/{orgId}` by the owner or whoever approves orders; every
// other member reads the same form, disabled.

import type { ElementType, ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { collection, doc, query, serverTimestamp, setDoc, where } from "firebase/firestore"
import { Check, Loader2, Lock, Minus, PackageCheck, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Link } from "@/i18n/routing"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { ReceiverRegister } from "@/components/procurement/ReceiverRegister"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { DeliverySitesPanel } from "@/components/procurement/DeliverySitesPanel"
import { useModules } from "@/hooks/useCompanyModules"
import { deliverySites, storedSites } from "@/lib/procurement/delivery-sites"
import { ROLE_COLUMNS, roleRows } from "@/lib/procurement/roles-matrix"
import { useProcReceivers } from "@/hooks/useProcReceivers"
import type { BoundaryParty } from "@/lib/procurement/boundary"
import { DEFAULT_RESOLVED_POLICIES, NOTICE_ROUTINGS, POLICY_OWNER, resolvePolicies, type PolicyOwner, type ResolvedPolicies } from "@/lib/procurement/policies"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

type Unit = "sar" | "percent" | "count" | "days"
type NumericKey = Exclude<keyof ResolvedPolicies, "sealOffersUntilDeadline" | "sendOnApproval" | "buyerReceives" | "noticeRouting" | "ownerStepsBack">
type SwitchKey = "sealOffersUntilDeadline" | "buyerReceives" | "sendOnApproval" | "ownerStepsBack"
type Row = { kind: "number"; key: NumericKey; unit: Unit } | { kind: "switch"; key: SwitchKey } | { kind: "routing" }

/** The prototype's order: what shapes a quote, then the receipt, then money, then the clocks. */
const ROWS: Row[] = [
  { kind: "switch", key: "sealOffersUntilDeadline" },
  { kind: "routing" },
  { kind: "number", key: "forwardWindowDays", unit: "days" },
  { kind: "switch", key: "buyerReceives" },
  { kind: "number", key: "directPurchaseCap", unit: "sar" },
  { kind: "number", key: "competitionThreshold", unit: "sar" },
  { kind: "number", key: "minOffers", unit: "count" },
  { kind: "number", key: "managerApprovalLimit", unit: "sar" },
  { kind: "number", key: "buyerSelfIssueLimit", unit: "sar" },
  { kind: "number", key: "replyWindowDays", unit: "days" },
  { kind: "number", key: "overReceiptTolerancePercent", unit: "percent" },
  { kind: "number", key: "rfqWindowDays", unit: "days" },
  { kind: "number", key: "awardCycleDays", unit: "days" },
  { kind: "number", key: "supplierAcceptanceDays", unit: "days" },
  { kind: "number", key: "splitWindowDays", unit: "days" },
  { kind: "switch", key: "sendOnApproval" },
  // Procurement 1.5, question 1: the owner holds every act unless he steps back himself.
  { kind: "switch", key: "ownerStepsBack" },
]

const nonNegative = z.coerce.number().min(0)
const days = z.coerce.number().int().min(0)
const schema = z.object({
  managerApprovalLimit: nonNegative,
  directPurchaseCap: nonNegative,
  competitionThreshold: nonNegative,
  buyerSelfIssueLimit: nonNegative,
  minOffers: z.coerce.number().int().min(1),
  overReceiptTolerancePercent: z.coerce.number().min(0).max(100),
  rfqWindowDays: days,
  awardCycleDays: days,
  supplierAcceptanceDays: days,
  splitWindowDays: days,
  forwardWindowDays: days,
  replyWindowDays: days,
  sealOffersUntilDeadline: z.boolean(),
  sendOnApproval: z.boolean(),
  buyerReceives: z.boolean(),
  ownerStepsBack: z.boolean(),
  noticeRouting: z.enum(NOTICE_ROUTINGS),
})
type FormValues = z.infer<typeof schema>

// Procurement 1.5 (PUR-08): only what the customer sets — in his words, no programme keys. The developers'
// pages (the purchase path, «الفكرتان», the links with other modules, «لم يُبنَ · التعارضات · السجل») moved to
// the team's documents (docs/procurement-boundaries.md).
type Segment = "pol" | "sites" | "receivers" | "roles"
const SEGMENTS: Segment[] = ["pol", "sites", "receivers", "roles"]

type Party = BoundaryParty | "me" | "gov"
const PARTY_TONE: Record<Party, string> = {
  pm: "bg-pm/10 text-pm",
  mfg: "bg-warning/10 text-warning",
  inv: "bg-cta/10 text-cta",
  fin: "bg-success/10 text-success",
  sup: "bg-accent/15 text-foreground",
  gov: "bg-muted text-muted-foreground",
  me: "bg-module/10 text-module",
}
const OWNER_PARTY: Record<PolicyOwner, Party> = { gov: "gov", fin: "fin", inv: "inv" }

const OWNER_ONLY_POLICIES = new Set<string>(["managerApprovalLimit", "buyerSelfIssueLimit", "directPurchaseCap", "overReceiptTolerancePercent", "ownerStepsBack"])

export function ProcurementSettings() {
  const t = useTranslations("Portal.ProcSettings")
  const tRcv = useTranslations("Portal.ProcReceivers")
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const { actor, orgId, policies: worldPolicies, loading } = useProcurementWorld()
  const policies = useMemo(() => resolvePolicies(worldPolicies), [worldPolicies])
  const mayEdit = actor.isOwner || actor.canApprove
  // The limits that bound the approver himself are the owner's alone (the rules say so too).
  const lockedFor = (key: string) => !mayEdit || (OWNER_ONLY_POLICIES.has(key) && !actor.isOwner)
  // The receiver register (§4 `RCVR`) lives here because it is a standing setting,
  // not a per-delivery decision. Signing for goods is not enough to keep it.
  const { receivers } = useProcReceivers(orgId)
  const warehousesQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: warehouseDocs } = useCollection<{ name?: string }>(warehousesQuery)
  const mayEditReceivers = actor.isOwner || actor.canPrepare || actor.canApprove
  // What the package holds decides what the roles and the policies say (PUR-10).
  const { on } = useModules()
  const financeOn = on("payments")
  const pmOn = on("project-management")
  const roleRowsNow = useMemo(() => roleRows({ financeOn, pmOn, ownerStepsBack: policies.ownerStepsBack }), [financeOn, pmOn, policies.ownerStepsBack])
  // «مواقع التسليم»: the stored ones, the warehouses, and with Project Management the projects.
  const settingsRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, PROCUREMENT_SETTINGS, orgId) : null), [firestore, orgId])
  const { data: settingsDoc } = useDoc(settingsRef)
  const projectsQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: projectDocs } = useCollection<{ name?: string; location?: string | null }>(projectsQuery)
  const storedSiteList = useMemo(() => storedSites((settingsDoc as { deliverySites?: unknown } | null)?.deliverySites), [settingsDoc])
  const siteList = useMemo(
    () => deliverySites({ stored: storedSiteList, warehouses: (warehouseDocs || []) as Array<{ id: string; name?: string; projectId?: string | null }>, projects: (projectDocs || []) as Array<{ id: string; name?: string; location?: string | null }>, pmOn }),
    [storedSiteList, warehouseDocs, projectDocs, pmOn]
  )
  const [saving, setSaving] = useState(false)
  const [segment, setSegment] = useState<Segment>("pol")

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: policies })
  // The document arrives after the first render: seed the form once it does,
  // and never over a form the member has started editing.
  useEffect(() => {
    if (!loading && !form.formState.isDirty) form.reset(policies)
  }, [loading, policies, form])

  const fmtRef = (key: NumericKey, unit: Unit) => {
    const v = DEFAULT_RESOLVED_POLICIES[key]
    if (unit === "sar") return sarLtr(v.toLocaleString("en-US"))
    if (unit === "percent") return `${v}%`
    return v.toLocaleString("en-US")
  }
  const onSubmit = async (values: FormValues) => {
    if (!firestore || !orgId || !user || !mayEdit) return
    setSaving(true)
    try {
      const clean = resolvePolicies(values)
      const written: Record<string, unknown> = { ...clean }
      if (!actor.isOwner) OWNER_ONLY_POLICIES.forEach((k) => delete written[k])
      await setDoc(doc(firestore, PROCUREMENT_SETTINGS, orgId), { ...written, organizationId: orgId, updatedAt: serverTimestamp(), updatedById: user.uid }, { merge: true })
      form.reset(clean)
      toast({ title: t("saved") })
    } catch (err) {
      console.error(err)
      toast({ title: t("saveFailed"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  // Without Finance in the package the approval limit is Procurement's own setting (PUR-10): no «من المالية».
  const ownerOf = (key: keyof ResolvedPolicies): PolicyOwner => (POLICY_OWNER[key] === "fin" && !financeOn ? "gov" : POLICY_OWNER[key])
  const ownerChip = (key: keyof ResolvedPolicies) => <PartyChip party={OWNER_PARTY[ownerOf(key)]} label={t(`owner.${ownerOf(key)}`)} />
  // «بريد المحاسب» (PUR-10): without Finance, the supplier's invoice file and the export go to the company's accountant.
  const storedAccountant = String((settingsDoc as { accountantEmail?: unknown } | null)?.accountantEmail || "")
  const [accountant, setAccountant] = useState<string | null>(null)
  const accountantValue = accountant ?? storedAccountant
  const saveAccountant = async () => {
    if (!firestore || !orgId || !mayEdit) return
    const v = accountantValue.trim().toLowerCase()
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      toast({ title: t("accountant.invalid"), variant: "destructive" })
      return
    }
    try {
      await setDoc(doc(firestore, PROCUREMENT_SETTINGS, orgId), { organizationId: orgId, accountantEmail: v || null, updatedAt: serverTimestamp() }, { merge: true })
      setAccountant(null)
      toast({ title: t("saved") })
    } catch {
      toast({ title: t("saveFailed"), variant: "destructive" })
    }
  }

  return (
    <div className="space-y-6">
      <ProcurementHeader title={t("page.title")} description={t("page.subtitle")} />

      {loading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} aria-hidden="true" />
        </div>
      ) : (
        <>
          <ProcChipGroup items={SEGMENTS.map((id) => ({ id, label: t(`segment.${id}`) }))} active={segment} onPick={setSegment} label={t("page.title")} />

          {/* ── 3 · Policies & roles ── */}
          {segment === "pol" && (
            <>
              <div className="grid items-start gap-4">
                <Section title={t("polPanel.title")} subtitle={t("polPanel.sub")}>
                  {!mayEdit && (
                    <p className="flex items-center gap-1.5 border-b px-4 py-2 text-[11px] text-muted-foreground">
                      <Lock size={11} aria-hidden="true" />
                      {t("policies.readOnly")}
                    </p>
                  )}
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="divide-y">
                      {/* Whoever never sees an amount (the expediter) never reads a riyal limit either. */}
                      {ROWS.filter((row) => actor.seesPrices || row.kind !== "number" || row.unit !== "sar").map((row) => {
                        if (row.kind === "routing")
                          return (
                            <FormField
                              key="noticeRouting"
                              control={form.control}
                              name="noticeRouting"
                              render={({ field }) => (
                                <FormItem className="grid gap-2 px-4 py-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <FormLabel className="text-sm font-bold text-foreground">{t("policy.noticeRouting.label")}</FormLabel>
                                    {ownerChip("noticeRouting")}
                                  </div>
                                  <FormDescription className="text-[11px] leading-relaxed">{t("policy.noticeRouting.desc")}</FormDescription>
                                  <FormControl>
                                    <div role="radiogroup" aria-label={t("policy.noticeRouting.label")} className="inline-flex flex-wrap gap-1 rounded-xl border bg-card p-1">
                                      {NOTICE_ROUTINGS.map((r) => (
                                        <button
                                          key={r}
                                          type="button"
                                          role="radio"
                                          aria-checked={field.value === r}
                                          disabled={!mayEdit}
                                          onClick={() => field.onChange(r)}
                                          className={cn(
                                            "min-h-9 rounded-lg px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                                            field.value === r ? "bg-module/10 text-module" : "text-muted-foreground hover:text-foreground"
                                          )}
                                        >
                                          {t(`policy.noticeRouting.${r}`)}
                                        </button>
                                      ))}
                                    </div>
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          )
                        if (row.kind === "switch")
                          return (
                            <FormField
                              key={row.key}
                              control={form.control}
                              name={row.key}
                              render={({ field }) => (
                                <FormItem className="flex items-start justify-between gap-4 px-4 py-3">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <FormLabel className="text-sm font-bold text-foreground">{t(`policy.${row.key}.label`)}</FormLabel>
                                      {ownerChip(row.key)}
                                    </div>
                                    <FormDescription className="mt-1 text-[11px] leading-relaxed">{t(field.value ? `policy.${row.key}.descOn` : `policy.${row.key}.desc`)}</FormDescription>
                                  </div>
                                  <FormControl>
                                    <Switch checked={field.value} onCheckedChange={field.onChange} disabled={lockedFor(row.key)} aria-label={t(`policy.${row.key}.label`)} />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          )
                        const { key, unit } = row
                        return (
                          <FormField
                            key={key}
                            control={form.control}
                            name={key}
                            render={({ field }) => (
                              <FormItem className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_11rem] sm:items-start sm:gap-4">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <FormLabel className="text-sm font-bold text-foreground">{t(`policy.${key}.label`)}</FormLabel>
                                    {ownerChip(key)}
                                  </div>
                                  <FormDescription className="mt-1 text-[11px] leading-relaxed">{t(`policy.${key}.desc`)}</FormDescription>
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
                                        disabled={lockedFor(key)}
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
                        )
                      })}
                      {!financeOn && (
                        <div className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_16rem] sm:items-start sm:gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-foreground">{t("accountant.label")}</p>
                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("accountant.desc")}</p>
                          </div>
                          <div className="flex gap-2">
                            <Input type="email" dir="ltr" value={accountantValue} onChange={(e) => setAccountant(e.target.value)} disabled={!mayEdit} aria-label={t("accountant.label")} placeholder="accountant@company.sa" className="h-10" />
                            {mayEdit && accountant != null && accountant !== storedAccountant && (
                              <Button type="button" size="sm" className="h-10" onClick={() => void saveAccountant()}>
                                {t("save")}
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
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

              </div>
            </>
          )}


          {segment === "sites" && <DeliverySitesPanel orgId={orgId} stored={storedSiteList} sites={siteList} receivers={receivers} mayEdit={mayEdit} openRequests={() => 0} />}

          {segment === "receivers" && (
            <Section title={tRcv("title")} subtitle={tRcv("subtitle")} icon={PackageCheck}>
              <ReceiverRegister receivers={receivers} warehouses={(warehouseDocs || []).map((w) => ({ id: w.id, name: w.name || w.id }))} actor={actor} orgId={orgId} mayEdit={mayEditReceivers} />
            </Section>
          )}

          {segment === "roles" && (
            <Section
              title={t("roles.title")}
              subtitle={t("roles2.sub")}
              action={
                <Link href="/contractor/team" className="rounded-sm text-xs font-semibold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {t("roles.teamLink")}
                </Link>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-[12.5px]">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th scope="col" className="px-3 py-3 text-start font-semibold">
                        {t("roles2.what")}
                      </th>
                      {ROLE_COLUMNS.map((r) => (
                        <th key={r} scope="col" className="px-2 py-3 text-center align-bottom font-semibold text-foreground">
                          {t(`roles2.col_${r}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {roleRowsNow.map((row) => (
                      <tr key={row.id} className="border-t">
                        <th scope="row" className="px-3 py-2.5 text-start font-medium text-foreground">
                          {t(`roles2.row_${row.id}`)}
                        </th>
                        {ROLE_COLUMNS.map((r) => (
                          <td key={r} className="px-2 py-2.5 text-center">
                            {row.cells[r] === "limit" && actor.seesPrices ? (
                              <span className="text-xs font-semibold tabular-nums" dir="ltr">
                                {t("roles2.up_to", { limit: policies.managerApprovalLimit.toLocaleString("en-US") })}
                              </span>
                            ) : (
                              <Mark yes={row.cells[r] === true || row.cells[r] === "limit"} yesLabel={t("matrix.yes")} noLabel={t("matrix.no")} />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground" dir="auto">
                {t(financeOn ? "roles2.foot_fin" : "roles2.foot_nofin")}
              </p>
            </Section>
          )}
        </>
      )}
    </div>
  )
}

function PartyChip({ party, label }: { party: Party; label: string }) {
  return <span className={cn("inline-flex shrink-0 self-start whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold", PARTY_TONE[party])}>{label}</span>
}

function Mark({ yes, yesLabel, noLabel }: { yes: boolean; yesLabel: string; noLabel: string }) {
  return yes ? (
    <span className="inline-flex text-success">
      <Check size={15} aria-hidden="true" />
      <span className="sr-only">{yesLabel}</span>
    </span>
  ) : (
    <span className="inline-flex text-muted-foreground/60">
      <Minus size={15} aria-hidden="true" />
      <span className="sr-only">{noLabel}</span>
    </span>
  )
}



function Section({ title, subtitle, icon: Icon, action, children }: { title: string; subtitle?: string; icon?: ElementType; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border bg-card">
      <header className="flex items-start justify-between gap-3 border-b px-4 py-3.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-black text-foreground">
            {Icon && <Icon size={15} className="shrink-0 text-module" aria-hidden="true" />}
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}
