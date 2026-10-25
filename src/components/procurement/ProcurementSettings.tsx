"use client"

// Settings (Procurement 2.0 §6.4): the policies, the delivery sites, the receivers and the roles.
//
// A policy is a number or a switch the rules and the screens gate money and time with: this form is its reflection. Each row
// carries the chip of the module that owns it and is named in the customer's words. `resolvePolicies` sanitises before the
// write so a blank or a negative never reaches the document. The policies are the OWNER's alone (the rules say so too);
// whoever approves orders keeps the delivery sites and the receivers, and every other member reads the same form, disabled.

import type { ElementType, ReactNode } from "react"
import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { useForm, useWatch, type UseFormReturn } from "react-hook-form"
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
import { SubscriptionPanel } from "@/components/procurement/SubscriptionPanel"
import { UNIT_CHIP } from "@/components/admin/packages/PackageIcons"
import { useModules } from "@/hooks/useCompanyModules"
import { deliverySites, storedSites } from "@/lib/procurement/delivery-sites"
import { openRequestsBySite } from "@/lib/procurement/site-counts"
import { useProcurementNeeds } from "@/hooks/useProcurementNeeds"
import { roleColumns, roleRows, type RoleCell, type RoleRowId } from "@/lib/procurement/roles-matrix"
import { useProcReceivers } from "@/hooks/useProcReceivers"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { DEFAULT_RESOLVED_POLICIES, POLICY_OWNER, policyPatch, resolvePolicies, type PolicyOwner, type ResolvedPolicies } from "@/lib/procurement/policies"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"
import { releaseTeamApprovals } from "@/lib/procurement/team-approval-client"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

type Unit = "sar" | "percent" | "count" | "days"
type SwitchKey = "sendOnApproval" | "ownerStepsBack" | "advanceUnknownSupplierOwner" | "teamApproval"
// The receiver alone counts and confirms (G-09): the 1.5 receiving policies are not offered here.
type NumericKey = { [K in keyof ResolvedPolicies]: ResolvedPolicies[K] extends number ? K : never }[keyof ResolvedPolicies]
type PairId = "cycle" | "competition" | "direct"
type Row =
  | { kind: "number"; key: NumericKey; unit: Unit }
  | { kind: "switch"; key: SwitchKey }
  | { kind: "pair"; id: PairId; keys: [NumericKey, NumericKey]; units: [Unit, Unit] }
  | { kind: "fixed"; id: "offerVisibility" | "awardBeforeDeadline"; owner: PolicyOwner }

/** The prototype's order (§6.4): what shapes a quote, the clocks of buying, the limits, then the receipt. */
const ROWS: Row[] = [
  { kind: "fixed", id: "offerVisibility", owner: "gov" },
  { kind: "fixed", id: "awardBeforeDeadline", owner: "gov" },
  // REQ-05 (optional, off): a team «طلب مواد» waits for the owner or the site's manager before Procurement — without Projects only.
  { kind: "switch", key: "teamApproval" },
  { kind: "number", key: "forwardWindowDays", unit: "days" },
  { kind: "number", key: "rfqDefaultDays", unit: "days" },
  { kind: "pair", id: "cycle", keys: ["rfqWindowDays", "awardCycleDays"], units: ["days", "days"] },
  { kind: "number", key: "supplyLeadDays", unit: "days" },
  { kind: "number", key: "supplierAcceptanceDays", unit: "days" },
  { kind: "number", key: "escalateAfterDays", unit: "days" },
  { kind: "number", key: "tieBandPct", unit: "percent" },
  { kind: "pair", id: "competition", keys: ["competitionThreshold", "minOffers"], units: ["sar", "count"] },
  { kind: "pair", id: "direct", keys: ["directPurchaseCap", "splitWindowDays"], units: ["sar", "days"] },
  { kind: "number", key: "managerApprovalLimit", unit: "sar" },
  { kind: "switch", key: "advanceUnknownSupplierOwner" },
  { kind: "number", key: "buyerSelfIssueLimit", unit: "sar" },
  { kind: "number", key: "inventoryReplyDays", unit: "days" },
  { kind: "number", key: "overReceiptTolerancePercent", unit: "percent" },
  { kind: "number", key: "workshopReplyDays", unit: "days" },
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
  inventoryReplyDays: days,
  workshopReplyDays: days,
  rfqDefaultDays: days,
  supplyLeadDays: days,
  escalateAfterDays: z.coerce.number().int().min(1),
  tieBandPct: z.coerce.number().min(0).max(100),
  sendOnApproval: z.boolean(),
  ownerStepsBack: z.boolean(),
  advanceUnknownSupplierOwner: z.boolean(),
  teamApproval: z.boolean(),
})
type FormValues = z.infer<typeof schema>
/** The keys the form owns — the only ones a save writes (ST-01). */
const FORM_KEYS = schema.keyof().options

