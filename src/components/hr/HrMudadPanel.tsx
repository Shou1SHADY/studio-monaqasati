"use client"

// «فحص الالتزام قبل مُدد» (PY-08, optional: mudad — the prototype's x6PayPanels): on a main payroll, what
// Mudad will flag before the file is sent — paid after the pay day, a held transfer, the basic against the
// Qiwa contract, deductions above half the wage, a net of zero, a net below 90% with no absence. A warning,
// never a block: each is justified once («برّر», payroll or the HR manager) and the reason travels with the
// file. On a paid month, «حالة الشهر في مُدد» — recorded after the upload; we read nothing from Mudad (GV-05).

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { DrawerSection } from "@/components/module-ui/DrawerSection"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useFirestore, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { HrAccess } from "@/hooks/useHrAccess"
import { usePermissions } from "@/hooks/usePermissions"
import { useTableLabels } from "@/hooks/useTableLabels"
import type { EmployeePay } from "@/lib/hr/employee"
import { hrDate, hrMoney } from "@/lib/hr/format"
import type { Payroll } from "@/lib/hr/payroll"
import { justifyMudadFinding, recordMudadStatus } from "@/lib/hr/platform-writes"
import { documentedBasic, MUDAD_REASONS, mudadFindings, unjustified, type GovDoc, type MudadFinding, type MudadJustification, type MudadStatus } from "@/lib/hr/platforms"
import { HrWriteError } from "@/lib/hr/write-guard"
import { cn } from "@/lib/utils"

type MudadPayroll = Payroll & { just?: Record<string, MudadJustification> | null; mudad?: MudadStatus | null }

export function HrMudadPanel({ access, payroll, pays, govDocs }: { access: HrAccess; payroll: MudadPayroll; pays: Map<string, EmployeePay>; govDocs: GovDoc[] }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const labels = useTableLabels()
  const [justify, setJustify] = useState<MudadFinding | null>(null)
  const [status, setStatus] = useState(false)
  const may = access.allowed("payroll.prepare")
  const findings = useMemo(
    () => mudadFindings(payroll, { payDay: access.settings.policies.payDay, documentedBasic: (id) => documentedBasic(id, pays.get(id), govDocs) }),
    [payroll, access.settings.policies.payDay, pays, govDocs]
  )
  const just = payroll.just ?? {}
  const open = unjustified(findings, just).length

  const text = (f: MudadFinding) => {
    const p = f.params
    if (f.kind === "late") return t("mudad.f.late", { date: hrDate(String(p.date), locale), due: hrDate(String(p.due), locale) })
    if (f.kind === "held") return t(`mudad.f.held_${p.reason === "no_iban" ? "no_iban" : "held"}`)
    if (f.kind === "basic") return t("mudad.f.basic", { ours: hrMoney(Number(p.ours)), theirs: hrMoney(Number(p.theirs)) })
    if (f.kind === "half") return t("mudad.f.half", { amount: hrMoney(Number(p.amount)) })
    if (f.kind === "low") return t("mudad.f.low", { net: hrMoney(Number(p.net)) })
    return t("mudad.f.zero")
  }

  const columns: DataColumn<MudadFinding>[] = [
    { key: "who", header: t("mudad.col.who"), cell: (f) => <span dir="auto" className="font-semibold">{f.employeeId ? f.name : t("mudad.whole_month")}</span>, sortValue: (f) => f.name },
    { key: "what", header: t("mudad.col.what"), cell: (f) => <span className="text-sm">{text(f)}</span> },
    {
      key: "just",
      header: t("mudad.col.just"),
      cell: (f) =>
        just[f.key] ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusPill tone="ok">{t("mudad.justified")}</StatusPill>
            <span className="text-xs text-muted-foreground" dir="auto">
              {reasonText(t, just[f.key].why)}
            </span>
          </span>
        ) : may ? (
          <Button size="sm" variant="outline" onClick={() => setJustify(f)}>
            {t("mudad.justify")}
          </Button>
        ) : (
          <StatusPill tone="warn">{t("mudad.unjustified_one")}</StatusPill>
        ),
    },
  ]

  return (
    <>
      <DrawerSection
        defaultOpen={open > 0 && payroll.state === "prepared"}
        count={findings.length}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <ShieldCheck size={15} className="text-module" aria-hidden="true" />
            {t("mudad.title")}
            {findings.length > 0 && <StatusPill tone={open ? "warn" : "ok"}>{open ? t("mudad.open", { n: open }) : t("mudad.all_justified")}</StatusPill>}
          </span>
        }
      >
        <div className="space-y-3 py-2">
          <p className="text-xs text-muted-foreground">{t("mudad.note")}</p>
          <DataTable
            caption={t("mudad.title")}
            labels={labels}
            dense
            bordered={false}
            columns={columns}
            rows={findings}
            rowKey={(f) => f.key}
            rowTone={(f) => (just[f.key] ? undefined : "warn")}
            empty={<p className="py-3 text-sm text-muted-foreground">{t("mudad.none")}</p>}
          />
          {payroll.state === "paid" && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <span className="min-w-0">
                <span className="block text-sm font-bold">{t("mudad.status_title")}</span>
                <span className="block text-xs text-muted-foreground">
                  {payroll.mudad
                    ? [t("mudad.status_done", { date: hrDate(payroll.mudad.at, locale) }), payroll.mudad.pct != null ? `${payroll.mudad.pct}%` : null, payroll.mudad.note].filter(Boolean).join(" · ")
                    : t("mudad.status_none")}
                </span>
              </span>
              {!payroll.mudad && may && (
                <Button size="sm" variant="outline" onClick={() => setStatus(true)}>
                  {t("mudad.status_record")}
                </Button>
              )}
            </div>
          )}
        </div>
      </DrawerSection>
      <JustifyDialog access={access} payroll={payroll} finding={justify} text={justify ? text(justify) : ""} onClose={() => setJustify(null)} />
      <MudadStatusDialog access={access} payroll={payroll} open={status} onClose={() => setStatus(false)} />
    </>
  )
}

