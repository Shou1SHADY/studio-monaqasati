"use client"

// Accepting a handover (HO-02, WF-01; the prototype's formPrj with a file):
// project & contract (read from CRM, not edited here) with the manager, an
// optional site engineer and a note → sections by a template per project type →
// where the BOQ comes from, and a review of what the system will do. The
// project is born "not started" with its number and its manager; the advance
// term goes to Finance once; the BOQ is written right after, as the
// new-project wizard writes it; then the project opens on its Pulse.
// Without a file it is the prototype's manual «مشروع جديد» (formPrj without h):
// the exception path, the same three steps with the project and contract typed
// in step one (name and client required), and the project born the same way.

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
import { divisionOfCode, parseBoqCsv, type ImportRow } from "@/lib/pm/boq"
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
import { acceptHandover, fileExtras, PmHandoverError, type PmActor } from "@/lib/pm/handover-writes"
import type { PmContext } from "@/lib/pm/access"
import {
  ADVANCE_CHOICES,
  DEFAULT_ADVANCE,
  DEFAULT_RETENTION,
  manualDuration,
  manualEnd,
  manualProjectBlocks,
  manualValue,
  RETENTION_CHOICES,
  type ManualProjectDraft,
} from "@/lib/pm/manual-project"
import { createManualProject, PmManualProjectError } from "@/lib/pm/manual-project-writes"
import { sectionsForKind } from "@/lib/pm/sections"
import { todayDay } from "@/lib/pm/format"
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

/** One line the wizard is about to import, whichever reader produced it. */
interface XlItem {
  id: string
  itemNo: string
  descriptionAr: string
  descriptionEn: string
  unit: string
  quantity: number
  rate: number
  groupId: string | null
  extra: Record<string, unknown>
}

const SOURCE_ICON: Record<BoqSource, typeof Link2> = { crm: Link2, xl: FileSpreadsheet, man: List, later: Clock }

export function clientTypeKey(v: string | null | undefined): { ns: "shared"; key: string } | null {
  if (!v) return null
  if (v === "individual" || v === "company") return { ns: "shared", key: `crm_entity_${v}` }
  if (["government", "semi_government", "developer", "private", "main_contractor", "endowment"].includes(v)) return { ns: "shared", key: `crm_party_type_${v}` }
  return null
}

const blankDraft = (): ManualProjectDraft => ({
  name: "",
  client: "",
  kind: "bld",
  region: "",
  location: "",
  startOn: todayDay(),
  duration: "",
  value: "",
  advance: DEFAULT_ADVANCE,
  retention: DEFAULT_RETENTION,
})

