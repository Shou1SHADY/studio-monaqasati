"use client"

// Step 2 — «النشر» (PUR-01 p.3, PUR-02): who it reaches, the deadline, how it is priced.
// The values arrive filled — public with the favourites, the deadline from the settings,
// per-line pricing — so this step is usually one press of «التالي». Payment terms are three
// chips (and a disabled «بالأجل عبر مدماك — قريباً»); the visitor link is a switch, on for «عام»
// and off for «خاص» and «إسناد مباشر» unless asked. A direct award shows the server's estimate
// and, above the cap, the reason. «خيارات أخرى» keeps the notes and attachments and the internal
// budget the supplier never sees. The SAME step from the incoming request's panel and the editor.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, Coins, Globe, Handshake, Loader2, Lock, Paperclip, Trash2, UserPlus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/module-ui/Chip"
import { Callout } from "@/components/module-ui/Callout"
import { SupplierRecipientsPicker, orderRecipients, type SupplierOption } from "@/components/contractor/SupplierRecipientsPicker"
import { RfqTermsPicker, type TermRow } from "@/components/procurement/rfq/RfqTermsPicker"
import { BnplSoonDialog } from "./BnplSoonDialog"
import { DIRECT_WHY_CODES, TERM_PRESETS, TERM_PRESET_IDS, presetOfTerms, type DirectEstimate, type DirectWhyCode } from "@/lib/procurement/rfq-publish-rules"
import { cn } from "@/lib/utils"
import type { SourcingBlock } from "@/lib/procurement/supplier-file"

export type Audience = "public" | "private" | "direct"
export type Pricing = "line" | "total"

export interface PublishValues {
  audience: Audience
  deadline: string
  pricing: Pricing
  title: string
  terms: TermRow[]
  termsSet: boolean
  notes: string
  budget: string
  attachments: Array<{ name: string; url: string; path: string }>
  /** Private: the picked recipients (null = every connected supplier). */
  recipients: string[] | null
  directSupplierOrgId: string
  directReason: "" | DirectWhyCode
  directNote: string
  /** The visitor link: null = the audience's default (on for «عام», off for the others). */
  link: boolean | null
}

export const linkOn = (v: Pick<PublishValues, "link" | "audience">): boolean => v.link ?? v.audience === "public"

