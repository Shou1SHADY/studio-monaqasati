"use client"

// A buyer's purchasing categories (P-21, P-40): `users/{uid}.procurementCategories`,
// the category ids RFQs and orders carry (`PREDEFINED_CATEGORIES`). The needs
// desk, Today and the orders list scope a buyer by them; none set = every
// category. Set by the owner or a purchasing manager (`po.approve`) — the
// rules allow exactly this one field on a member's document, never by himself.

import { useEffect } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { doc, serverTimestamp, updateDoc } from "firebase/firestore"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { CATEGORIES_EN, PREDEFINED_CATEGORIES } from "@/lib/constants"

export const MAX_BUYER_CATEGORIES = 30

const schema = z.object({ categories: z.array(z.enum(PREDEFINED_CATEGORIES as [string, ...string[]])).max(MAX_BUYER_CATEGORIES) })
type Values = z.infer<typeof schema>

/** Only known category ids survive — a renamed category must not keep scoping a buyer. */
export const cleanBuyerCategories = (raw: unknown): string[] => (Array.isArray(raw) ? Array.from(new Set(raw.filter((c): c is string => typeof c === "string" && PREDEFINED_CATEGORIES.includes(c)))) : [])

export function BuyerCategoriesDialog({ member, open, onOpenChange }: { member: { id: string; name: string; procurementCategories?: unknown } | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { categories: [] } })
  const picked = useWatch({ control: form.control, name: "categories" })

  useEffect(() => {
    if (open && member) form.reset({ categories: cleanBuyerCategories(member.procurementCategories) })
  }, [open, member, form])

  const toggle = (c: string, on: boolean) => {
    const next = on ? [...picked, c] : picked.filter((x) => x !== c)
    form.setValue("categories", next, { shouldValidate: true, shouldDirty: true })
  }

  const submit = form.handleSubmit(async (v) => {
    if (!firestore || !member) return
    try {
      await updateDoc(doc(firestore, "users", member.id), { procurementCategories: v.categories, updatedAt: serverTimestamp() })
      toast({ title: t("team_buyer_categories_saved") })
      onOpenChange(false)
    } catch {
      toast({ title: t("team_error"), description: t("team_unknown_error"), variant: "destructive" })
    }
  })

  const label = (c: string) => (locale === "ar" ? c : CATEGORIES_EN[c] || c)

  return (
    <Dialog open={open} onOpenChange={(o) => !form.formState.isSubmitting && onOpenChange(o)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader className="text-start">
          <DialogTitle>{t("team_buyer_categories_title", { name: member?.name || "" })}</DialogTitle>
          <DialogDescription>{t("team_buyer_categories_desc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">{t("team_buyer_categories_label")}</legend>
            {PREDEFINED_CATEGORIES.map((c) => {
              const id = `buyer-cat-${PREDEFINED_CATEGORIES.indexOf(c)}`
              return (
                <label key={c} htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40">
                  <Checkbox id={id} checked={picked.includes(c)} onCheckedChange={(on) => toggle(c, on === true)} />
                  <span dir="auto">{label(c)}</span>
                </label>
              )
            })}
          </fieldset>
          <p className="text-xs text-muted-foreground">{picked.length ? t("team_buyer_categories_count", { count: picked.length }) : t("team_buyer_categories_none")}</p>
          {form.formState.errors.categories && <p className="text-xs text-destructive">{t("team_buyer_categories_too_many", { max: MAX_BUYER_CATEGORIES })}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
              {t("team_cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
              {form.formState.isSubmitting && <Loader2 size={14} className="me-1 animate-spin" aria-hidden="true" />}
              {t("team_buyer_categories_save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