/** «مسار إشعار التسليم» (ST-01): not a form field — fixed in 2.0 (it reaches Procurement first); a 1.5 company that chose «both»
 * sees it and may switch back. Shown where the prototype puts it, just before the auto-forward row. */
type ShownRow = Row | { kind: "notice" }
const withNoticeRow = (rows: Row[]): ShownRow[] => rows.flatMap((row): ShownRow[] => (row.kind === "number" && row.key === "forwardWindowDays" ? [{ kind: "notice" }, row] : [row]))

// Procurement 1.5 (PUR-08): only what the customer sets — in his words, no programme keys. The developers'
// pages (the purchase path, «الفكرتان», the links with other modules, «لم يُبنَ · التعارضات · السجل») moved to
// the team's documents (docs/procurement-boundaries.md).
type Segment = "pol" | "sites" | "receivers" | "roles" | "sub"
const SEGMENTS: Segment[] = ["pol", "sites", "receivers", "roles", "sub"]
/** The reference prototype's names for the same segments (`loc`, `rcv`) — a link written with them opens the right one, not Policies. */
const SEGMENT_ALIAS: Record<string, Segment> = { loc: "sites", rcv: "receivers" }
export const segmentOf = (asked: string | null | undefined): Segment => SEGMENTS.find((id) => id === asked) ?? (asked ? SEGMENT_ALIAS[asked] : undefined) ?? "pol"

type Party = "pm" | "mfg" | "inv" | "fin" | "sup" | "me" | "gov"
// One colour per unit everywhere (ST-05): the module chips take the unit's token from the package icons.
const PARTY_TONE: Record<Party, string> = {
  pm: UNIT_CHIP.pm,
  mfg: UNIT_CHIP.mfg,
  inv: UNIT_CHIP.inv,
  fin: UNIT_CHIP.fin,
  sup: "bg-accent/15 text-foreground",
  gov: "bg-muted text-muted-foreground",
  me: "bg-module/10 text-module",
}
const OWNER_PARTY: Record<PolicyOwner, Party> = { gov: "gov", fin: "fin", inv: "inv", mfg: "mfg" }

