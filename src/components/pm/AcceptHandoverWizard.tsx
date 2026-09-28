"use client"

// Accepting a handover (HO-02, WF-01; the prototype's formPrj with a file):
// project & contract (read from CRM, not edited here) with the manager, an
// optional site engineer and a note → sections by a template per project type →
// where the BOQ comes from, and a review of what the system will do. The
// project is born "not started" with its number and its manager; the advance
// term goes to Finance once; the BOQ is written right after, as the
// new-project wizard writes it; then the project opens on its Pulse.

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, CheckCircle2, ChevronDown, Clock, FileSpreadsheet, Link2, List, Loader2, Lock, Upload, X } from "lucide-react"
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { WizardSteps } from "@/components/module-ui/WizardSteps"
import { useFirestore } from "@/firebase"
import { resolveCentralForRegion, useCentralWarehouse } from "@/hooks/useCentralWarehouse"
import { useHandoverPeople } from "@/hooks/useHandoverPeople"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "@/i18n/routing"
import { parseBoqFile, type BoqParseResult } from "@/lib/boq-parser"
import type { PortalComponentId } from "@/lib/portal-components"
import { cascadeDisable, cascadeEnable, SECTION_GROUPS, SECTION_IDS, SECTION_REGISTRY, sectionDescKey, sectionLabelKey, type SectionId } from "@/lib/project-sections"
import { pmDate, pmMoney, pmPct } from "@/lib/pm/format"
import {
  acceptBlocks,
  acceptStepBlocks,
  boqSourcesFor,
  handoverBoqCount,
  isSelfDevelopment,
  PROJECT_KINDS,
  type BoqSource,
  type PmHandover,
  type ProjectKind,
} from "@/lib/pm/handover"
import { acceptHandover, PmHandoverError, type PmActor } from "@/lib/pm/handover-writes"
import { sectionsForKind } from "@/lib/pm/sections"
import { cn } from "@/lib/utils"

/** The module a section reads its data from, when it is not Project Management's own. */
const READS_FROM: Partial<Record<SectionId, PortalComponentId>> = {
  procure: "procurement",
  receive: "warehouses",
  mats: "procurement",
  invoice: "payments",
  pay: "payments",
  collect: "payments",
  mfg: "manufacturing",
}

const SOURCE_ICON: Record<BoqSource, typeof Link2> = { crm: Link2, xl: FileSpreadsheet, man: List, later: Clock }

export function clientTypeKey(v: string | null | undefined): { ns: "shared"; key: string } | null {
  if (!v) return null
  if (v === "individual" || v === "company") return { ns: "shared", key: `crm_entity_${v}` }
  if (["government", "semi_government", "developer", "private", "main_contractor", "endowment"].includes(v)) return { ns: "shared", key: `crm_party_type_${v}` }
  return null
}

