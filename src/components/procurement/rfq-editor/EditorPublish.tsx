"use client"

// Step 2 — «النشر» (PUR-01 p.3, PUR-02): who it reaches, the deadline, how it is priced.
// The values arrive filled — public with the favourites, the deadline from the settings,
// per-line pricing — so this step is usually one press of «التالي». «خيارات أخرى» keeps
// the title, payment terms, notes and attachments, and the internal budget the supplier
// never sees. The SAME step from the incoming request's panel and from the editor.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown, Globe, Handshake, Loader2, Lock, Paperclip, Trash2, UserPlus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/module-ui/Chip"
import { Callout } from "@/components/module-ui/Callout"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { SupplierRecipientsPicker, type SupplierOption } from "@/components/contractor/SupplierRecipientsPicker"
import { RfqTermsPicker, type TermRow } from "@/components/procurement/rfq/RfqTermsPicker"
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
  directPrices: Record<string, string>
  directReason: "" | "sole" | "match" | "urgent"
}

export function EditorPublish({
  values,
  onChange,
  lines,
  publicReachCount,
  favouriteName,
  recipientOptions,
  recipientFacts,
  selectedRecipients,
  directPool,
  directOverCap,
  firstDeadline,
  deadlineHint,
  onInvite,
  onUpload,
  uploading,
  onRemoveAttachment,
  showProblems,
}: {
  values: PublishValues
  onChange: (patch: Partial<PublishValues>) => void
  /** The RFQ's complete lines, for direct prices. */
  lines: Array<{ key: string; name: string; quantity: number; unit: string }>
  publicReachCount: number
  favouriteName: string | null
  recipientOptions: SupplierOption[]
  recipientFacts: Map<string, { onTime: number | null; crExpired: boolean; block?: SourcingBlock | null }>
  selectedRecipients: string[]
  directPool: Array<{ orgId: string; name: string; platform: boolean; favourite: boolean }>
  directOverCap: boolean
  firstDeadline: string
  deadlineHint: string
  onInvite: () => void
  onUpload: (files: File[]) => void
  uploading: boolean
  onRemoveAttachment: (path: string) => void
  showProblems: boolean
}) {
  const t = useTranslations("Portal.ProcEditor")
  const [more, setMore] = useState(false)
  const multi = lines.length > 1
  const deadlineBad = showProblems && values.audience !== "direct" && (!values.deadline || values.deadline < firstDeadline)

  return (
    <div className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-bold">{t("audience")}</legend>
        <div className="flex flex-wrap gap-2">
          <Chip selected={values.audience === "public"} icon={Globe} onClick={() => onChange({ audience: "public" })}>
            {t("aud_public")}
          </Chip>
          <Chip selected={values.audience === "private"} icon={Lock} onClick={() => onChange({ audience: "private" })}>
            {t("aud_private")}
          </Chip>
          <Chip selected={values.audience === "direct"} icon={Handshake} onClick={() => onChange({ audience: "direct", pricing: "line" })}>
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
            <SupplierRecipientsPicker options={recipientOptions} selected={selectedRecipients} onChange={(next) => onChange({ recipients: next })} facts={recipientFacts} />
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
            <label className="block space-y-1 text-sm">
              <span className="font-semibold">{t("direct_supplier")}</span>
              <NativeSelect value={values.directSupplierOrgId} onChange={(e) => onChange({ directSupplierOrgId: e.target.value })} className={cn("w-full", showProblems && !values.directSupplierOrgId && "border-destructive")}>
                <option value="">{t("direct_pick")}</option>
                {directPool.map((p) => (
                  <option key={p.orgId} value={p.orgId}>
                    {p.name}
                    {p.favourite ? ` · ${t("favourite")}` : p.platform ? ` · ${t("platform")}` : ""}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">{t("direct_prices")}</p>
              {lines.map((l) => {
                const bad = showProblems && !(Number(values.directPrices[l.key]) > 0)
                return (
                  <label key={l.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate" dir="auto">
                      {l.name} <span className="text-xs text-muted-foreground">· {l.quantity.toLocaleString("en-US")} {l.unit}</span>
                    </span>
                    <Input inputMode="decimal" value={values.directPrices[l.key] || ""} onChange={(e) => onChange({ directPrices: { ...values.directPrices, [l.key]: e.target.value } })} aria-label={t("direct_price_of", { name: l.name })} className={cn("h-9 w-28 text-end tabular-nums", bad && "border-destructive")} dir="ltr" />
                  </label>
                )
              })}
            </div>
            {directOverCap && (
              <label className="block space-y-1 text-sm">
                <span className="font-semibold">{t("direct_reason")}</span>
                <NativeSelect value={values.directReason} onChange={(e) => onChange({ directReason: e.target.value as PublishValues["directReason"] })} className={cn("w-full", showProblems && !values.directReason && "border-destructive")}>
                  <option value="">{t("direct_reason_pick")}</option>
                  <option value="sole">{t("direct_reason_sole")}</option>
                  <option value="match">{t("direct_reason_match")}</option>
                  <option value="urgent">{t("direct_reason_urgent")}</option>
                </NativeSelect>
              </label>
            )}
          </div>
        )}
      </fieldset>

      {values.audience !== "direct" && (
        <label className="block max-w-xs space-y-1">
          <span className="text-sm font-bold">{t("deadline")}</span>
          <Input type="date" min={firstDeadline} value={values.deadline} onChange={(e) => onChange({ deadline: e.target.value })} className={cn(deadlineBad && "border-destructive")} dir="ltr" />
          <span className={cn("block text-xs", deadlineBad ? "font-semibold text-destructive" : "text-muted-foreground")}>{deadlineBad ? t("err_deadline") : deadlineHint}</span>
        </label>
      )}

      {values.audience !== "direct" && multi && (
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

      <div className="rounded-xl border">
        <button type="button" onClick={() => setMore(!more)} aria-expanded={more} className="flex min-h-11 w-full items-center justify-between gap-2 px-4 text-start text-sm font-semibold">
          <span>
            {t("more")} <span className="font-normal text-muted-foreground">· {t("more_list")}</span>
          </span>
          <ChevronDown size={15} className={cn("transition-transform", more && "rotate-180")} aria-hidden="true" />
        </button>
        {more && (
          <div className="space-y-5 border-t p-4">
            <label className="block space-y-1">
              <span className="text-sm font-semibold">{t("title_label")}</span>
              <Input value={values.title} onChange={(e) => onChange({ title: e.target.value })} dir="auto" />
              <span className="block text-xs text-muted-foreground">{t("title_hint")}</span>
            </label>
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
            {values.audience !== "direct" && (
              <label className="block max-w-xs space-y-1">
                <span className="text-sm font-semibold">{t("budget")}</span>
                <Input inputMode="decimal" value={values.budget} onChange={(e) => onChange({ budget: e.target.value })} dir="ltr" className="tabular-nums" />
                <span className="block text-xs text-muted-foreground">{t("budget_hint")}</span>
              </label>
            )}
          </div>
        )}
      </div>
      {values.audience === "private" && !recipientOptions.length && <Callout tone="warn">{t("no_connected")}</Callout>}
    </div>
  )
}
