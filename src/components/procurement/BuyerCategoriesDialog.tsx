"use client"

// A buyer's purchasing categories (P-21, P-40): `users/{uid}.procurementCategories`,
// the top-level categories of the material tree (their Arabic names — what RFQs and orders carry as `category`);
// names saved before the tree stay listed, ticked, until the manager clears them. The needs
// desk, Today and the orders list scope a buyer by them; none set = every
// category. Set by the owner or a purchasing manager (`po.approve`) — the
// rules allow exactly this one field on a member's document, never by himself.

import { useEffect, useMemo } from "react"
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
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { displayCategory } from "@/lib/constants"
import { label as treeLabel } from "@/lib/materials/tree"

export const MAX_BUYER_CATEGORIES = 30

const schema = z.object({ categories: z.array(z.string().min(1)).max(MAX_BUYER_CATEGORIES) })
type Values = z.infer<typeof schema>

export const cleanBuyerCategories = (raw: unknown): string[] => (Array.isArray(raw) ? Array.from(new Set(raw.filter((c): c is string => typeof c === "string" && c.trim().length > 0).map((c) => c.trim()))) : [])

export function BuyerCategoriesDialog({ member, open, onOpenChange }: { member: { id: string; name: string; procurementCategories?: unknown } | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { categories: [] } })
  const picked = useWatch({ control: form.control, name: "categories" })
  const { index } = useMaterialTree()
  const roots = useMemo(() => (index?.roots || []).map((r) => ({ value: r.ar, label: treeLabel(r, locale) })), [index, locale])
  const options = useMemo(() => [...roots, ...picked.filter((c) => !roots.some((r) => r.value === c)).map((c) => ({ value: c, label: displayCategory(c, locale) }))], [roots, picked, locale])

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
            {options.map((o, i) => {
              const id = `buyer-cat-${i}`
              return (
                <label key={o.value} htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/40">
                  <Checkbox id={id} checked={picked.includes(o.value)} onCheckedChange={(on) => toggle(o.value, on === true)} />
                  <span dir="auto">{o.label}</span>
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
