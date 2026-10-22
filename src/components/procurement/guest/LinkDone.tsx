"use client"

import { useLocale, useTranslations } from "next-intl"
import { Check, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { fmtDay, fmtMoney } from "./link-format"

// The short page after a send (LNK-10): the total (with VAT, or without when he is not registered) and how long it holds, that
// the buyer sees it now and may award before the close, and the one way back — «عدّل عرضك». What is asked of him and the
// registration card follow in the page.
export function LinkDone({ company, total, nonVat, validUntil, close, version, onEdit, preview = false }: { company: string; total: number; nonVat: boolean; validUntil: string; close: string | null; version: number; onEdit: () => void; preview?: boolean }) {
  const t = useTranslations("PublicRfq")
  const locale = useLocale()
  const name = company || t("trust_generic")
  const amount = `${fmtMoney(total, locale)} ${t("sar")}`
  const date = fmtDay(validUntil, locale)
  return (
    <section className="space-y-2 rounded-md border bg-card p-5 text-center" aria-labelledby="link-done-title">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-success/10 text-success" aria-hidden="true">
        <Check size={22} />
      </span>
      <h1 id="link-done-title" className="text-lg font-black text-foreground">
        {t("done_title", { company: name })}
      </h1>
      <p className="text-sm font-semibold text-foreground">{nonVat ? t("done_nonvat", { amount, date }) : t("done_incl", { amount, date })}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{t("done_caption", { company: name, close: fmtDay(close, locale) })}</p>
      {version > 1 && <p className="text-[11px] text-muted-foreground">{t("done_version", { n: version })}</p>}
      <div className="pt-1">
        <Button type="button" variant="outline" size="sm" onClick={onEdit} disabled={preview} className="min-h-11 gap-1.5">
          <Pencil size={14} aria-hidden="true" />
          {t("done_edit")}
        </Button>
      </div>
    </section>
  )
}