export function EditorPublish({
  values,
  onChange,
  publicReachCount,
  linesCount,
  favouriteName,
  recipientOptions,
  recipientFacts,
  selectedRecipients,
  directPool,
  matching,
  estimate,
  directCap,
  firstDeadline,
  deadlineHint,
  onInvite,
  onUpload,
  uploading,
  onRemoveAttachment,
  showProblems,
  supplierSubs,
  directFacts,
}: {
  values: PublishValues
  onChange: (patch: Partial<PublishValues>) => void
  publicReachCount: number
  linesCount: number
  favouriteName: string | null
  recipientOptions: SupplierOption[]
  recipientFacts: Map<string, { onTime: number | null; crExpired: boolean; block?: SourcingBlock | null }>
  selectedRecipients: string[]
  directPool: Array<{ orgId: string; name: string; platform: boolean; favourite: boolean }>
  /** The suppliers whose sub-categories the materials fall in («مختص»). */
  matching: ReadonlySet<string>
  /** The direct award's estimate from the last prices (null until the rows are complete). */
  estimate: DirectEstimate | null
  directCap: number
  firstDeadline: string
  deadlineHint: string
  onInvite: () => void
  onUpload: (files: File[]) => void
  uploading: boolean
  onRemoveAttachment: (path: string) => void
  showProblems: boolean
  /** ED-14: each supplier's sub-categories from the directory, named — shown under his name. */
  supplierSubs?: ReadonlyMap<string, string[]>
  /** ED-13: the direct pool's facts — on-time, sourcing block (any block stops a direct award), «مختص». */
  directFacts?: Map<string, { onTime: number | null; crExpired: boolean; block: SourcingBlock | null; matches: boolean }>
}) {
  const t = useTranslations("Portal.ProcEditor")
  const [more, setMore] = useState(false)
  const [soon, setSoon] = useState(false)
  const multi = linesCount > 1
  const deadlineBad = showProblems && (!values.deadline || values.deadline < firstDeadline)
  const over = values.audience === "direct" && estimate != null && estimate.total > directCap
  const preset = presetOfTerms(values.terms)
  const linkChecked = linkOn(values)
  const pickerFacts = useMemo(
    () => new Map(Array.from(recipientFacts, ([id, f]) => [id, { ...f, matches: matching.has(id), subs: supplierSubs?.get(id) || [] }] as const)),
    [recipientFacts, matching, supplierSubs],
  )
  // ED-13: direct uses the same rows as «خاص», one to choose.
  const directOptions: SupplierOption[] = useMemo(
    () => directPool.map((p) => ({ orgId: p.orgId, name: p.name, isFavorite: p.favourite, note: p.platform && !p.favourite ? t("platform") : undefined })),
    [directPool, t],
  )
  const directPickerFacts = useMemo(
    () =>
      new Map(
        directPool.map((p) => {
          const f = directFacts?.get(p.orgId) || recipientFacts.get(p.orgId)
          return [p.orgId, { onTime: f?.onTime ?? null, crExpired: f?.crExpired ?? false, block: f?.block ?? null, matches: matching.has(p.orgId), subs: supplierSubs?.get(p.orgId) || [] }] as const
        }),
      ),
    [directPool, directFacts, recipientFacts, matching, supplierSubs],
  )
  /** Switching to direct picks the first favourite or «مختص» supplier who may be awarded (prototype `pub-to`). */
  const firstDirect = () => orderRecipients(directOptions, directPickerFacts).find((o) => !directPickerFacts.get(o.orgId)?.block && (o.isFavorite || directPickerFacts.get(o.orgId)?.matches))?.orgId || ""

  return (
    <div className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-bold">{t("audience")}</legend>
        <div className="flex flex-wrap gap-2">
          <Chip selected={values.audience === "public"} icon={Globe} onClick={() => onChange({ audience: "public", link: null })}>
            {t("aud_public")}
          </Chip>
          <Chip selected={values.audience === "private"} icon={Lock} onClick={() => onChange({ audience: "private", link: null })}>
            {t("aud_private")}
          </Chip>
          <Chip
            selected={values.audience === "direct"}
            icon={Handshake}
            onClick={() => onChange({ audience: "direct", link: null, ...(values.audience !== "direct" && !values.directSupplierOrgId ? { directSupplierOrgId: firstDirect() } : {}) })}
          >
            {t("aud_direct")}
          </Chip>
        </div>
        {values.audience === "public" && (
          <p className="text-sm text-muted-foreground">
            {t("reach_public", { count: publicReachCount })}
            {favouriteName ? ` ${t("reach_fav", { name: favouriteName })}` : ""}
          </p>
        )}
        {values.audience === "private" && (
          <div className="space-y-2">
            <SupplierRecipientsPicker options={recipientOptions} selected={selectedRecipients} onChange={(next) => onChange({ recipients: next })} facts={pickerFacts} />
            <p className={cn("text-xs", showProblems && !selectedRecipients.length ? "font-semibold text-destructive" : "text-muted-foreground")}>
              {t("reach_private", { count: selectedRecipients.length, total: recipientOptions.length })}
            </p>
            <Button type="button" variant="link" className="h-auto gap-1.5 p-0 text-cta" onClick={onInvite}>
              <UserPlus size={14} /> {t("invite_missing")}
            </Button>
          </div>
        )}
        {values.audience === "direct" && (
          <div className="space-y-3 rounded-xl border p-3">
            {directOptions.length > 0 ? (
              <SupplierRecipientsPicker
                id="rfq-direct"
                single
                heading={{ title: t("direct_supplier"), hint: t("direct_pick") }}
                options={directOptions}
                selected={values.directSupplierOrgId ? [values.directSupplierOrgId] : []}
                onChange={(next) => onChange({ directSupplierOrgId: next[0] || "" })}
                facts={directPickerFacts}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("direct_none")}</p>
            )}
            {showProblems && !values.directSupplierOrgId && <p className="text-xs font-semibold text-destructive">{t("err_direct_supplier")}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{t("direct_one")}</span>
              <Button type="button" variant="link" className="h-auto gap-1.5 p-0 text-cta" onClick={onInvite}>
                <UserPlus size={14} /> {t("invite_missing")}
              </Button>
            </div>
            {estimate && (
              <Callout tone={over ? "warn" : "info"}>
                {t("direct_est", { total: estimate.total.toLocaleString("en-US"), missing: estimate.missing, cap: directCap.toLocaleString("en-US") })}
                {over ? ` ${t("direct_est_over")}` : ""}
              </Callout>
            )}
            {over && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">
                  {t("direct_reason")} <span className="text-destructive">*</span>
                </p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("direct_reason")}>
                  {DIRECT_WHY_CODES.map((c) => (
                    <Chip key={c} role="radio" aria-checked={values.directReason === c} selected={values.directReason === c} onClick={() => onChange({ directReason: c })}>
                      {t(`direct_reason_${c}`)}
                    </Chip>
                  ))}
                </div>
                {values.directReason === "other" && (
                  <Input value={values.directNote} onChange={(e) => onChange({ directNote: e.target.value })} placeholder={t("direct_reason_other_ph")} dir="auto" aria-label={t("direct_reason_other_ph")} />
                )}
                {showProblems && (!values.directReason || (values.directReason === "other" && values.directNote.trim().length < 4)) && <p className="text-xs font-semibold text-destructive">{t("err_direct_reason")}</p>}
              </div>
            )}
          </div>
        )}
      </fieldset>

      <label className="block max-w-xs space-y-1">
        <span className="text-sm font-bold">{t("deadline")}</span>
        <Input type="date" min={firstDeadline} value={values.deadline} onChange={(e) => onChange({ deadline: e.target.value })} className={cn(deadlineBad && "border-destructive")} dir="ltr" />
        <span className={cn("block text-xs", deadlineBad ? "font-semibold text-destructive" : "text-muted-foreground")}>{deadlineBad ? t("err_deadline") : deadlineHint}</span>
      </label>

      <div className="space-y-1">
        <label className="flex items-center gap-3 text-sm font-bold">
          <Switch checked={linkChecked} onCheckedChange={(on) => onChange({ link: on })} aria-label={t("link_toggle")} />
          {t("link_toggle")}
        </label>
        <p className="text-xs text-muted-foreground">{values.audience === "public" ? t("link_toggle_public") : t("link_toggle_off")}</p>
      </div>

      {multi && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">{t("pricing")}</legend>
          <div className="flex flex-wrap gap-2">
            <Chip selected={values.pricing === "line"} onClick={() => onChange({ pricing: "line" })}>
              {t("pricing_line")}
            </Chip>
            <Chip selected={values.pricing === "total"} onClick={() => onChange({ pricing: "total" })}>
              {t("pricing_total")}
            </Chip>
          </div>
          <p className="text-xs text-muted-foreground">{values.pricing === "line" ? t("pricing_line_hint") : t("pricing_total_hint")}</p>
        </fieldset>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-bold">{t("terms_label")}</legend>
        <div className="flex flex-wrap gap-2">
          {TERM_PRESET_IDS.map((id) => (
            <Chip key={id} selected={preset === id && values.termsSet} onClick={() => onChange({ terms: TERM_PRESETS[id].map((r) => ({ pct: String(r.pct), days: String(r.days) })), termsSet: true })}>
              {t(`terms_chip_${id}`)}
            </Chip>
          ))}
          <Chip selected={false} icon={Coins} aria-disabled="true" className="border-dashed opacity-70" onClick={() => setSoon(true)}>
            {t("terms_chip_bnpl")}
            <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold text-muted-foreground">{t("terms_soon")}</span>
          </Chip>
        </div>
      </fieldset>

      <div className="rounded-xl border">
        <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="flex min-h-11 w-full items-center justify-between gap-2 px-4 text-start text-sm font-semibold">
          <span>{t("more_options")}</span>
          <ChevronDown size={15} className={cn("transition-transform", more && "rotate-180")} aria-hidden="true" />
        </button>
        {more && (
          <div className="space-y-5 border-t p-4">
            <RfqTermsPicker rows={values.terms} onChange={(rows) => onChange({ terms: rows, termsSet: true })} invalid={showProblems} />
            <label className="block space-y-1">
              <span className="text-sm font-semibold">{t("notes")}</span>
              <Textarea value={values.notes} onChange={(e) => onChange({ notes: e.target.value })} rows={3} dir="auto" />
            </label>
            <div className="space-y-2">
              <span className="text-sm font-semibold">{t("attachments")}</span>
              <ul className="space-y-1">
                {values.attachments.map((a) => (
                  <li key={a.path} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                    <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-cta hover:underline">
                      {a.name}
                    </a>
                    <Button type="button" variant="ghost" size="icon" onClick={() => onRemoveAttachment(a.path)} aria-label={t("remove")}>
                      <Trash2 size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
              <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-dashed px-3 text-sm font-semibold text-muted-foreground hover:text-foreground">
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Paperclip size={14} />}
                {t("attach_pdf")}
                <input type="file" accept="application/pdf" multiple className="sr-only" disabled={uploading} onChange={(e) => onUpload(Array.from(e.target.files || []))} />
              </label>
            </div>
            <label className="block max-w-xs space-y-1">
              <span className="text-sm font-semibold">{t("budget")}</span>
              <Input inputMode="decimal" value={values.budget} onChange={(e) => onChange({ budget: e.target.value })} dir="ltr" className="tabular-nums" />
              <span className="block text-xs text-muted-foreground">{t("budget_hint")}</span>
            </label>
          </div>
        )}
      </div>
      {values.audience === "private" && !recipientOptions.length && <Callout tone="warn">{t("no_connected")}</Callout>}
      <BnplSoonDialog open={soon} onOpenChange={setSoon} />
    </div>
  )
}