export function ProcurementSettings() {
  const t = useTranslations("Portal.ProcSettings")
  const tRcv = useTranslations("Portal.ProcReceivers")
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const procWorld = useProcurementWorld()
  const { actor, orgId, policies: worldPolicies, loading } = procWorld
  const policies = useMemo(() => resolvePolicies(worldPolicies), [worldPolicies])
  // The policies are the owner's alone; the delivery sites and the receivers are also the approver's (PRD §4, the rules say so too).
  const mayEdit = actor.isOwner
  const mayEditSites = actor.isOwner || actor.canApprove
  // The receiver register (§4 `RCVR`) lives here because it is a standing setting,
  // not a per-delivery decision. Signing for goods is not enough to keep it.
  const { receivers } = useProcReceivers(orgId)
  const warehousesQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: warehouseDocs } = useCollection<{ name?: string }>(warehousesQuery)
  const mayEditReceivers = mayEditSites
  // What the package holds decides what the roles and the policies say (PUR-10).
  const { on } = useModules()
  const financeOn = on("payments")
  const pmOn = on("project-management")
  const mfgOn = on("manufacturing")
  // Without Projects a site may name its manager (he approves the team's requests there when the policy is on).
  const { orgMembers } = useOrgMembers(orgId && !pmOn ? orgId : null)
  const siteMembers = useMemo(() => orgMembers.map((m) => ({ id: m.id, name: String(m.name || m.email || m.id) })), [orgMembers])
  const roleRowsNow = useMemo(() => roleRows({ financeOn, pmOn, mfgOn, ownerStepsBack: policies.ownerStepsBack }), [financeOn, pmOn, mfgOn, policies.ownerStepsBack])
  const roleColumnsNow = useMemo(() => roleColumns({ pmOn }), [pmOn])
  // «مواقع التسليم»: the stored ones, the warehouses, and with Project Management the projects.
  const settingsRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, PROCUREMENT_SETTINGS, orgId) : null), [firestore, orgId])
  const { data: settingsDoc } = useDoc(settingsRef)
  const projectsQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "projects"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: projectDocs } = useCollection<{ name?: string; location?: string | null }>(projectsQuery)
  const storedSiteList = useMemo(() => storedSites((settingsDoc as { deliverySites?: unknown } | null)?.deliverySites), [settingsDoc])
  const siteList = useMemo(
    () => deliverySites({ stored: storedSiteList, warehouses: (warehouseDocs || []) as Array<{ id: string; name?: string; projectId?: string | null }>, projects: (projectDocs || []) as Array<{ id: string; name?: string; location?: string | null }>, pmOn, mfgOn }),
    [storedSiteList, warehouseDocs, projectDocs, pmOn, mfgOn]
  )
  // The requests still open at each site: the team's «طلب مواد» naming it, or its project's (PUR-10).
  const { needs } = useProcurementNeeds(procWorld)
  const openBySite = useMemo(() => openRequestsBySite(needs, siteList), [needs, siteList])
  const [saving, setSaving] = useState(false)
  // The top bar's package chip opens «الاشتراك» directly (`?seg=sub`, FR-04).
  const searchParams = useSearchParams()
  const [segment, setSegment] = useState<Segment>(() => segmentOf(searchParams?.get("seg")))

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: policies })
  const tiePct = useWatch({ control: form.control, name: "tieBandPct" })
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
      const clean = policyPatch(values, FORM_KEYS)
      await setDoc(doc(firestore, PROCUREMENT_SETTINGS, orgId), { ...clean, organizationId: orgId, updatedAt: serverTimestamp(), updatedById: user.uid }, { merge: true })
      // Turning the team approval off releases whatever waits straight to Incoming (the server checks the stored policy is off).
      if (policies.teamApproval && !clean.teamApproval) await releaseTeamApprovals().catch(() => undefined)
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
    if (!firestore || !orgId || !mayEditSites) return
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

  // A company that chose «both» before 2.0 keeps it until the owner switches back — one write of that key alone.
  const [routingBusy, setRoutingBusy] = useState(false)
  const routeToProcurement = async () => {
    if (!firestore || !orgId || !user || !mayEdit) return
    setRoutingBusy(true)
    try {
      await setDoc(doc(firestore, PROCUREMENT_SETTINGS, orgId), { organizationId: orgId, noticeRouting: "procurement", updatedAt: serverTimestamp(), updatedById: user.uid }, { merge: true })
      toast({ title: t("saved") })
    } catch (err) {
      console.error(err)
      toast({ title: t("saveFailed"), variant: "destructive" })
    } finally {
      setRoutingBusy(false)
    }
  }

  const rowVisible = (row: Row): boolean => {
    if (row.kind === "fixed" || row.kind === "switch") return true
    const keys: NumericKey[] = row.kind === "pair" ? row.keys : [row.key]
    const units: Unit[] = row.kind === "pair" ? row.units : [row.unit]
    if (units.includes("sar") && !actor.seesPrices) return false
    return !keys.includes("workshopReplyDays") || mfgOn
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
          <ProcChipGroup items={SEGMENTS.filter((id) => id !== "sub" || mayEditSites).map((id) => ({ id, label: t(`segment.${id}`) }))} active={segment} onPick={setSegment} label={t("page.title")} />

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
                      {withNoticeRow(ROWS.filter((row) => rowVisible(row))).map((row) => {
                        if (row.kind === "notice")
                          return (
                            <div key="noticeRouting" className="grid gap-1 px-4 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-bold text-foreground">{t("policy.noticeRouting.label")}</p>
                                {ownerChip("noticeRouting")}
                              </div>
                              <p className="text-[11px] leading-relaxed text-muted-foreground">{t("policy.noticeRouting.desc")}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                <p className="text-xs font-semibold text-foreground">{t(`policy.noticeRouting.${policies.noticeRouting}`)}</p>
                                {policies.noticeRouting === "both" && (
                                  <>
                                    <span className="text-[11px] text-muted-foreground">{t("policy.noticeRouting.legacy")}</span>
                                    {mayEdit && (
                                      <Button type="button" variant="outline" size="sm" className="h-8" disabled={routingBusy} onClick={() => void routeToProcurement()}>
                                        {t("policy.noticeRouting.back")}
                                      </Button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        if (row.kind === "fixed")
                          return (
                            <div key={row.id} className="grid gap-1 px-4 py-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-bold text-foreground">{t(`policy.${row.id}.label`)}</p>
                                <PartyChip party={OWNER_PARTY[row.owner]} label={t(`owner.${row.owner}`)} />
                              </div>
                              <p className="text-[11px] leading-relaxed text-muted-foreground">{t(`policy.${row.id}.desc`)}</p>
                            </div>
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
                                    <FormDescription className="mt-1 text-[11px] leading-relaxed">{t(row.key === "teamApproval" && pmOn ? "policy.teamApproval.descPm" : field.value ? `policy.${row.key}.descOn` : `policy.${row.key}.desc`)}</FormDescription>
                                  </div>
                                  <FormControl>
                                    <Switch checked={field.value} onCheckedChange={field.onChange} disabled={!mayEdit || (row.key === "teamApproval" && pmOn)} aria-label={t(`policy.${row.key}.label`)} />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          )
                        if (row.kind === "pair")
                          return (
                            <div key={row.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_18rem] sm:items-start sm:gap-4">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-bold text-foreground">{t(`policy.${row.id}.label`)}</p>
                                  {ownerChip(row.keys[0])}
                                </div>
                                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t(`policy.${row.id}.desc`)}</p>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                {row.keys.map((key, i) => (
                                  <NumberField key={key} form={form} name={key} unit={row.units[i]} label={t(`policy.${row.id}.${i === 0 ? "a" : "b"}`)} disabled={!mayEdit} placeholder={fmtRef(key, row.units[i])} unitLabel={t(`unit.${row.units[i]}`)} />
                                ))}
                              </div>
                            </div>
                          )
                        const { key, unit } = row
                        return (
                          <div key={key} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_11rem] sm:items-start sm:gap-4">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-bold text-foreground">{t(`policy.${key}.label`)}</p>
                                {ownerChip(key)}
                              </div>
                              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t(`policy.${key}.desc`, { pct: String(Number(tiePct) || 0) })}</p>
                            </div>
                            <div>
                              <NumberField form={form} name={key} unit={unit} label={t(`policy.${key}.label`)} hideLabel disabled={!mayEdit} placeholder={fmtRef(key, unit)} unitLabel={t(`unit.${unit}`)} />
                              <p className="mt-1 text-[10px] text-muted-foreground" dir="auto">
                                {t("policies.reference", { value: fmtRef(key, unit) })}
                              </p>
                            </div>
                          </div>
                        )
                      })}
                      {!financeOn && (
                        <div className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_16rem] sm:items-start sm:gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-foreground">{t("accountant.label")}</p>
                            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("accountant.desc")}</p>
                          </div>
                          <div className="flex gap-2">
                            <Input type="email" dir="ltr" value={accountantValue} onChange={(e) => setAccountant(e.target.value)} disabled={!mayEditSites} aria-label={t("accountant.label")} placeholder="accountant@company.sa" className="h-10" />
                            {!accountantValue && <span className="self-center text-[11px] text-muted-foreground">{t("accountant.empty")}</span>}
                            {mayEditSites && accountant != null && accountant !== storedAccountant && (
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


          {segment === "sites" && <DeliverySitesPanel stored={storedSiteList} sites={siteList} receivers={receivers} mayEdit={mayEditSites} openRequests={(id) => openBySite[id] ?? 0} pmOn={pmOn} mfgOn={mfgOn} projects={(projectDocs || []) as Array<{ id: string; name?: string }>} members={pmOn ? undefined : siteMembers} />}

          {segment === "sub" && mayEditSites && <SubscriptionPanel />}

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
                      {roleColumnsNow.map((r) => (
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
                          {ROW_PILL[row.id] && <span className="ms-2 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">{t(`roles2.pill_${ROW_PILL[row.id]}`)}</span>}
                        </th>
                        {roleColumnsNow.map((r) => (
                          <td key={r} className="px-2 py-2.5 text-center">
                            <RoleMark cell={row.cells[r]} limit={actor.seesPrices ? policies.managerApprovalLimit : null} t={t} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="border-t px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground" dir="auto">
                {t("roles2.foot")}
              </p>
            </Section>
          )}
        </>
      )}
    </div>
  )
}

const ROW_PILL: Partial<Record<RoleRowId, "nofin" | "nopm" | "mfg">> = { mark_paid: "nofin", raise_request: "nopm", ask_workshop: "mfg" }

function RoleMark({ cell, limit, t }: { cell: RoleCell; limit: number | null; t: (key: string, values?: Record<string, string | number>) => string }) {
  if (cell === "limit" && limit != null)
    return (
      <span className="text-xs font-semibold tabular-nums" dir="ltr">
        {t("roles2.up_to", { limit: limit.toLocaleString("en-US") })}
      </span>
    )
  if (cell === "sites") return <span className="text-xs font-semibold">{t("roles2.cell_sites")}</span>
  return <Mark yes={cell === true || cell === "limit"} yesLabel={t("matrix.yes")} noLabel={t("matrix.no")} />
}

function NumberField({
  form,
  name,
  unit,
  label,
  hideLabel,
  disabled,
  placeholder,
  unitLabel,
}: {
  form: UseFormReturn<FormValues>
  name: NumericKey
  unit: Unit
  label: string
  hideLabel?: boolean
  disabled: boolean
  placeholder: string
  unitLabel: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className="space-y-1">
          <FormLabel className={cn("text-[11px] font-semibold text-muted-foreground", hideLabel && "sr-only")}>{label}</FormLabel>
          <FormControl>
            <div className="relative">
              <Input
                {...field}
                type="number"
                inputMode="decimal"
                min={0}
                step={unit === "sar" ? 100 : unit === "percent" ? 0.1 : 1}
                disabled={disabled}
                placeholder={placeholder}
                className="h-10 pe-14 text-end tabular-nums"
                dir="ltr"
                value={field.value ?? ""}
              />
              <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-[11px] font-semibold text-muted-foreground">{unitLabel}</span>
            </div>
          </FormControl>
          <FormMessage className="text-[11px]" />
        </FormItem>
      )}
    />
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
