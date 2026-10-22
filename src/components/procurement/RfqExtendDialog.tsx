"use client"

// «مدّد الموعد أو أضف موردين» (R-40): a later deadline and more invitees for a
// live RFQ whose prices nobody has seen. The pool is our suppliers (favourites
// first) and the platform's suppliers of the RFQ's categories (prototype
// `extend` pool, 2154); a supplier who may not be invited (unverified, no VAT
// number, CR expired) is listed greyed with the reason. The write re-checks
// that the RFQ is open.

import { profileVatMark } from "@/lib/procurement/supplier-file"
import { useEffect, useMemo } from "react"
import { useTranslations } from "next-intl"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useToast } from "@/hooks/use-toast"
import { useSupplierDirectory } from "@/hooks/useSupplierDirectory"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { categoryTree, treeSupplier } from "@/lib/materials/category-tree"
import { lifecycleCall, RfqRouteError } from "@/lib/procurement/rfq-lifecycle-client"
import { extendPool, sourcingBlockOf } from "@/lib/procurement/rfq-extras"
import { cn } from "@/lib/utils"

export interface ExtendTarget {
  id: string
  title: string
  passed: boolean
  invited: string[]
  /** The RFQ's categories — the platform's suppliers of these join the pool. */
  categories?: string[]
  /** The tree sub-categories the RFQ was written with; the pool is matched on them when it has any. */
  subCategoryIds?: string[]
}

type Option = { orgId: string; name: string; isFavorite?: boolean }

export function RfqExtendDialog({
  target,
  options,
  orgId,
  onOpenChange,
}: {
  target: ExtendTarget | null
  options: Option[]
  /** Our org — for our records of the platform's suppliers. */
  orgId?: string | null
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations("Portal.Procurement")
  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle>{t(target?.passed ? "rfqpo.extend.title_republish" : "rfqpo.extend.title")}</DialogTitle>
          <DialogDescription dir="auto">{target?.title}</DialogDescription>
        </DialogHeader>
        {target && <ExtendBody target={target} options={options} orgId={orgId || ""} onOpenChange={onOpenChange} />}
      </DialogContent>
    </Dialog>
  )
}

const NO_OFFERS: never[] = []

function ExtendBody({ target, options, orgId, onOpenChange }: { target: ExtendTarget; options: Option[]; orgId: string; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("Portal.Procurement")
  const tr = useTranslations("Portal.Procurement.rfqextras")
  const { toast } = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const schema = z.object({
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t("rfqpo.extend.date_required")).refine((d) => d >= today, t("rfqpo.extend.date_after_today")),
    add: z.array(z.string()),
  })
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { deadline: "", add: [] } })
  useEffect(() => {
    form.reset({ deadline: "", add: [] })
  }, [target, form])
  const add = useWatch({ control: form.control, name: "add" })

  const favourites = useMemo(() => options.filter((o) => o.isFavorite).map((o) => o.orgId), [options])
  const { suppliers } = useSupplierDirectory(orgId, favourites, NO_OFFERS)
  const { index: treeIndex } = useMaterialTree()
  const directory = useMemo(() => new Map(suppliers.flatMap((s) => [s.orgId, ...s.memberIds].map((id) => [id, s] as const))), [suppliers])
  const pool = useMemo(
    () => extendPool(options.map((o) => ({ orgId: o.orgId, name: o.name, isFavorite: Boolean(o.isFavorite) })), suppliers.map((s) => treeSupplier(s, treeIndex)), target.categories || [], target.invited, categoryTree(treeIndex), target.subCategoryIds),
    [options, suppliers, target, treeIndex]
  )
  const blockOf = (id: string) => {
    const s = directory.get(id)
    return s ? sourcingBlockOf(s.record, { vat: profileVatMark(s), crExpiry: s.profileCrExpiry }, today) : sourcingBlockOf(null, undefined, today)
  }

  return (
    <Form {...form}>
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit(async (v) => {
          try {
            const res = await lifecycleCall({ action: target.passed ? "reopen" : "extend", rfqId: target.id, deadline: v.deadline, ...(target.passed ? {} : { addSupplierOrgIds: v.add.filter((id) => !blockOf(id)) }) } as never)
            toast({ title: t("rfqpo.extend.done", { count: res.count ?? 0 }) })
            onOpenChange(false)
          } catch (err) {
            if (err instanceof RfqRouteError) toast({ title: t.has(`err_${err.reason}`) ? t(`err_${err.reason}`) : t("rfqpo.failed"), variant: "destructive" })
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
                <Input type="date" min={today} dir="ltr" {...field} />
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
            <div className="max-h-56 divide-y overflow-y-auto rounded-lg border">
              {pool.map((o) => {
                const on = add.includes(o.orgId)
                const block = blockOf(o.orgId)
                return (
                  <label key={o.orgId} className={cn("flex items-center gap-3 px-3 py-2 text-sm", block ? "cursor-not-allowed opacity-60" : "cursor-pointer", on ? "bg-module/5" : !block && "hover:bg-muted/50")}>
                    <input
                      type="checkbox"
                      checked={on && !block}
                      disabled={Boolean(block)}
                      onChange={() => form.setValue("add", on ? add.filter((x) => x !== o.orgId) : [...add, o.orgId])}
                      className="h-4 w-4 rounded border-input focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate" dir="auto">
                        {o.name}
                        {o.favourite && <span className="ms-1 text-warning">★</span>}
                      </span>
                      {block && <span className="block text-[11px] text-destructive">{tr(`sourcing.${block}`)}</span>}
                    </span>
                    {o.platform && (
                      <StatusPill tone="mute" className="shrink-0 text-[10px]">
                        {tr("extend.platform")}
                      </StatusPill>
                    )}
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
  )
}