export function AcceptHandoverWizard({
  open,
  onOpenChange,
  handover,
  actor,
  organizationId,
  ctx,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null: a project created by hand (the exception path). */
  handover: PmHandover | null
  actor: PmActor
  /** The organisation, for a project created by hand (a handover carries its own). */
  organizationId?: string
  /** The creator's PM context: a manual project needs the `create` key. */
  ctx?: PmContext
}) {
  const t = useTranslations("Portal.PM")
  const tShared = useTranslations("Portal.Shared")
  const tC = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const firestore = useFirestore()
  const router = useRouter()
  const { toast } = useToast()
  const orgId = handover?.organizationId ?? organizationId ?? ""
  const { people, candidates, siteStaff } = useHandoverPeople(orgId)
  const { centrals } = useCentralWarehouse(orgId)

  const managers = useMemo(() => candidates(null), [candidates])
  const defaultManager = managers.some((m) => m.uid === actor.uid) ? actor.uid : handover && managers.some((m) => m.uid === handover.to) ? handover.to : ""

  const [step, setStep] = useState(0)
  const [draft, setDraft] = useState<ManualProjectDraft>(blankDraft)
  const [kind, setKind] = useState<ProjectKind>(handover?.kind ?? "bld")
  const [location, setLocation] = useState(handover?.location ?? "")
  const [region, setRegion] = useState(handover ? (fileExtras(handover).region ?? "") : "")
  const [managerUid, setManagerUid] = useState("")
  const [siteUid, setSiteUid] = useState("")
  const [note, setNote] = useState("")
  const [sections, setSections] = useState<SectionId[]>(sectionsForKind(handover?.kind ?? "bld"))
  const [source, setSource] = useState<BoqSource | null>(null)
  const [boq, setBoq] = useState<BoqParseResult | null>(null)
  // The package's template is a CSV: read as the template is written, row by row.
  const [csv, setCsv] = useState<{ ok: ImportRow[]; bad: ImportRow[] } | null>(null)
  const [parsing, setParsing] = useState(false)
  const [busy, setBusy] = useState(false)

  const crmCount = handover ? handoverBoqCount(handover) : 0
  const manual = !handover
  const set = <K extends keyof ManualProjectDraft>(k: K, v: ManualProjectDraft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  useEffect(() => {
    if (!open) return
    setStep(0)
    setDraft(blankDraft())
    setKind(handover?.kind ?? "bld")
    setLocation(handover?.location ?? "")
    setRegion(handover ? (fileExtras(handover).region ?? "") : "")
    setSiteUid("")
    setNote("")
    setSections(sectionsForKind(handover?.kind ?? "bld"))
    setSource(null)
    setBoq(null)
    setCsv(null)
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
      if (/\.csv$/i.test(file.name)) {
        setBoq(null)
        setCsv(parseBoqCsv(await file.text()))
      } else {
        setCsv(null)
        setBoq(await parseBoqFile(file))
      }
    } catch (err) {
      console.error(err)
      toast({ title: t("wizard.boq_parse_error"), variant: "destructive" })
    } finally {
      setParsing(false)
    }
  }

  const xlItems: XlItem[] = csv
    ? csv.ok.map((r) => ({
        id: `csv-${r.line}`,
        itemNo: r.code,
        descriptionAr: r.description,
        descriptionEn: r.description,
        unit: r.unit,
        quantity: r.quantity,
        rate: r.rate && r.rate > 0 ? r.rate : 0,
        groupId: null,
        extra: { estCost: r.cost && r.cost > 0 ? r.cost : null, divisionNo: divisionOfCode(r.code) },
      }))
    : (boq?.items ?? [])
        .filter((i) => i.selected)
        .map((item) => ({
          id: item.id,
          itemNo: item.itemNo,
          descriptionAr: item.descriptionAr,
          descriptionEn: item.descriptionEn,
          unit: item.unit,
          quantity: item.quantity,
          rate: item.rate || 0,
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
  const xlBad = csv?.bad ?? []
  const xlLoaded = !!(csv || boq)
  const xlUnpriced = xlItems.filter((i) => !(i.rate > 0)).length
  const selfDev = isSelfDevelopment(kind)
  const manualBlocks = manual ? manualProjectBlocks({ ...draft, kind, location }, managerUid || null) : []
  const blocks = [
    ...(handover ? acceptBlocks(handover).map((b) => t(`accept_block.${b}`)) : manualBlocks.filter((b) => b !== "no_manager").map((b) => t(`manual.block.${b}`))),
    ...acceptStepBlocks({ source, managerUid: managerUid || null, xlItems: xlItems.length, xlBad: xlBad.length, xlLoaded }).map((b) => t(`wizard.block.${b}`)),
  ]
  const title = handover ? handover.title : draft.name.trim()
  const advance = handover ? handover.advance : draft.advance
  const manager = people.find((p) => p.uid === managerUid)
  const site = people.find((p) => p.uid === siteUid)
  const storeOn = sections.includes("store")

  const accept = async () => {
    if (!firestore || blocks.length || !manager) return
    setBusy(true)
    try {
      const central = resolveCentralForRegion(centrals, (handover ? region : draft.region).trim() || null)
      const managerSeat = { uid: manager.uid, name: manager.name, groupId: manager.groupId }
      const siteSeat = site ? { uid: site.uid, name: site.name, groupId: site.groupId } : null
      const store = storeOn ? { name: tC("proj_auto_warehouse_name", { name: title }), centralWarehouseId: central?.id ?? null } : null
      const managerNotification = { title: t("notif.named_pm_title"), message: t("notif.named_pm_message", { project: title, by: actor.name ?? "" }) }
      const { projectId, projectNo } = handover
        ? await acceptHandover(firestore, actor, handover.id, {
            kind,
            location: location.trim() || null,
            region: region.trim() || null,
            enabledSections: sections,
            manager: managerSeat,
            siteEngineer: siteSeat,
            note,
            store,
            notification: { title: t("notif.accepted_title"), message: t("notif.accepted_message", { project: handover.title, by: actor.name ?? "" }) },
            managerNotification,
          })
        : ctx
          ? await createManualProject(firestore, ctx, actor, {
              organizationId: orgId,
              draft: { ...draft, kind, location },
              enabledSections: sections,
              manager: managerSeat,
              siteEngineer: siteSeat,
              store,
              managerNotification,
            })
          : { projectId: "", projectNo: "" }
      if (!projectId) return
      const lines =
        source === "crm" && handover
          ? (handover.boq ?? [])
              .filter((l) => l.quantity > 0)
              .map((l) => ({ itemNo: l.code, descriptionAr: l.descriptionAr, descriptionEn: l.descriptionEn ?? l.descriptionAr, unit: l.unit, quantity: l.quantity, unitPrice: l.rate, groupId: null as string | null, extra: {} }))
          : source === "xl"
            ? xlItems.map((item) => ({ itemNo: item.itemNo, descriptionAr: item.descriptionAr, descriptionEn: item.descriptionEn, unit: item.unit, quantity: item.quantity, unitPrice: item.rate, groupId: item.groupId, extra: item.extra }))
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
        title: manual
          ? t(`manual.done_${source === "xl" ? "xl" : source === "man" ? "man" : "later"}`, { number: projectNo, count: lines.length })
          : source === "crm"
            ? t("wizard.done_crm", { number: projectNo, count: lines.length })
            : source === "xl"
              ? t("wizard.done_xl", { number: projectNo, count: lines.length })
              : t("wizard.done_empty", { number: projectNo }),
      })
      onOpenChange(false)
      router.push(`/contractor/projects/${projectId}?tab=pmToday`)
    } catch (err) {
      console.error(err)
      if (err instanceof PmManualProjectError) {
        toast({ title: t(`manual.block.${err.blocks[0]}`), variant: "destructive" })
        return
      }
      const code = err instanceof PmHandoverError ? err.code : "save"
      toast({ title: t(`error.${code === "save" ? "save" : code}`), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const steps = [t("wizard.step_project"), t("wizard.step_sections"), t("wizard.step_boq")]
  const ct = clientTypeKey(handover?.clientType)
  const end = manual ? manualEnd(draft.startOn, manualDuration(draft)) : null
  const pct = (x: number) => `${Math.round(x * 100)}%`
  const crmTag = <SourceBadge module="crm" label={t("wizard.from_crm")} className="ms-1.5 align-middle" />
  const limitText = (limit: number) => (limit === Number.POSITIVE_INFINITY ? t("wizard.no_limit") : t("wizard.limit", { amount: pmMoney(limit) }))

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{handover ? t("wizard.title") : t("manual.title")}</DialogTitle>
          <DialogDescription>
            {handover ? (
              <>
                <span dir="auto">{handover.title}</span>
                {handover.contractNumber && (
                  <span className="text-muted-foreground" dir="ltr">
                    {" "}
                    — {handover.contractNumber}
                  </span>
                )}{" "}
                {t("wizard.from_crm_sub")}
              </>
            ) : (
              t("manual.sub")
            )}
          </DialogDescription>
        </DialogHeader>

        <WizardSteps steps={steps} current={step} ariaLabel={t("wizard.steps_label")} />

        {step === 0 && manual && (
          <div className="space-y-4">
            <Callout tone="warn">{t("manual.exception")}</Callout>
            <div className="space-y-1.5">
              <Label htmlFor="new-name">
                {t("manual.name")} <span className="text-destructive">*</span>
              </Label>
              <Input id="new-name" dir="auto" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder={t("manual.name_ph")} disabled={busy} aria-required="true" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-client">
                  {t("field.client")} <span className="text-destructive">*</span>
                </Label>
                <Input id="new-client" dir="auto" value={draft.client} onChange={(e) => set("client", e.target.value)} placeholder={t("manual.client_ph")} disabled={busy} aria-required="true" />
                <p className="text-xs text-muted-foreground">{t("manual.client_hint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-kind">{t("manual.kind")}</Label>
                <Select
                  value={kind}
                  onValueChange={(v) => {
                    setKind(v as ProjectKind)
                    setSections(sectionsForKind(v as ProjectKind))
                  }}
                  disabled={busy}
                >
                  <SelectTrigger id="new-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {tShared(`pm_kind_${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t("manual.kind_hint")}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-region">{t("manual.region")}</Label>
                <Input id="new-region" dir="auto" value={draft.region} onChange={(e) => set("region", e.target.value)} placeholder={t("manual.region_ph")} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-loc">{t("wizard.site_location")}</Label>
                <Input id="new-loc" dir="auto" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("wizard.site_location_ph")} disabled={busy} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-pm">{t("wizard.pm_label")}</Label>
                <Select value={managerUid} onValueChange={setManagerUid} disabled={busy}>
                  <SelectTrigger id="new-pm">
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
                <p className="text-xs text-muted-foreground">{t("manual.pm_hint")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-site">{t("wizard.site_label")}</Label>
                <Select value={siteUid || "__later"} onValueChange={(v) => setSiteUid(v === "__later" ? "" : v)} disabled={busy}>
                  <SelectTrigger id="new-site">
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
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="new-start">{t("manual.start")}</Label>
                <Input id="new-start" type="date" dir="ltr" value={draft.startOn} onChange={(e) => set("startOn", e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-dur">{t("manual.duration")}</Label>
                <Input id="new-dur" type="number" min={1} dir="ltr" value={draft.duration} onChange={(e) => set("duration", e.target.value)} placeholder="365" disabled={busy} />
                <p className="text-xs text-muted-foreground">{draft.duration.trim() && end ? t("manual.ends", { date: pmDate(end, locale) }) : t("manual.ends_auto")}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-val">{t("manual.value")}</Label>
                <Input id="new-val" type="number" min={0} dir="ltr" value={draft.value} onChange={(e) => set("value", e.target.value)} placeholder="—" disabled={busy} />
                <p className="text-xs text-muted-foreground">{t("manual.value_hint")}</p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">{t("manual.advance")}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {ADVANCE_CHOICES.map((x) => (
                    <button
                      key={x}
                      type="button"
                      aria-pressed={draft.advance === x}
                      onClick={() => set("advance", x)}
                      disabled={busy}
                      className={cn(
                        "min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        draft.advance === x ? "border-module bg-module/10 text-module" : "hover:border-module/40"
                      )}
                    >
                      {x ? <span dir="ltr">{pct(x)}</span> : t("manual.advance_none")}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">{t("manual.retention")}</legend>
                <div className="flex flex-wrap gap-1.5">
                  {RETENTION_CHOICES.map((x) => (
                    <button
                      key={x}
                      type="button"
                      aria-pressed={draft.retention === x}
                      onClick={() => set("retention", x)}
                      disabled={busy}
                      className={cn(
                        "min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        draft.retention === x ? "border-module bg-module/10 text-module" : "hover:border-module/40"
                      )}
                    >
                      {x ? <span dir="ltr">{pct(x)}</span> : t("manual.retention_none")}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            {(manualBlocks.includes("no_name") || manualBlocks.includes("no_client")) && (draft.name || draft.client) && <p className="text-xs font-semibold text-destructive">{t("manual.required")}</p>}
          </div>
        )}

        {step === 0 && handover && (
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
              {fileExtras(handover).consultantName && <KeyValueRow label={t("wizard.row_consultant")} value={<span dir="auto">{fileExtras(handover).consultantName}</span>} />}
              <KeyValueRow label={t("wizard.row_boq")} value={crmCount ? t("wizard.boq_from_bid", { count: crmCount }) : <span className="font-bold text-destructive">{t("wizard.boq_not_attached")}</span>} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="acc-region">{t("manual.region")}</Label>
                <Input id="acc-region" dir="auto" value={region} onChange={(e) => setRegion(e.target.value)} placeholder={t("manual.region_ph")} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-loc">{t("wizard.site_location")}</Label>
                <Input id="acc-loc" dir="auto" value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("wizard.site_location_ph")} disabled={busy} />
              </div>
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
                {(handover ? boqSourcesFor(handover) : boqSourcesFor({ boq: [] })).map((s) => {
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
                {xlLoaded && xlBad.length === 0 && <p className="text-sm font-semibold text-success">{t("wizard.boq_loaded", { count: xlItems.length })}</p>}
                {xlBad.length > 0 && (
                  <Callout tone="block">
                    <p className="font-bold">{t("wizard.xl_bad", { count: xlBad.length })}</p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {xlBad.slice(0, 8).map((r) => (
                        <li key={r.line}>
                          {t("wizard.xl_bad_row", { line: r.line })} <span dir="ltr">{r.code}</span> — {r.problems.map((p) => t(`boq.problem.${p}`)).join(" · ")}
                        </li>
                      ))}
                    </ul>
                    {xlBad.length > 8 && <p className="mt-1 text-xs">{t("wizard.xl_bad_more", { count: xlBad.length - 8 })}</p>}
                  </Callout>
                )}
                {xlLoaded && xlItems.length > 0 && (
                  <section className="rounded-xl border" aria-labelledby="xl-review-title">
                    <div className="border-b px-3 py-2">
                      <p id="xl-review-title" className="text-sm font-bold">
                        {t("wizard.xl_review_title")}
                      </p>
                      <p className={cn("text-xs", xlUnpriced ? "font-semibold text-warning" : "text-muted-foreground")}>
                        {xlUnpriced ? t("wizard.xl_review_unpriced", { count: xlItems.length, unpriced: xlUnpriced }) : t("wizard.xl_review_all_priced", { count: xlItems.length })}
                      </p>
                    </div>
                    <ul className="max-h-64 divide-y overflow-y-auto">
                      {xlItems.map((item) => {
                        const unpriced = !(item.rate > 0)
                        return (
                          <li key={item.id} className={cn("flex items-start gap-3 px-3 py-2 text-xs", unpriced && "bg-warning/5")}>
                            <span className="w-16 shrink-0 font-mono tabular-nums text-muted-foreground" dir="ltr">
                              {item.itemNo || "—"}
                            </span>
                            <span className="min-w-0 flex-1" dir="auto">
                              {(locale === "ar" ? item.descriptionAr || item.descriptionEn : item.descriptionEn || item.descriptionAr) || "—"}
                            </span>
                            <span className="shrink-0 tabular-nums" dir="ltr">
                              {item.quantity} {item.unit}
                            </span>
                            <span className="w-24 shrink-0 text-end">
                              {unpriced ? <StatusPill tone="warn">{t("wizard.xl_unpriced")}</StatusPill> : <span className="tabular-nums">{pmMoney(item.rate)}</span>}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )}
              </>
            )}
            <div className="rounded-xl border px-4">
              <KeyValueRow label={t("wizard.row_project")} value={<span dir="auto">{title || "—"}</span>} />
              <KeyValueRow label={t("field.client")} value={(handover ? handover.clientName : draft.client.trim()) || "—"} />
              <KeyValueRow
                label={t("wizard.row_value_duration")}
                value={
                  handover
                    ? `${pmMoney(handover.value)} · ${t("days", { count: handover.durationDays })}`
                    : `${manualValue(draft) > 0 ? pmMoney(manualValue(draft)) : t("not_fixed")} · ${t("days", { count: manualDuration(draft) })}`
                }
              />
              <KeyValueRow label={t("wizard.row_start")} value={pmDate(handover ? handover.startOn : draft.startOn, locale)} />
              <KeyValueRow label={t("wizard.row_manager")} value={manager ? manager.name : "—"} />
              <KeyValueRow label={t("wizard.row_sections")} value={`${sections.length} — ${sections.map(secName).join(" · ")}`} />
            </div>
            <div className="rounded-xl border border-cta/20 bg-cta/5 p-3">
              <p className="mb-2 text-sm font-bold">{t("wizard.effects_title")}</p>
              <ul className="space-y-1.5 text-xs">
                {[
                  { k: "eff_project", ok: true },
                  ...(handover ? [{ k: "eff_crm", ok: true }] : []),
                  ...(source === "crm" ? [{ k: "eff_boq", ok: true }] : []),
                  { k: "eff_sections", ok: true },
                  ...(advance && !selfDev && (handover || manualValue(draft) > 0) ? [{ k: "effect_advance", ok: true }] : []),
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
            <Button onClick={() => setStep((s) => s + 1)} disabled={step === 0 && (!managerUid || manualBlocks.length > 0)}>
              {t("next")}
            </Button>
          ) : (
            <Button onClick={() => void accept()} disabled={busy || blocks.length > 0 || parsing}>
              {busy ? <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" /> : <Check size={16} className="me-2" aria-hidden="true" />}
              {handover ? t("wizard.submit") : t("manual.submit")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
