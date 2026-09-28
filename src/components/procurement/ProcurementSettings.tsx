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
import { useLocale, useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { collection, doc, query, serverTimestamp, setDoc, where } from "firebase/firestore"
import { Check, ChevronDown, Info, Loader2, Lock, Minus, PackageCheck, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useProcurementWorld } from "@/hooks/useProcurementWorld"
import { ProcurementHeader } from "@/components/contractor/ProcurementHeader"
import { ReceiverRegister } from "@/components/procurement/ReceiverRegister"
import { ProcChipGroup } from "@/components/procurement/ProcChipGroup"
import { useProcReceivers } from "@/hooks/useProcReceivers"
import { boundaryLog, LINK_PARTIES, type BoundaryParty } from "@/lib/procurement/boundary"
import { displayDocNumber } from "@/lib/procurement/format"
import { DEFAULT_RESOLVED_POLICIES, NOTICE_ROUTINGS, POLICY_OWNER, resolvePolicies, type PolicyOwner, type ResolvedPolicies } from "@/lib/procurement/policies"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"
import { sarLtr } from "@/lib/riyal"
import { cn } from "@/lib/utils"

type Unit = "sar" | "percent" | "count" | "days"
type NumericKey = Exclude<keyof ResolvedPolicies, "sealOffersUntilDeadline" | "sendOnApproval" | "buyerReceives" | "noticeRouting">
type SwitchKey = "sealOffersUntilDeadline" | "buyerReceives" | "sendOnApproval"
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
  noticeRouting: z.enum(NOTICE_ROUTINGS),
})
type FormValues = z.infer<typeof schema>

type Segment = "flow" | "link" | "pol" | "gap"
const SEGMENTS: Segment[] = ["flow", "link", "pol", "gap"]

type Party = BoundaryParty | "me" | "gov"
/** The nine steps of §1.2 and who owns each. */
const FLOW: Party[] = ["pm", "inv", "mfg", "me", "me", "me", "fin", "inv", "fin"]
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

/** Capability × role (prototype `ROLES.can`; the owner reads everything and approves, nothing else). */
const CAPS = ["price", "src", "appr", "exp", "sup"] as const
const MATRIX_ROLES: Array<{ id: "manager" | "buyer" | "expediter" | "owner"; permission: string | null; can: ReadonlyArray<(typeof CAPS)[number]> }> = [
  { id: "manager", permission: "po.approve", can: ["price", "src", "appr", "exp", "sup"] },
  { id: "buyer", permission: "offers.accept", can: ["price", "src", "exp", "sup"] },
  { id: "expediter", permission: "po.expedite", can: ["exp"] },
  { id: "owner", permission: null, can: ["price", "appr"] },
]

const NEVER_COUNT = 8
const NOT_BUILT_COUNT = 9
const CONFLICTS: Party[] = ["inv", "mfg", "fin", "inv", "pm", "pm", "gov", "gov"]
const LOG_SHOWN = 14

const OWNER_ONLY_POLICIES = new Set<string>(["managerApprovalLimit", "buyerSelfIssueLimit", "directPurchaseCap", "overReceiptTolerancePercent"])

