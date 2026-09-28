"use client"

// «مدّد الموعد أو أضف موردين» (R-40): a later deadline and more invitees for a
// live RFQ whose prices nobody has seen. The page passes the suppliers it
// could still invite; the write re-checks the RFQ is open.

import { useEffect } from "react"
import { useTranslations } from "next-intl"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { extendRfq } from "@/lib/procurement/rfq-extend-writes"
import { ProcWriteError } from "@/lib/procurement/writes"
import type { RfqWriteActor } from "@/lib/procurement/rfq-access"
import { cn } from "@/lib/utils"

export interface ExtendTarget {
  id: string
  title: string
  passed: boolean
  invited: string[]
}

export function RfqExtendDialog({ target, actor, options, onOpenChange }: { target: ExtendTarget | null; actor: RfqWriteActor; options: Array<{ orgId: string; name: string }>; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("Portal.Procurement")
  const firestore = useFirestore()
  const { toast } = useToast()
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const schema = z.object({
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t("rfqpo.extend.date_required")).refine((d) => d >= tomorrow, t("rfqpo.extend.date_after_today")),
    add: z.array(z.string()),
  })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { deadline: "", add: [] } })
  useEffect(() => {
    if (target) form.reset({ deadline: "", add: [] })
  }, [target, form])
  const add = useWatch({ control: form.control, name: "add" })
  const pool = target ? options.filter((o) => !target.invited.includes(o.orgId)) : []

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t(target?.passed ? "rfqpo.extend.title_republish" : "rfqpo.extend.title")}</DialogTitle>
          <DialogDescription dir="auto">{target?.title}</DialogDescription>
        </DialogHeader>
        {target && (
          <Form {...form}>
            <form
              className="space-y-4"
              onSubmit={form.handleSubmit(async (v) => {
                if (!firestore) return
                try {
                  const added = await extendRfq(firestore, actor, target.id, { deadline: v.deadline, addSupplierOrgIds: v.add })
                  toast({ title: t("rfqpo.extend.done", { count: added }) })
                  onOpenChange(false)
                } catch (err) {
                  if (err instanceof ProcWriteError) toast({ title: t(`err_${err.code}`), variant: "destructive" })
                  else {
                    console.error(err)
                    toast({ title: t("rfqpo.failed"), variant: "destructive" })
                  }
                }
              })}
            >
              <FormField
                control={form.control}
                name="deadline"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("rfqpo.extend.deadline")}</FormLabel>
                    <FormControl>
                      <Input type="date" min={tomorrow} dir="ltr" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-2">
                <p className="text-sm font-semibold">{t("rfqpo.extend.add")}</p>
                {pool.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("rfqpo.extend.none_left")}</p>
                ) : (
                  <div className="max-h-48 divide-y overflow-y-auto rounded-lg border">
                    {pool.map((o) => {
                      const on = add.includes(o.orgId)
                      return (
                        <label key={o.orgId} className={cn("flex cursor-pointer items-center gap-3 px-3 py-2 text-sm", on ? "bg-module/5" : "hover:bg-muted/50")}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => form.setValue("add", on ? add.filter((x) => x !== o.orgId) : [...add, o.orgId])}
                            className="h-4 w-4 rounded border-input focus-visible:ring-2 focus-visible:ring-ring"
                          />
                          <span className="truncate" dir="auto">
                            {o.name}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
              <ul className="space-y-1 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                <li>• {t("rfqpo.extend.effect_date")}</li>
                <li>• {t("rfqpo.extend.effect_invite")}</li>
              </ul>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {t("rfqpo.cancel")}
                </Button>
                <Button type="submit" disabled={form.formState.isSubmitting} className="gap-2">
                  {form.formState.isSubmitting && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                  {t("rfqpo.extend.submit")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
