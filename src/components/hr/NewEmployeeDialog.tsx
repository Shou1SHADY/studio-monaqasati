"use client"

// New employee in two steps (PRD EM-03, WF-03): the contract — source, names,
// nationality and trade, place, start, basic with its automatic allowances —
// then documents and bank. Blanks stay blank and show as not recorded; the
// blocking facts are said before saving. Government relations records a
// joiner without pay; the HR manager completes it.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { WizardSteps } from "@/components/module-ui/WizardSteps"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { useRouter } from "@/i18n/routing"
import { HIRE_SOURCES, newEmployeeBlocks, type HireSource } from "@/lib/hr/employee"
import { createEmployee } from "@/lib/hr/employee-writes"
import { hrMoney, todayDay } from "@/lib/hr/format"
import { payFromBasic, wageOf } from "@/lib/hr/pay"
import { UNASSIGNED_SITE, type HrSite } from "@/lib/hr/sites"
import { NATIONALITIES, TRADES, tradeOf } from "@/lib/hr/trades"
import { HrWriteError } from "@/lib/hr/write-guard"
import type { HrPortal } from "./HrShell"

interface Draft {
  source: HireSource
  nameAr: string
  nameEn: string
  nationality: string
  gender: "m" | "f"
  idNo: string
  trade: string
  siteId: string
  join: string
  contractType: "open" | "fixed"
  contractEnd: string
  basic: string
  iqama: string
  passport: string
  insurance: string
  licence: string
  forklift: string
  iban: string
}

const EMPTY: Draft = {
  source: "local",
  nameAr: "",
  nameEn: "",
  nationality: "sa",
  gender: "m",
  idNo: "",
  trade: "",
  siteId: UNASSIGNED_SITE,
  join: todayDay(),
  contractType: "open",
  contractEnd: "",
  basic: "",
  iqama: "",
  passport: "",
  insurance: "",
  licence: "",
  forklift: "",
  iban: "",
}

