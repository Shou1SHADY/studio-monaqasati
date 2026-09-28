"use client"

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { CheckCircle2, FileCheck, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { SAUDI_VAT_RE } from "@/lib/procurement/rfq-form"
import { GuestPapersField, type GuestPaperFiles } from "./GuestPapersField"

export interface GuestPaperSummary {
  kind: "cr" | "vat"
  name: string
  at: string
}

// On the guest's own offer page: the papers and the VAT number he may add
// after submitting — no order can be issued to him without them.
export function GuestPapersPanel({ token, vatNumber, papers, onSaved }: { token: string; vatNumber: string | null; papers: GuestPaperSummary[]; onSaved: () => void }) {
  const t = useTranslations("PublicRfq.extras")
  const locale = useLocale()
  const { toast } = useToast()
  const [files, setFiles] = useState<GuestPaperFiles>({})
  const schema = z.object({ vatNumber: z.string().trim().regex(SAUDI_VAT_RE, t("vat_invalid")).optional().or(z.literal("")) })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { vatNumber: "" } })

  const submit = form.handleSubmit(async (v) => {
    if (!v.vatNumber && !files.cr && !files.vat) {
      toast({ title: t("papers_nothing"), variant: "destructive" })
      return
    }
    const body = new FormData()
    if (v.vatNumber) body.set("vatNumber", v.vatNumber)
    if (files.cr) body.set("paper_cr", files.cr)
    if (files.vat) body.set("paper_vat", files.vat)
    const res = await fetch(`/api/guest-offer/${token}/papers`, { method: "POST", body })
    const json = await res.json().catch(() => null)
    if (!res.ok || json?.error) {
      const c = json?.code as string | undefined
      toast({ title: c === "PAPER_TOO_LARGE" ? t("papers_too_large") : c === "INVALID_PAPER" ? t("papers_bad_type") : c === "INVALID_VAT" ? t("vat_invalid") : t("papers_failed"), variant: "destructive" })
      return
    }
    setFiles({})
    form.reset({ vatNumber: "" })
    toast({ title: t("papers_saved") })
    onSaved()
  })

  return (
    <section className="space-y-3 rounded-2xl border bg-card p-4" aria-labelledby="guest-papers-title">
      <div>
        <h2 id="guest-papers-title" className="flex items-center gap-2 text-sm font-bold">
          <FileCheck size={15} className="text-primary" aria-hidden="true" />
          {t("papers_panel_title")}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t("papers_panel_desc")}</p>
      </div>
      {(vatNumber || papers.length > 0) && (
        <ul className="space-y-1 text-xs">
          {vatNumber && (
            <li className="flex items-center gap-1.5 text-success">
              <CheckCircle2 size={12} aria-hidden="true" />
              {t("vat_on_file")} <bdi dir="ltr">{vatNumber}</bdi>
            </li>
          )}
          {papers.map((p) => (
            <li key={p.kind} className="flex items-center gap-1.5 text-success">
              <CheckCircle2 size={12} aria-hidden="true" />
              {t(`papers_kind_${p.kind}`)} · <bdi dir="ltr">{p.name}</bdi>
              <span className="text-muted-foreground" suppressHydrationWarning>
                · {new Date(p.at).toLocaleDateString(locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="space-y-3" noValidate>
        {!vatNumber && (
          <div className="space-y-1.5">
            <Label htmlFor="guest-papers-vat" className="text-sm font-semibold">
              {t("vat_label")}
            </Label>
            <Input id="guest-papers-vat" inputMode="numeric" dir="ltr" placeholder="3XXXXXXXXXXXXX3" className="h-10 rounded-xl text-left" {...form.register("vatNumber")} />
            {form.formState.errors.vatNumber ? <p className="text-xs text-destructive">{form.formState.errors.vatNumber.message}</p> : <p className="text-xs text-muted-foreground">{t("vat_hint")}</p>}
          </div>
        )}
        <GuestPapersField value={files} onChange={setFiles} onRefused={(m) => toast({ title: m, variant: "destructive" })} />
        <Button type="submit" disabled={form.formState.isSubmitting} className="gap-2 rounded-xl">
          {form.formState.isSubmitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
          {t("papers_submit")}
        </Button>
      </form>
    </section>
  )
}