export function AcceptHandoverWizard({ open, onOpenChange, handover, actor }: { open: boolean; onOpenChange: (open: boolean) => void; handover: PmHandover; actor: PmActor }) {
  const t = useTranslations("Portal.PM")
  const tShared = useTranslations("Portal.Shared")
  const tC = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const firestore = useFirestore()
  const router = useRouter()
  const { toast } = useToast()
  const { people, candidates, siteStaff } = useHandoverPeople(handover.organizationId)
  const { centrals } = useCentralWarehouse(handover.organizationId)

  const managers = useMemo(() => candidates(null), [candidates])
  const defaultManager = managers.some((m) => m.uid === actor.uid) ? actor.uid : managers.some((m) => m.uid === handover.to) ? handover.to : ""

  const [step, setStep] = useState(0)
  const [kind, setKind] = useState<ProjectKind>(handover.kind ?? "bld")
  const [location, setLocation] = useState(handover.location ?? "")
  const [managerUid, setManagerUid] = useState("")
  const [siteUid, setSiteUid] = useState("")
  const [note, setNote] = useState("")
  const [sections, setSections] = useState<SectionId[]>(sectionsForKind(handover.kind ?? "bld"))
  const [source, setSource] = useState<BoqSource | null>(null)
  const [boq, setBoq] = useState<BoqParseResult | null>(null)
  const [parsing, setParsing] = useState(false)
  const [busy, setBusy] = useState(false)

  const crmCount = handoverBoqCount(handover)

  useEffect(() => {
    if (!open) return
    setStep(0)
    setKind(handover.kind ?? "bld")
    setLocation(handover.location ?? "")
    setSiteUid("")
    setNote("")
    setSections(sectionsForKind(handover.kind ?? "bld"))
    setSource(null)
    setBoq(null)
  }, [open, handover])

  useEffect(() => {
    if (open && !managerUid && defaultManager) setManagerUid(defaultManager)
  }, [open, managerUid, defaultManager])

  useEffect(() => {
    if (step === 2 && !source && crmCount > 0) setSource("crm")
  }, [step, source, crmCount])

  const built = SECTION_IDS.filter((id) => SECTION_REGISTRY[id].status === "built")
  const ghosts = SECTION_IDS.filter((id) => SECTION_REGISTRY[id].status !== "built")
  const secName = (id: SectionId | string) => tShared(sectionLabelKey(id as SectionId))

  const applyTemplate = (k: ProjectKind) => {
    const next = sectionsForKind(k)
    setKind(k)
    setSections(next)
    toast({ title: t("wizard.tpl_applied", { kind: tShared(`pm_kind_${k}`), count: next.length }) })
  }

  const toggleSection = (id: SectionId) => {
    if (SECTION_REGISTRY[id].required) return
    const cur = new Set(sections)
    if (cur.has(id)) {
      const next = cascadeDisable(cur, id)
      const dropped = sections.filter((s) => s !== id && !next.has(s))
      setSections(SECTION_IDS.filter((s) => next.has(s)))
      toast({ title: dropped.length ? t("wizard.sec_off_with", { name: secName(id), names: dropped.map(secName).join(" · ") }) : t("wizard.sec_off", { name: secName(id) }) })
    } else {
      const next = cascadeEnable(cur, id)
      const added = SECTION_IDS.filter((s) => s !== id && next.has(s) && !cur.has(s))
      setSections(SECTION_IDS.filter((s) => next.has(s)))
      toast({ title: added.length ? t("wizard.sec_on_with", { name: secName(id), names: added.map(secName).join(" · ") }) : t("wizard.sec_on", { name: secName(id) }) })
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setParsing(true)
    try {
      setBoq(await parseBoqFile(file))
    } catch (err) {
      console.error(err)
      toast({ title: t("wizard.boq_parse_error"), variant: "destructive" })
    } finally {
      setParsing(false)
    }
  }

  const xlItems = (boq?.items ?? []).filter((i) => i.selected)
  const selfDev = isSelfDevelopment(kind)
  const blocks = [
    ...acceptBlocks(handover).map((b) => t(`accept_block.${b}`)),
    ...acceptStepBlocks({ source, managerUid: managerUid || null, xlItems: xlItems.length }).map((b) => t(`wizard.block.${b}`)),
  ]
  const manager = people.find((p) => p.uid === managerUid)
  const site = people.find((p) => p.uid === siteUid)
  const storeOn = sections.includes("store")

  const accept = async () => {
    if (!firestore || blocks.length || !manager) return
    setBusy(true)
    try {
      const central = resolveCentralForRegion(centrals, null)
      const { projectId, projectNo } = await acceptHandover(firestore, actor, handover.id, {
        kind,
        location: location.trim() || null,
        enabledSections: sections,
        manager: { uid: manager.uid, name: manager.name, groupId: manager.groupId },
        siteEngineer: site ? { uid: site.uid, name: site.name, groupId: site.groupId } : null,
        note,
        store: storeOn ? { name: tC("proj_auto_warehouse_name", { name: handover.title }), centralWarehouseId: central?.id ?? null } : null,
        notification: { title: t("notif.accepted_title"), message: t("notif.accepted_message", { project: handover.title, by: actor.name ?? "" }) },
        managerNotification: { title: t("notif.named_pm_title"), message: t("notif.named_pm_message", { project: handover.title, by: actor.name ?? "" }) },
      })
      const lines =
        source === "crm"
          ? (handover.boq ?? [])
              .filter((l) => l.quantity > 0)
              .map((l) => ({ itemNo: l.code, descriptionAr: l.descriptionAr, descriptionEn: l.descriptionEn ?? l.descriptionAr, unit: l.unit, quantity: l.quantity, unitPrice: l.rate, groupId: null as string | null, extra: {} }))
          : source === "xl"
            ? xlItems.map((item) => ({
                itemNo: item.itemNo,
                descriptionAr: item.descriptionAr,
                descriptionEn: item.descriptionEn,
                unit: item.unit,
                quantity: item.quantity,
                unitPrice: item.rate || 0,
                groupId: item.groupId as string | null,
                extra: {
                  sheet: item.sheet,
                  divisionNo: item.divisionNo,
                  divisionNameEn: item.divisionNameEn,
                  divisionNameAr: item.divisionNameAr,
                  subCategoryCode: item.subCategoryCode,
                  subCategoryNameEn: item.subCategoryNameEn,
                  subCategoryNameAr: item.subCategoryNameAr,
                  suggestedCategory: item.suggestedCategory,
                  suggestedSubCategory: item.suggestedSubCategory,
                },
              }))
            : []
      if (lines.length) {
        const batch = writeBatch(firestore)
        const itemsRef = collection(firestore, "projects", projectId, "boqItems")
        const groupsRef = collection(firestore, "projects", projectId, "boqGroups")
        lines.forEach(({ extra, ...line }) =>
          batch.set(doc(itemsRef), { ...line, ...extra, tenderId: null, isEditable: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        )
        if (source === "xl") {
          const used = new Set(xlItems.map((i) => i.groupId))
          ;(boq?.groups ?? []).filter((g) => used.has(g.id)).forEach((g) => batch.set(doc(groupsRef, g.id), { titleAr: g.titleAr, categoryAr: g.categoryAr, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
        }
        try {
          await batch.commit()
        } catch (err) {
          console.error(err)
          toast({ title: t("wizard.boq_partial"), variant: "destructive" })
        }
      }
      toast({
        title:
          source === "crm"
            ? t("wizard.done_crm", { number: projectNo, count: lines.length })
            : source === "xl"
              ? t("wizard.done_xl", { number: projectNo, count: lines.length })
              : t("wizard.done_empty", { number: projectNo }),
      })
      onOpenChange(false)
      router.push(`/contractor/projects/${projectId}?tab=pmToday`)
    } catch (err) {
      console.error(err)
      const code = err instanceof PmHandoverError ? err.code : "save"
      toast({ title: t(`error.${code === "save" ? "save" : code}`), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const steps = [t("wizard.step_project"), t("wizard.step_sections"), t("wizard.step_boq")]
  const ct = clientTypeKey(handover.clientType)
  const crmTag = <SourceBadge module="crm" label={t("wizard.from_crm")} className="ms-1.5 align-middle" />
  const limitText = (limit: number) => (limit === Number.POSITIVE_INFINITY ? t("wizard.no_limit") : t("wizard.limit", { amount: pmMoney(limit) }))

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("wizard.title")}</DialogTitle>
          <DialogDescription>
            <span dir="auto">{handover.title}</span>
            {handover.contractNumber && (
              <span className="text-muted-foreground" dir="ltr">
                {" "}
                — {handover.contractNumber}
              </span>
            )}{" "}
            {t("wizard.from_crm_sub")}
          </DialogDescription>
        </DialogHeader>

        <WizardSteps steps={steps} current={step} ariaLabel={t("wizard.steps_label")} />

        {step === 0 && (
          <div className="space-y-4">
            <Callout tone="info">{t("wizard.read_only_note")}</Callout>
            <div className="rounded-xl border px-4">
              <KeyValueRow label={t("wizard.row_project")} value={<span dir="auto">{handover.title}{crmTag}</span>} />
              <KeyValueRow label={t("field.client")} value={[handover.clientName ?? "—", ct ? tShared(ct.key) : null].filter(Boolean).join(" · ")} />
              <KeyValueRow
                label={t("wizard.row_value_duration")}
                value={`${handover.value > 0 ? pmMoney(handover.value) : t("not_fixed")} · ${handover.durationDays > 0 ? t("days", { count: handover.durationDays }) : t("not_fixed")}`}
                strong
              />
              <KeyValueRow label={t("wizard.row_signed_start")} value={t("wizard.signed_start", { signed: pmDate(handover.signedOn, locale), start: pmDate(handover.startOn, locale) })} />
              <KeyValueRow label={t("wizard.row_terms")} value={t("wizard.terms_line", { advance: pmPct(handover.advance), retention: pmPct(handover.retention) })} />
              <KeyValueRow label={t("wizard.row_boq")} value={crmCount ? t("wizard.boq_from_bid", { count: crmCount }) : <span className="font-bold text-destructive">{t("wizard.boq_not_attached")}</span>} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-loc">{t("wizard.site_location")}</Label>
              <Input id="acc-loc" dir="auto" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("wizard.site_location_ph")} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-pm">{t("wizard.pm_label")}</Label>
              <Select value={managerUid} onValueChange={setManagerUid} disabled={busy}>
                <SelectTrigger id="acc-pm">
                  <SelectValue placeholder={t("reassign.pick")} />
                </SelectTrigger>
                <SelectContent>
                  {managers.map((m) => (
                    <SelectItem key={m.uid} value={m.uid}>
                      {m.name} — {t(`seat.${m.seat}.name`)} · {limitText(m.limit)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("wizard.pm_hint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-site">{t("wizard.site_label")}</Label>
              <Select value={siteUid || "__later"} onValueChange={(v) => setSiteUid(v === "__later" ? "" : v)} disabled={busy}>
                <SelectTrigger id="acc-site">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__later">{t("wizard.site_later")}</SelectItem>
                  {siteStaff
                    .filter((p) => p.uid !== managerUid)
                    .map((p) => (
                      <SelectItem key={p.uid} value={p.uid}>
                        {p.name} — {t(`seat.${p.seat}.name`)}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t("wizard.site_hint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-note">{t("wizard.note_label")}</Label>
              <Textarea id="acc-note" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("wizard.note_ph")} disabled={busy} />
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <Callout tone="info">{t("wizard.tpl_note", { kind: tShared(`pm_kind_${kind}`) })}</Callout>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("wizard.tpl_label")}>
                {PROJECT_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => applyTemplate(k)}
                    className={cn(
                      "min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      kind === k ? "border-module bg-module/10 text-module" : "hover:border-module/40"
                    )}
                  >
                    {tShared(`pm_kind_${k}`)}
                  </button>
                ))}
              </div>
              <span className="text-xs font-semibold text-muted-foreground">{t("wizard.enabled_of", { n: sections.length, total: built.length })}</span>
            </div>
            {selfDev && <Callout tone="warn">{t("wizard.self_dev_note")}</Callout>}
            {SECTION_GROUPS.map((g) => {
              const rows = built.filter((id) => SECTION_REGISTRY[id].group === g)
              if (!rows.length) return null
              return (
                <fieldset key={g} className="space-y-2">
                  <legend className="text-sm font-bold">{tShared(`sec_group_${g}`)}</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {rows.map((id) => {
                      const def = SECTION_REGISTRY[id]
                      const on = sections.includes(id)
                      const missing = def.dependsOn.filter((d) => !sections.includes(d as SectionId))
                      const from = READS_FROM[id]
                      return (
                        <button
                          key={id}
                          type="button"
                          aria-pressed={on}
                          disabled={def.required || busy}
                          onClick={() => toggleSection(id)}
                          className={cn(
                            "flex min-h-11 flex-col items-start gap-1 rounded-xl border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                            on ? "border-module/50 bg-module/5" : "hover:border-module/40"
                          )}
                        >
                          <span className="flex w-full items-center justify-between gap-2">
                            <span className="text-sm font-bold">{secName(id)}</span>
                            {def.required ? (
                              <StatusPill tone="mute">
                                <Lock size={10} aria-hidden="true" /> {t("wizard.core")}
                              </StatusPill>
                            ) : on ? (
                              <StatusPill tone="ok">
                                <Check size={10} aria-hidden="true" />
                              </StatusPill>
                            ) : null}
                          </span>
                          <span className="text-xs text-muted-foreground">{tShared(sectionDescKey(id))}</span>
                          {from && <SourceBadge module={from} label={t("wizard.reads_from", { module: t(`wizard.module.${from}`) })} />}
                          {!on && missing.length > 0 && <span className="text-xs font-bold text-warning">{t("wizard.needs", { names: missing.map(secName).join(" · ") })}</span>}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
              )
            })}
            {ghosts.length > 0 && (
              <details className="group rounded-xl border">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Clock size={14} className="text-muted-foreground" aria-hidden="true" />
                  {t("wizard.unbuilt")}
                  <span className="ms-auto text-xs tabular-nums text-muted-foreground">{ghosts.length}</span>
                  <ChevronDown size={14} className="transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="space-y-2 border-t p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ghosts.map((id) => (
                      <div key={id} className="rounded-xl border border-dashed p-3 opacity-70">
                        <p className="text-sm font-bold">{secName(id)}</p>
                        <p className="text-xs text-muted-foreground">{tShared(sectionDescKey(id))}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">{t("wizard.unbuilt_note")}</p>
                </div>
              </details>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-sm font-bold">{t("wizard.boq_where")}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {boqSourcesFor(handover).map((s) => {
                  const Icon = SOURCE_ICON[s]
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={source === s}
                      onClick={() => setSource(s)}
                      disabled={busy}
                      className={cn(
                        "flex min-h-11 flex-col items-start gap-1 rounded-xl border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        source === s ? "border-module bg-module/10" : "hover:border-module/40"
                      )}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-bold">
                        <Icon size={15} className="text-module" aria-hidden="true" />
                        {t(`wizard.src.${s}`)}
                      </span>
                      <span className="text-xs text-muted-foreground">{t(`wizard.src.${s}_d`, { count: crmCount })}</span>
                    </button>
                  )
                })}
              </div>
            </fieldset>
            {source === "later" && <Callout tone="warn">{t("wizard.later_warn")}</Callout>}
            {source === "xl" && (
              <>
                <Callout tone="info">{t("wizard.xl_note")}</Callout>
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-sm font-semibold hover:border-module/40 focus-within:ring-2 focus-within:ring-ring">
                  {parsing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
                  {t("wizard.boq_upload")}
                  <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} disabled={parsing || busy} />
                </label>
                {boq && <p className="text-sm font-semibold text-success">{t("wizard.boq_loaded", { count: xlItems.length })}</p>}
              </>
            )}
            <div className="rounded-xl border px-4">
              <KeyValueRow label={t("wizard.row_project")} value={<span dir="auto">{handover.title}</span>} />
              <KeyValueRow label={t("field.client")} value={handover.clientName ?? "—"} />
              <KeyValueRow label={t("wizard.row_value_duration")} value={`${pmMoney(handover.value)} · ${t("days", { count: handover.durationDays })}`} />
              <KeyValueRow label={t("wizard.row_start")} value={pmDate(handover.startOn, locale)} />
              <KeyValueRow label={t("wizard.row_manager")} value={manager ? manager.name : "—"} />
              <KeyValueRow label={t("wizard.row_sections")} value={`${sections.length} — ${sections.map(secName).join(" · ")}`} />
            </div>
            <div className="rounded-xl border border-cta/20 bg-cta/5 p-3">
              <p className="mb-2 text-sm font-bold">{t("wizard.effects_title")}</p>
              <ul className="space-y-1.5 text-xs">
                {[
                  { k: "eff_project", ok: true },
                  { k: "eff_crm", ok: true },
                  ...(source === "crm" ? [{ k: "eff_boq", ok: true }] : []),
                  { k: "eff_sections", ok: true },
                  ...(handover.advance && !selfDev ? [{ k: "effect_advance", ok: true }] : []),
                  ...(storeOn ? [{ k: "eff_store", ok: true }] : []),
                  { k: "eff_no_client_account", ok: false },
                ].map(({ k, ok }) => (
                  <li key={k} className="flex items-start gap-2">
                    {ok ? <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-cta" aria-hidden="true" /> : <X size={13} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <span className={cn(!ok && "text-muted-foreground")}>{t(`wizard.${k}`, { count: k === "eff_boq" ? crmCount : sections.length })}</span>
                  </li>
                ))}
              </ul>
            </div>
            <BlockingReasons title={t("cannot_accept")} reasons={blocks} />
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={busy}>
              {t("back")}
            </Button>
          )}
          {step < 2 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={step === 0 && !managerUid}>
              {t("next")}
            </Button>
          ) : (
            <Button onClick={() => void accept()} disabled={busy || blocks.length > 0 || parsing}>
              {busy ? <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" /> : <Check size={16} className="me-2" aria-hidden="true" />}
              {t("wizard.submit")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
