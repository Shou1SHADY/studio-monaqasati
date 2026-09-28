"use client"

import { useRef } from "react"
import { useTranslations } from "next-intl"
import { FileText, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { GUEST_PAPER_KINDS, guestPaperRefusal, type GuestPaperKind } from "@/lib/procurement/guest-supplier"

export type GuestPaperFiles = Partial<Record<GuestPaperKind, File>>

// «أوراقكم الرسمية (السجل التجاري · الشهادة الضريبية)» — one slot each. The
// same size/type rule runs here for a quick answer and again on the server.
export function GuestPapersField({ value, onChange, onRefused }: { value: GuestPaperFiles; onChange: (next: GuestPaperFiles) => void; onRefused: (message: string) => void }) {
  const t = useTranslations("PublicRfq.extras")
  const inputs = useRef<Partial<Record<GuestPaperKind, HTMLInputElement | null>>>({})

  const pick = (kind: GuestPaperKind, file: File | undefined) => {
    if (!file) return
    const refusal = guestPaperRefusal(file)
    if (refusal) {
      onRefused(refusal === "size" ? t("papers_too_large") : t("papers_bad_type"))
      const el = inputs.current[kind]
      if (el) el.value = ""
      return
    }
    onChange({ ...value, [kind]: file })
  }

  const clear = (kind: GuestPaperKind) => {
    const next = { ...value }
    delete next[kind]
    onChange(next)
    const el = inputs.current[kind]
    if (el) el.value = ""
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold">{t("papers_label")}</legend>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {GUEST_PAPER_KINDS.map((kind) => {
          const file = value[kind]
          return file ? (
            <div key={kind} className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 p-2.5">
              <FileText size={16} className="shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-bold text-muted-foreground">{t(`papers_kind_${kind}`)}</span>
                <span className="block truncate text-xs font-semibold" dir="ltr">
                  {file.name}
                </span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => clear(kind)} className="h-8 w-8 shrink-0 rounded-lg p-0 text-destructive" aria-label={t("papers_remove", { kind: t(`papers_kind_${kind}`) })}>
                <Trash2 size={14} />
              </Button>
            </div>
          ) : (
            <label key={kind} className="relative flex h-16 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 focus-within:ring-2 focus-within:ring-ring">
              <input
                ref={(el) => {
                  inputs.current[kind] = el
                }}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={(e) => pick(kind, e.target.files?.[0])}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                aria-label={t(`papers_kind_${kind}`)}
              />
              <Upload size={15} aria-hidden="true" />
              {t(`papers_kind_${kind}`)}
            </label>
          )
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">{t("papers_hint")}</p>
    </fieldset>
  )
}