export function NewEmployeeDialog({ open, onOpenChange, access, actorName, sites, portal }: { open: boolean; onOpenChange: (o: boolean) => void; access: HrAccess; actorName: string; sites: HrSite[]; portal: HrPortal }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const router = useRouter()
  const { toast } = useToast()
  const [d, setD] = useState<Draft>({ ...EMPTY, join: todayDay() })
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const money = access.allowed("pay.view")
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const trade = tradeOf(d.trade)
  const saudi = d.nationality === "sa"
  const basic = d.basic.trim() === "" ? null : Number(d.basic)
  const pay = basic && basic > 0 ? payFromBasic(basic, access.settings.policies) : null

  const input = useMemo(
    () => ({
      source: d.source,
      nameAr: d.nameAr,
      nameEn: d.nameEn || null,
      nationality: d.nationality,
      gender: d.gender,
      idNo: d.idNo || null,
      trade: d.trade,
      siteId: d.siteId === UNASSIGNED_SITE ? null : d.siteId,
      join: d.join,
      contractType: d.contractType,
      contractEnd: d.contractEnd || null,
      basic: money ? basic : null,
      docs: {
        iqama: saudi ? null : d.iqama || null,
        passport: d.passport || null,
        insurance: d.insurance || null,
        licence: trade?.drives === "licence" ? d.licence || null : null,
        forklift: trade?.drives === "forklift" ? d.forklift || null : null,
      },
    }),
    [d, money, basic, saudi, trade]
  )
  const { blocks, warnings } = newEmployeeBlocks(input, { visas: access.settings.establishment.visas ?? null, today: todayDay() })
  // Step 1 is done when its own facts hold; document facts are checked on step 2.
  const stepOneBlocks = blocks.filter((b) => b !== "iqama_expired_site")

  const save = async () => {
    if (!firestore || !access.orgId || blocks.length) return
    setBusy(true)
    try {
      const r = await createEmployee(firestore, access.ctx, access.orgId, { uid: access.ctx.uid, name: actorName }, { ...input, iban: money ? d.iban || null : null }, { visas: access.settings.establishment.visas ?? null, policies: access.settings.policies })
      toast({ title: t("people.created", { no: String(r.no).padStart(4, "0") }) })
      onOpenChange(false)
      router.push(`/${portal}/hr/people/${r.id}`)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? (err.blocks[0] ? `new.block.${err.blocks[0]}` : `err.${err.code}`) : "err.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const date = (id: keyof Draft, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`ne-${id}`}>{label}</Label>
      <Input id={`ne-${id}`} type="date" dir="ltr" value={d[id] as string} onChange={(e) => set(id, e.target.value as never)} disabled={busy} />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("new.title")}</DialogTitle>
          <DialogDescription>{t("new.desc")}</DialogDescription>
        </DialogHeader>
        <WizardSteps steps={[t("new.step_contract"), t("new.step_docs")]} current={step} ariaLabel={t("new.steps")} />

        {step === 0 ? (
          <div className="space-y-4">
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{t("new.source")}</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {HIRE_SOURCES.map((s) => (
                  <Button key={s} type="button" variant={d.source === s ? "default" : "outline"} aria-pressed={d.source === s} onClick={() => set("source", s)} className="h-auto min-h-11 flex-col gap-0.5 py-2">
                    <span>{t(`source.${s}`)}</span>
                    {s === "visa" && <span className="text-[10px] font-normal opacity-80">{t("new.visas_left", { count: access.settings.establishment.visas ?? 0 })}</span>}
                  </Button>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ne-ar">{t("new.name_ar")}</Label>
                <Input id="ne-ar" dir="rtl" value={d.nameAr} onChange={(e) => set("nameAr", e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ne-en">{t("new.name_en")}</Label>
                <Input id="ne-en" dir="ltr" value={d.nameEn} onChange={(e) => set("nameEn", e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ne-nat">{t("new.nationality")}</Label>
                <Select value={d.nationality} onValueChange={(v) => set("nationality", v)} disabled={busy}>
                  <SelectTrigger id="ne-nat">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NATIONALITIES.map((n) => (
                      <SelectItem key={n} value={n}>
                        {t(`nat.${n}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ne-g">{t("new.gender")}</Label>
                <Select value={d.gender} onValueChange={(v) => set("gender", v as "m" | "f")} disabled={busy}>
                  <SelectTrigger id="ne-g">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="m">{t("gender.m")}</SelectItem>
                    <SelectItem value="f">{t("gender.f")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ne-id">{t(saudi ? "new.national_id" : "new.iqama_no")}</Label>
                <Input id="ne-id" dir="ltr" inputMode="numeric" value={d.idNo} onChange={(e) => set("idNo", e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ne-trade">{t("new.trade")}</Label>
                <SearchableSelect
                  id="ne-trade"
                  value={d.trade}
                  onChange={(v) => set("trade", v)}
                  options={TRADES.map((x) => ({ value: x.key, label: t(`trade.${x.key}` as "trade.mason"), group: t(`category.${x.category}`) }))}
                  placeholder={t("new.pick_trade")}
                  searchPlaceholder={t("search")}
                  noResultsText={t("no_results")}
                  disabled={busy}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ne-site">{t("new.site")}</Label>
                <SearchableSelect
                  id="ne-site"
                  value={d.siteId}
                  onChange={(v) => set("siteId", v)}
                  options={[{ value: UNASSIGNED_SITE, label: t("sites.unassigned") }, ...sites.filter((s) => s.active !== false).map((s) => ({ value: s.id, label: s.name }))]}
                  placeholder={t("new.site")}
                  searchPlaceholder={t("search")}
                  noResultsText={t("no_results")}
                  disabled={busy}
                />
              </div>
              {date("join", t("new.join"))}
              <div className="space-y-1.5">
                <Label htmlFor="ne-ct">{t("new.contract")}</Label>
                <Select value={d.contractType} onValueChange={(v) => set("contractType", v as "open" | "fixed")} disabled={busy}>
                  <SelectTrigger id="ne-ct">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">{t("contract.open")}</SelectItem>
                    <SelectItem value="fixed">{t("contract.fixed")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {d.contractType === "fixed" && date("contractEnd", t("new.contract_end"))}
              {money && (
                <div className="space-y-1.5">
                  <Label htmlFor="ne-basic">{t("new.basic")}</Label>
                  <Input id="ne-basic" type="number" min="0" step="any" inputMode="decimal" dir="ltr" value={d.basic} onChange={(e) => set("basic", e.target.value)} disabled={busy} />
                </div>
              )}
            </div>
            {money && pay && (
              <div className="rounded-xl border p-3">
                <KeyValueRow label={t("pay.basic")} value={hrMoney(pay.basic)} ltr />
                <KeyValueRow label={t("pay.housing")} value={hrMoney(pay.housing)} ltr />
                <KeyValueRow label={t("pay.transport")} value={hrMoney(pay.transport)} ltr />
                <KeyValueRow label={t("pay.wage")} value={hrMoney(wageOf(pay))} ltr strong />
              </div>
            )}
            {!money && <Callout tone="info">{t("new.no_pay_note")}</Callout>}
            <p className="text-xs text-muted-foreground">{t("new.probation_note")}</p>
            {warnings.filter((w) => w !== "no_basic" || money).map((w) => (
              <Callout key={w} tone="warn">
                {t(`new.warn.${w}`)}
              </Callout>
            ))}
            <BlockingReasons title={t("cannot_save")} reasons={stepOneBlocks.map((b) => t(`new.block.${b}`))} />
          </div>
        ) : (
          <div className="space-y-4">
            <Callout tone="info">{t("new.blanks_note")}</Callout>
            <div className="grid gap-3 sm:grid-cols-2">
              {!saudi && date("iqama", d.source === "visa" ? t("new.iqama_visa") : t("doc.iqama"))}
              {date("passport", t("doc.passport"))}
              {date("insurance", t("doc.insurance"))}
              {trade?.drives === "licence" && date("licence", t("doc.licence"))}
              {trade?.drives === "forklift" && date("forklift", t("doc.forklift"))}
              {money && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="ne-iban">{t("new.iban")}</Label>
                  <Input id="ne-iban" dir="ltr" value={d.iban} onChange={(e) => set("iban", e.target.value.toUpperCase())} disabled={busy} />
                </div>
              )}
            </div>
            <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`new.block.${b}`))} />
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <Button variant="outline" onClick={() => setStep(0)} disabled={busy}>
              {t("back")}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {t("cancel")}
            </Button>
          )}
          {step === 0 ? (
            <Button onClick={() => setStep(1)} disabled={stepOneBlocks.length > 0}>
              {t("next")}
            </Button>
          ) : (
            <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("new.save")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