export function ProcurementSettings() {
  const t = useTranslations("Portal.ProcSettings")
  const tRcv = useTranslations("Portal.ProcReceivers")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const { actor, orgId, policies: worldPolicies, orders, deliveries, loading } = useProcurementWorld()
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
  const [saving, setSaving] = useState(false)
  const [segment, setSegment] = useState<Segment>("flow")
  const log = useMemo(() => boundaryLog(orders, deliveries), [orders, deliveries])

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
  const partyName = (p: Party) => t(`party.${p}`)
  const day = (d: string) => {
    const x = new Date(`${d.slice(0, 10)}T12:00:00Z`)
    return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
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

  const ownerChip = (key: keyof ResolvedPolicies) => <PartyChip party={OWNER_PARTY[POLICY_OWNER[key]]} label={t(`owner.${POLICY_OWNER[key]}`)} />

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

          {/* ── 1 · The purchase path ── */}
          {segment === "flow" && (
            <>
              <Section title={t("flow.title")} subtitle={t("flow.sub")}>
                <ol className="grid gap-3 p-4 sm:grid-cols-3 xl:grid-cols-9">
                  {FLOW.map((owner, i) => {
                    const n = i + 1
                    return (
                      <li key={n} className={cn("flex flex-col gap-2 rounded-xl border p-3", owner === "me" ? "border-module/50 bg-module/5" : "bg-card")}>
                        <h3 className="text-sm font-black text-foreground">{t(`flow.step${n}.title`)}</h3>
                        <p className="flex-1 text-[11px] leading-relaxed text-muted-foreground">{t(`flow.step${n}.desc`)}</p>
                        <PartyChip party={owner} label={partyName(owner)} />
                        <p className="text-[11px] font-semibold text-destructive">{t(`flow.step${n}.rule`)}</p>
                      </li>
                    )
                  })}
                </ol>
              </Section>
              <div className="grid gap-4 lg:grid-cols-2">
                <Section title={t("ideas.title")}>
                  <div className="space-y-3 px-4 py-3 text-sm leading-relaxed">
                    <div>
                      <h3 className="font-bold text-foreground">{t("ideas.backbone.title")}</h3>
                      <p className="text-muted-foreground">{t("ideas.backbone.body")}</p>
                    </div>
                    <div>
                      <h3 className="font-bold text-foreground">{t("ideas.lastDay.title")}</h3>
                      <p className="text-muted-foreground">{t("ideas.lastDay.body")}</p>
                    </div>
                  </div>
                </Section>
                <Section title={t("owns.title")}>
                  <p className="px-4 py-3 text-[13px] leading-loose text-muted-foreground">{t("owns.body")}</p>
                </Section>
              </div>
            </>
          )}

          {/* ── 2 · The integration contract ── */}
          {segment === "link" && (
            <>
              <Section title={t("link.title")} subtitle={t("link.sub")}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-[12px] leading-relaxed">
                    <thead>
                      <tr className="border-b text-xs text-muted-foreground">
                        {(["party", "in", "out", "late"] as const).map((h) => (
                          <th key={h} scope="col" className="px-4 py-3 text-start font-semibold">
                            {t(`link.col.${h}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {LINK_PARTIES.map((p) => (
                        <tr key={p} className="border-t align-top">
                          <td className="w-44 px-4 py-3">
                            <PartyChip party={p} label={partyName(p)} />
                            <span className="mt-1.5 block break-all font-mono text-[10px] text-muted-foreground" dir="ltr">
                              {t(`link.${p}.keys`)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-foreground">{t(`link.${p}.in`)}</td>
                          <td className="px-4 py-3 text-foreground">{t(`link.${p}.out`)}</td>
                          <td className="px-4 py-3 text-muted-foreground">{t(`link.${p}.late`)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
              <Note>{t("link.note")}</Note>
            </>
          )}

          {/* ── 3 · Policies & roles ── */}
          {segment === "pol" && (
            <>
              <div className="grid items-start gap-4 lg:grid-cols-2">
                <Section title={t("polPanel.title")} subtitle={t("polPanel.sub")}>
                  {!mayEdit && (
                    <p className="flex items-center gap-1.5 border-b px-4 py-2 text-[11px] text-muted-foreground">
                      <Lock size={11} aria-hidden="true" />
                      {t("policies.readOnly")}
                    </p>
                  )}
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="divide-y">
                      {ROWS.map((row) => {
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
                      <div className="space-y-1.5 px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
                        <p>
                          <b className="text-foreground">{t("polPanel.smallFirm.q")}</b> {t("polPanel.smallFirm.a")}
                        </p>
                        <p>
                          <b className="text-foreground">{t("polPanel.noInventory.q")}</b> {t("polPanel.noInventory.a")}
                        </p>
                        <p>
                          <b className="text-foreground">{t("polPanel.noWorkshop.q")}</b> {t("polPanel.noWorkshop.a")}
                        </p>
                      </div>
                      <p className="px-4 py-2.5 text-[11px] text-muted-foreground">{t("polPanel.enforced")}</p>
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

                <Section
                  title={t("roles.title")}
                  subtitle={t("roles.subtitle")}
                  action={
                    <Link href="/contractor/team" className="rounded-sm text-xs font-semibold text-module hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      {t("roles.teamLink")}
                    </Link>
                  }
                >
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[480px] text-[12px]">
                      <thead>
                        <tr className="border-b text-xs text-muted-foreground">
                          <th scope="col" className="px-3 py-3 text-start font-semibold">
                            <span className="sr-only">{t("matrix.capability")}</span>
                          </th>
                          {MATRIX_ROLES.map((r) => (
                            <th key={r.id} scope="col" className="px-2 py-3 text-center align-bottom font-semibold">
                              <span className="block text-foreground">{t(`roles.${r.id}.name`)}</span>
                              <span className="mt-0.5 block font-mono text-[9.5px] font-bold text-module" dir="ltr">
                                {r.permission ?? t("roles.ownerBadge")}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {CAPS.map((c) => (
                          <tr key={c} className="border-t">
                            <th scope="row" className="px-3 py-2.5 text-start font-medium text-foreground">
                              {t(`matrix.${c}`)}
                            </th>
                            {MATRIX_ROLES.map((r) => (
                              <td key={r.id} className="px-2 py-2.5 text-center">
                                <Mark yes={r.can.includes(c)} yesLabel={t("matrix.yes")} noLabel={t("matrix.no")} />
                              </td>
                            ))}
                          </tr>
                        ))}
                        <tr className="border-t bg-muted/20">
                          <th scope="row" className="px-3 py-2.5 text-start font-medium text-foreground">
                            {t("matrix.never")}
                          </th>
                          {MATRIX_ROLES.map((r) => (
                            <td key={r.id} className="px-2 py-2.5 text-center">
                              <Mark yes={false} yesLabel={t("matrix.yes")} noLabel={t("matrix.no")} />
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="border-t px-4 py-2.5 text-[11px] leading-relaxed text-muted-foreground" dir="auto">
                    {t("roles.prices")}
                  </p>
                </Section>
              </div>

              {/* ── Who receives goods, and where (§4 `RCVR`) ── */}
              <Section title={tRcv("title")} subtitle={tRcv("subtitle")} icon={PackageCheck}>
                <ReceiverRegister
                  receivers={receivers}
                  warehouses={(warehouseDocs || []).map((w) => ({ id: w.id, name: w.name || w.id }))}
                  actor={actor}
                  orgId={orgId}
                  mayEdit={mayEditReceivers}
                />
              </Section>
            </>
          )}

          {/* ── 4 · Never · not built · conflicts · boundary log ── */}
          {segment === "gap" && (
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <Fold title={t("folds.never")} count={NEVER_COUNT} open>
                  {Array.from({ length: NEVER_COUNT }, (_, i) => (
                    <li key={i} className="px-4 py-2.5">{t(`never.item${i + 1}`)}</li>
                  ))}
                </Fold>
                <Fold title={t("folds.notBuilt")} count={NOT_BUILT_COUNT}>
                  {Array.from({ length: NOT_BUILT_COUNT }, (_, i) => (
                    <li key={i} className="px-4 py-2.5">{t(`notBuilt.item${i + 1}`)}</li>
                  ))}
                </Fold>
              </div>
              <div className="space-y-4">
                <Fold title={t("folds.conflicts")} count={CONFLICTS.length} warn>
                  {CONFLICTS.map((p, i) => (
                    <li key={i} className="flex items-start gap-2 px-4 py-2.5">
                      <PartyChip party={p} label={partyName(p)} />
                      <span>{t(`conflict.item${i + 1}`)}</span>
                    </li>
                  ))}
                </Fold>
                <Fold title={t("folds.log")} count={log.length}>
                  {log.length === 0 && <li className="px-4 py-3 text-muted-foreground">{t("blog.empty")}</li>}
                  {log.slice(0, LOG_SHOWN).map((e, i) => (
                    <li key={`${e.key}-${e.at}-${i}`} className="flex items-start gap-2 px-4 py-2.5">
                      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold", e.dir === "in" ? "bg-cta/10 text-cta" : "bg-module/10 text-module")}>{t(`blog.dir.${e.dir}`)}</span>
                      <span className="min-w-0 flex-1">
                        <b className="block text-foreground" dir="auto">
                          {t(`blog.${e.kind}`, {
                            ...e.params,
                            doc: displayDocNumber(String(e.params.doc || ""), locale),
                            grn: displayDocNumber(String(e.params.grn || ""), locale),
                            date: e.params.date ? day(String(e.params.date)) : "—",
                          })}
                        </b>
                        <span className="block break-all font-mono text-[10.5px] text-muted-foreground" dir="ltr">
                          {e.key}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <PartyChip party={e.party} label={partyName(e.party)} />
                        <span className="text-[11px] tabular-nums text-muted-foreground">{day(e.day)}</span>
                      </span>
                    </li>
                  ))}
                  {log.length > LOG_SHOWN && <li className="px-4 py-2 text-[11px] text-muted-foreground">{t("blog.more", { count: log.length - LOG_SHOWN })}</li>}
                </Fold>
              </div>
            </div>
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

function Fold({ title, count, open, warn, children }: { title: string; count: number; open?: boolean; warn?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group min-w-0 overflow-hidden rounded-2xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3.5 text-sm font-black text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="flex-1">{title}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums", warn ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")} dir="ltr">
          {count}
        </span>
        <ChevronDown size={16} className="text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <ul className="divide-y border-t text-[12.5px] leading-relaxed text-foreground">{children}</ul>
    </details>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-2xl border bg-muted/30 px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
      <Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
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
