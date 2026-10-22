"use client"

import { useRef, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Check, FileUp, Minus, Plus, Truck } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Chip } from "@/components/module-ui/Chip"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { GuestPapersField, type GuestPaperFiles } from "./GuestPapersField"
import { PAY_PRESETS, type FormState, type PayPreset } from "./link-types"

// «عرضك» (LNK-07). FOUR things are required — the days to supply (1 to 365), how long the quote holds (not before the request
// closes), the company and the mobile — and they are starred. Payment terms, «غير مسجّل ضريبياً» and «للطلب كاملاً فقط» are
// optional; the official quote, the note, the contact, the e-mail and the papers are folded away until he opens them.
export function OfferFields({
  form,
  onChange,
  close,
  verified,
  lineMode,
  manyLines,
  termsLabel,
  extras,
  onExtras,
  pdf,
  onPdf,
  papers,
  onPapers,
  onRefused,
  disabled = false,
  nameLocked = false,
}: {
  form: FormState
  onChange: (patch: Partial<FormState>) => void
  close: string | null
  verified: boolean
  lineMode: boolean
  manyLines: boolean
  termsLabel: string
  extras: boolean
  onExtras: (open: boolean) => void
  pdf: File | null
  onPdf: (file: File | null) => void
  papers: GuestPaperFiles
  onPapers: (next: GuestPaperFiles) => void
  onRefused: (message: string) => void
  disabled?: boolean
  nameLocked?: boolean
}) {
  const t = useTranslations("PublicRfq")
  const file = useRef<HTMLInputElement>(null)
  const field = (id: string, label: string, required: boolean, control: ReactNode, hint?: ReactNode) => (
    <div className="min-w-0 flex-1 basis-[calc(50%-0.5rem)] space-y-1.5 max-[420px]:basis-full">
      <Label htmlFor={id} className="text-xs font-semibold">
        {label} {required && <span className="text-destructive">*</span>}
        {hint}
      </Label>
      {control}
    </div>
  )

  return (
    <section className="space-y-3 rounded-md border bg-card p-3.5" aria-labelledby="link-offer-title">
      <h2 id="link-offer-title" className="flex items-center gap-2 text-sm font-bold text-foreground">
        <Truck size={15} className="text-primary" aria-hidden="true" />
        {t("offer_title")}
      </h2>
      <div className="flex flex-wrap gap-4">
        {field("lk-days", t("days_label"), true, <Input id="lk-days" inputMode="numeric" dir="ltr" disabled={disabled} value={form.days} placeholder={t("days_ph")} onChange={(e) => onChange({ days: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })} className="h-11 text-start" />)}
        {field("lk-valid", t("valid_label"), true, <Input id="lk-valid" type="date" dir="ltr" disabled={disabled} min={close || undefined} value={form.valid} onChange={(e) => onChange({ valid: e.target.value })} className="h-11 text-start" />)}
        {field("lk-company", t("company_label"), true, <Input id="lk-company" autoComplete="organization" disabled={disabled || nameLocked} value={form.company} onChange={(e) => onChange({ company: e.target.value })} className="h-11" dir="auto" />)}
        {field(
          "lk-mobile",
          t("mobile_label"),
          true,
          <Input id="lk-mobile" inputMode="tel" autoComplete="tel" dir="ltr" placeholder="05XXXXXXXX" disabled={disabled} readOnly={verified} value={form.mobile} onChange={(e) => onChange({ mobile: e.target.value })} className="h-11 text-start" />,
          verified ? (
            <span className="ms-2 inline-flex items-center gap-0.5 font-semibold text-success">
              <Check size={11} aria-hidden="true" />
              {t("mobile_verified")}
            </span>
          ) : undefined
        )}
        {field(
          "lk-terms",
          t("terms_label"),
          false,
          <NativeSelect id="lk-terms" disabled={disabled} value={form.pay} onChange={(e) => onChange({ pay: e.target.value as PayPreset | "" })} className="h-11 w-full">
            <option value="">{`${t("terms_accept")}${termsLabel ? `: ${termsLabel}` : ""}`}</option>
            {PAY_PRESETS.map((p) => (
              <option key={p} value={p}>
                {t("terms_propose", { terms: t(`terms_p_${p}`) })}
              </option>
            ))}
          </NativeSelect>
        )}
        <div className="flex min-w-0 flex-1 basis-[calc(50%-0.5rem)] flex-col justify-end gap-2 max-[420px]:basis-full">
          <Chip selected={form.nonVat} disabled={disabled} onClick={() => onChange({ nonVat: !form.nonVat })} className="h-auto min-h-9 justify-start whitespace-normal text-start">
            {t("nonvat_toggle")}
          </Chip>
          {lineMode && manyLines && (
            <Chip selected={form.whole} disabled={disabled} onClick={() => onChange({ whole: !form.whole })} className="h-auto min-h-9 justify-start whitespace-normal text-start">
              {t("whole_toggle")}
            </Chip>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onExtras(!extras)}
        aria-expanded={extras}
        className="inline-flex items-center gap-1.5 rounded-md text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {extras ? <Minus size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
        {extras ? t("extras_hide") : t("extras_show")}
      </button>

      {extras && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3" data-extras>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">{t("extra_file")}</Label>
            <input ref={file} type="file" accept="application/pdf" className="sr-only" aria-label={t("extra_file")} onChange={(e) => onPdf(e.target.files?.[0] ?? null)} />
            <button type="button" disabled={disabled} onClick={() => file.current?.click()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-dashed bg-background px-3 text-xs font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <FileUp size={14} aria-hidden="true" />
              <span className="truncate" dir="auto">
                {pdf ? pdf.name : t("extra_file")}
              </span>
            </button>
            <p className="text-[11px] text-muted-foreground">{t("extra_file_hint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lk-note" className="text-xs font-semibold">
              {t("extra_note")}
            </Label>
            <Textarea id="lk-note" disabled={disabled} value={form.note} placeholder={t("extra_note_ph")} onChange={(e) => onChange({ note: e.target.value.slice(0, 2000) })} className="min-h-[72px]" dir="auto" />
          </div>
          <div className="flex flex-wrap gap-4">
            {field("lk-contact", t("extra_contact"), false, <Input id="lk-contact" autoComplete="name" disabled={disabled} value={form.contact} onChange={(e) => onChange({ contact: e.target.value })} className="h-11" dir="auto" />)}
            {field("lk-email", t("extra_email"), false, <Input id="lk-email" type="email" autoComplete="email" dir="ltr" disabled={disabled} value={form.email} onChange={(e) => onChange({ email: e.target.value })} className="h-11 text-start" />)}
            {field("lk-vat", t("extra_vat"), false, <Input id="lk-vat" inputMode="numeric" dir="ltr" disabled={disabled} value={form.vat} onChange={(e) => onChange({ vat: e.target.value.replace(/[^\d]/g, "").slice(0, 15) })} className="h-11 text-start" />)}
          </div>
          <GuestPapersField value={papers} onChange={onPapers} onRefused={onRefused} />
          <p className="text-[11px] text-muted-foreground">{t("extra_cr_hint")}</p>
        </div>
      )}
    </section>
  )
}
