"use client"

// Accepting a handover (HO-02, WF-01): project & contract (read from CRM, not
// edited here) → sections preset by project type → BOQ & review. Acceptance
// creates the project "not started" with its number and its manager, and sends
// the advance term to Finance once. The BOQ is written right after, in the
// same shape the new-project wizard writes.

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react"
import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { WizardSteps } from "@/components/module-ui/WizardSteps"
import { useFirestore } from "@/firebase"
import { useRouter } from "@/i18n/routing"
import { useToast } from "@/hooks/use-toast"
import { parseBoqFile, type BoqParseResult } from "@/lib/boq-parser"
import { SECTION_IDS, SECTION_REGISTRY, sectionLabelKey, type SectionId } from "@/lib/project-sections"
import { pmDate, pmMoney, pmPct } from "@/lib/pm/format"
import { acceptBlocks, isSelfDevelopment, PROJECT_KINDS, type PmHandover, type ProjectKind } from "@/lib/pm/handover"
import { acceptHandover, PmHandoverError, type PmActor } from "@/lib/pm/handover-writes"
import { sectionsForKind } from "@/lib/pm/sections"

const BUILT: SectionId[] = SECTION_IDS.filter((id) => SECTION_REGISTRY[id].status === "built")

export function AcceptHandoverWizard({
  open,
  onOpenChange,
  handover,
  actor,
  groupId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  handover: PmHandover
  actor: PmActor
  groupId: string | null
}) {
  const t = useTranslations("Portal.PM")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const router = useRouter()
  const { toast } = useToast()

  const [step, setStep] = useState(0)
  const [kind, setKind] = useState<ProjectKind>(handover.kind ?? "bld")
  const [location, setLocation] = useState(handover.location ?? "")
  const [sections, setSections] = useState<SectionId[]>(sectionsForKind(handover.kind ?? "bld"))
  const [sectionsTouched, setSectionsTouched] = useState(false)
  const [boq, setBoq] = useState<BoqParseResult | null>(null)
  const [parsing, setParsing] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setStep(0)
    setKind(handover.kind ?? "bld")
    setLocation(handover.location ?? "")
    setSections(sectionsForKind(handover.kind ?? "bld"))
    setSectionsTouched(false)
    setBoq(null)
  }, [open, handover])

  const onKind = (k: ProjectKind) => {
    setKind(k)
    if (!sectionsTouched) setSections(sectionsForKind(k))
  }

  const toggleSection = (id: SectionId, on: boolean) => {
    if (SECTION_REGISTRY[id].required) return
    setSectionsTouched(true)
    setSections((cur) => (on ? SECTION_IDS.filter((s) => s === id || cur.includes(s)) : cur.filter((s) => s !== id)))
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

  const blocks = acceptBlocks(handover).map((b) => t(`accept_block.${b}`))
  const boqItems = (boq?.items ?? []).filter((i) => i.selected)
  const selfDev = isSelfDevelopment(kind)

  const accept = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      const { projectId, projectNo } = await acceptHandover(firestore, actor, handover.id, {
        kind,
        location: location.trim() || null,
        enabledSections: sections,
        groupId,
        notification: { title: t("notif.accepted_title"), message: t("notif.accepted_message", { project: handover.title, by: actor.name ?? "" }) },
      })
      if (boqItems.length) {
        const batch = writeBatch(firestore)
        const itemsRef = collection(firestore, "projects", projectId, "boqItems")
        const groupsRef = collection(firestore, "projects", projectId, "boqGroups")
        boqItems.forEach((item) =>
          batch.set(doc(itemsRef), {
            itemNo: item.itemNo,
            descriptionAr: item.descriptionAr,
            descriptionEn: item.descriptionEn,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.rate || 0,
            sheet: item.sheet,
            divisionNo: item.divisionNo,
            divisionNameEn: item.divisionNameEn,
            divisionNameAr: item.divisionNameAr,
            subCategoryCode: item.subCategoryCode,
            subCategoryNameEn: item.subCategoryNameEn,
            subCategoryNameAr: item.subCategoryNameAr,
            suggestedCategory: item.suggestedCategory,
            suggestedSubCategory: item.suggestedSubCategory,
            tenderId: null,
            isEditable: true,
            groupId: item.groupId,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        )
        const used = new Set(boqItems.map((i) => i.groupId))
        ;(boq?.groups ?? []).filter((g) => used.has(g.id)).forEach((g) => batch.set(doc(groupsRef, g.id), { titleAr: g.titleAr, categoryAr: g.categoryAr, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
        try {
          await batch.commit()
        } catch (err) {
          console.error(err)
          toast({ title: t("wizard.boq_partial"), variant: "destructive" })
        }
      }
      toast({ title: t("wizard.done", { number: projectNo }) })
      onOpenChange(false)
      router.push(`/contractor/projects/${projectId}`)
    } catch (err) {
      console.error(err)
      const code = err instanceof PmHandoverError ? err.code : "save"
      toast({ title: t(`error.${code === "save" ? "save" : code}`), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const steps = [t("wizard.step_project"), t("wizard.step_sections"), t("wizard.step_boq")]

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("wizard.title")}</DialogTitle>
          <DialogDescription>{handover.title}</DialogDescription>
        </DialogHeader>

        <WizardSteps steps={steps} current={step} ariaLabel={t("wizard.steps_label")} />

        {step === 0 && (
          <div className="space-y-4">
            <Callout tone="info">{t("wizard.read_only_note")}</Callout>
            <div className="rounded-xl border px-4">
              <KeyValueRow label={t("field.client")} value={handover.clientName ?? "—"} />
              <KeyValueRow label={t("field.contract_number")} value={handover.contractNumber ?? "—"} ltr />
              <KeyValueRow label={t("field.value")} value={handover.value > 0 ? pmMoney(handover.value) : t("not_fixed")} ltr strong />
              <KeyValueRow label={t("field.duration")} value={handover.durationDays > 0 ? t("days", { count: handover.durationDays }) : t("not_fixed")} />
              <KeyValueRow label={t("field.signed_on")} value={pmDate(handover.signedOn, locale)} />
              <KeyValueRow label={t("field.start_on")} value={pmDate(handover.startOn, locale)} />
              <KeyValueRow label={t("field.advance_retention")} value={`${pmPct(handover.advance)} · ${pmPct(handover.retention)}`} ltr />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="acc-kind">{t("field.kind")}</Label>
                <Select value={kind} onValueChange={(v) => onKind(v as ProjectKind)} disabled={busy}>
                  <SelectTrigger id="acc-kind">
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
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-loc">{t("field.location")}</Label>
                <Input id="acc-loc" value={location} onChange={(e) => setLocation(e.target.value)} disabled={busy} />
              </div>
            </div>
            {selfDev && <Callout tone="warn">{t("wizard.self_dev_note")}</Callout>}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("wizard.sections_note", { kind: tShared(`pm_kind_${kind}`) })}</p>
            <ul className="divide-y rounded-xl border">
              {BUILT.map((id) => {
                const required = SECTION_REGISTRY[id].required
                const on = sections.includes(id)
                return (
                  <li key={id} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
                    <Label htmlFor={`sec-${id}`} className="text-sm font-semibold">
                      {tShared(sectionLabelKey(id))}
                      {required && <span className="ms-2 text-[11px] font-normal text-muted-foreground">{t("wizard.core")}</span>}
                    </Label>
                    <Switch id={`sec-${id}`} checked={on} disabled={required || busy} onCheckedChange={(v) => toggleSection(id, v)} />
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-xl border border-dashed p-4">
              <p className="flex items-center gap-2 text-sm font-bold">
                <FileSpreadsheet size={16} className="text-module" aria-hidden="true" />
                {t("wizard.boq_title")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t("wizard.boq_note")}</p>
              <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-sm font-semibold hover:border-module/40 focus-within:ring-2 focus-within:ring-ring">
                {parsing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
                {t("wizard.boq_upload")}
                <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} disabled={parsing || busy} />
              </label>
              {boq && <p className="mt-2 text-sm font-semibold text-success">{t("wizard.boq_loaded", { count: boqItems.length })}</p>}
              {!boq && <p className="mt-2 text-xs text-muted-foreground">{t("wizard.boq_later")}</p>}
            </div>
            <ul className="space-y-1.5 rounded-xl border border-cta/20 bg-cta/5 p-3 text-xs">
              {["effect_project", "effect_manager", "effect_terms", ...(handover.advance && !selfDev ? ["effect_advance"] : []), "effect_crm"].map((k) => (
                <li key={k} className="flex items-start gap-2">
                  <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-cta" aria-hidden="true" />
                  <span>{t(`wizard.${k}`)}</span>
                </li>
              ))}
            </ul>
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
            <Button onClick={() => setStep((s) => s + 1)}>{t("next")}</Button>
          ) : (
            <Button onClick={() => void accept()} disabled={busy || blocks.length > 0 || parsing}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("wizard.submit")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