/** A preset reason is stored by its key and shown in the reader's language; a typed one as written. */
function reasonText(t: ReturnType<typeof useTranslations>, why: string) {
  return (MUDAD_REASONS as readonly string[]).includes(why) ? t(`mudad.reason.${why}` as "mudad.reason.written_consent") : why
}

function useActor() {
  const { user } = useUser()
  const { profile } = usePermissions()
  return { uid: user?.uid ?? "", name: (profile?.name as string) || user?.displayName || null }
}

/** «مبرّر لمُدد» — one of the three reasons, or the preparer's own words; written once. */
function JustifyDialog({ access, payroll, finding, text, onClose }: { access: HrAccess; payroll: MudadPayroll; finding: MudadFinding | null; text: string; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const actor = useActor()
  const schema = z.object({ why: z.string().trim().min(1, t("mudad.why_required")).max(300) })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { why: "" } })
  useEffect(() => {
    if (finding) form.reset({ why: "" })
  }, [finding?.key])
  const why = form.watch("why")
  const submit = form.handleSubmit(async (v) => {
    if (!firestore || !access.orgId || !finding) return
    try {
      await justifyMudadFinding(firestore, access.ctx, access.orgId, actor, payroll.key, finding.key, v.why)
      toast({ title: t("mudad.saved") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? `err.${err.code}` : "err.save"), variant: "destructive" })
    }
  })
  return (
    <Dialog open={finding !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("mudad.justify_title")}</DialogTitle>
          <DialogDescription>{t("mudad.justify_sub")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="space-y-3">
            <p className="rounded-xl border bg-muted/40 p-3 text-sm" dir="auto">
              <span className="font-semibold">{finding?.employeeId ? finding.name : t("mudad.whole_month")}</span> — {text}
            </p>
            <div className="grid gap-2" role="group" aria-label={t("mudad.presets")}>
              {MUDAD_REASONS.map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant="outline"
                  aria-pressed={why === r}
                  className={cn("h-auto min-h-11 justify-start whitespace-normal text-start", why === r && "border-module bg-module/10")}
                  onClick={() => form.setValue("why", r, { shouldValidate: true })}
                >
                  {t(`mudad.reason.${r}`)}
                </Button>
              ))}
            </div>
            <FormField
              control={form.control}
              name="why"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("mudad.why_own")}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} dir="auto" {...field} value={(MUDAD_REASONS as readonly string[]).includes(field.value) ? "" : field.value} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting || !why.trim()}>
                {form.formState.isSubmitting && <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" />}
                {t("save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/** «حالة <الشهر> في مُدد» — the compliance % and Mudad's notes, both optional, recorded after the upload. */
function MudadStatusDialog({ access, payroll, open, onClose }: { access: HrAccess; payroll: MudadPayroll; open: boolean; onClose: () => void }) {
  const t = useTranslations("Portal.HR")
  const firestore = useFirestore()
  const { toast } = useToast()
  const actor = useActor()
  const schema = z.object({
    pct: z
      .string()
      .trim()
      .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100), t("mudad.pct_range")),
    note: z.string().trim().max(300),
  })
  type Values = z.infer<typeof schema>
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { pct: "", note: "" } })
  useEffect(() => {
    if (open) form.reset({ pct: "", note: "" })
  }, [open])
  const submit = form.handleSubmit(async (v) => {
    if (!firestore || !access.orgId) return
    try {
      await recordMudadStatus(firestore, access.ctx, access.orgId, actor, payroll.key, { pct: v.pct === "" ? null : Number(v.pct), note: v.note || null })
      toast({ title: t("mudad.status_saved") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof HrWriteError ? `err.${err.code}` : "err.save"), variant: "destructive" })
    }
  })
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("mudad.status_dialog", { month: payroll.month })}</DialogTitle>
          <DialogDescription>{t("mudad.status_sub")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="pct"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("mudad.pct")}</FormLabel>
                  <FormControl>
                    <Input type="number" min="0" max="100" step="any" dir="ltr" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("mudad.notes")}</FormLabel>
                  <FormControl>
                    <Input dir="auto" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className="text-xs text-muted-foreground sm:col-span-2">{t("mudad.optional")}</p>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" />}
                {t("mudad.status_record")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
