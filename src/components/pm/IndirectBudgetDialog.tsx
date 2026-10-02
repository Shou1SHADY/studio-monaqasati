"use client"

// The project manager's indirect-cost budgets, one per kind, for the whole project.

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { INDIRECT_KINDS, type IndirectBudgets, type IndirectKind } from "@/lib/pm/indirect"
import { setIndirectBudgets } from "@/lib/pm/indirect-writes"

const field = z.string().refine((v) => v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) >= 0))
const schema = z.object({ stf: field, eq: field, ovh: field, ins: field })
type Values = z.infer<typeof schema>

const toValues = (b: IndirectBudgets): Values => ({ stf: b.stf ? String(b.stf) : "", eq: b.eq ? String(b.eq) : "", ovh: b.ovh ? String(b.ovh) : "", ins: b.ins ? String(b.ins) : "" })

export function IndirectBudgetDialog({ open, onOpenChange, projectId, access, budgets }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; access: PmAccess; budgets: IndirectBudgets }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(budgets) })
  useEffect(() => {
    if (open) form.reset(toValues(budgets))
    // Reset on opening only: a live update must not wipe what is being typed.
  }, [open])

  const save = form.handleSubmit(async (v) => {
    if (!firestore) return
    const next: IndirectBudgets = {}
    for (const k of INDIRECT_KINDS) if (v[k].trim() !== "") next[k] = Number(v[k])
    try {
      await setIndirectBudgets(firestore, access.ctx, projectId, next)
      toast({ title: t("money.cost.indirect_saved") })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : "error.save"), variant: "destructive" })
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("money.cost.indirect_edit_title")}</DialogTitle>
          <DialogDescription>{t("money.cost.indirect_edit_desc")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-3">
          {INDIRECT_KINDS.map((k: IndirectKind) => (
            <div key={k} className="flex flex-col gap-1.5">
              <Label htmlFor={`ind-${k}`}>{t(`money.cost.indirect_kind.${k}`)}</Label>
              <Input id={`ind-${k}`} type="number" min="0" step="1" dir="ltr" inputMode="decimal" {...form.register(k)} aria-invalid={Boolean(form.formState.errors[k])} />
              {form.formState.errors[k] && <p className="text-xs text-destructive">{t("money.cost.indirect_bad")}</p>}
            </div>
          ))}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting} className="gap-1.5">
              {form.formState.isSubmitting && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
              {t("money.cost.indirect_save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
