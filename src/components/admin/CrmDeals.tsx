"use client"

// A client's (or lead's) opportunities and quotes in the platform's own CRM —
// what he may buy, and what we offered him. One admin-only collection with a
// `kind`; nothing is deleted — a deal that went nowhere is marked lost/rejected.

import { useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useLocale, useTranslations } from "next-intl"
import { addDoc, collection, doc, query, serverTimestamp, updateDoc, where } from "firebase/firestore"
import { FileText, Loader2, Plus, Target } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { CLIENT_PLANS, DEAL_KINDS, DEAL_STATES, dealSchema, toDateKey, type DealDoc, type DealInput, type DealKind } from "@/lib/admin-crm"
import { withSarSign } from "@/lib/riyal"

export const ADMIN_CRM_DEALS = "adminCrmDeals"

const TONE: Record<string, PillTone> = { open: "info", won: "ok", lost: "mute", draft: "mute", sent: "info", accepted: "ok", rejected: "bad" }

/** `kinds` limits what is shown (the platform CRM keeps quotes only — the opportunity is part of the lead, ADM-07);
 * `alsoIds` are other records whose deals show here too (a client that came from a lead). */
export function CrmDeals({ clientId, author, kinds = DEAL_KINDS, alsoIds = [] }: { clientId: string; author: { uid: string; name: string }; kinds?: readonly DealKind[]; alsoIds?: string[] }) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [adding, setAdding] = useState<DealKind | null>(null)
  const ids = [clientId, ...alsoIds].filter(Boolean)
  const idsKey = ids.join("|")
  const q = useMemoFirebase(() => (firestore ? query(collection(firestore, ADMIN_CRM_DEALS), where("clientId", "in", idsKey.split("|"))) : null), [firestore, idsKey])
  const { data } = useCollection<Omit<DealDoc, "id">>(q)
  const deals = useMemo(() => ((data ?? []) as DealDoc[]).slice().sort((a, b) => b.date.localeCompare(a.date)), [data])
  const money = (n: number) => withSarSign(n.toLocaleString("en-US", { maximumFractionDigits: 2 }), locale)

  const setState = async (d: DealDoc, state: string) => {
    if (!firestore) return
    try {
      await updateDoc(doc(firestore, ADMIN_CRM_DEALS, d.id), { state, updatedAt: serverTimestamp() })
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }

  const section = (kind: DealKind) => {
    const list = deals.filter((d) => d.kind === kind)
    const Icon = kind === "opportunity" ? Target : FileText
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <Icon size={15} className="text-primary" aria-hidden="true" />
            {t(`deal_${kind}s`)}
            <span className="text-xs font-normal text-muted-foreground" dir="ltr">
              {list.length}
            </span>
          </p>
          <Button size="sm" variant="outline" className="h-8 gap-1" onClick={() => setAdding(kind)}>
            <Plus size={14} aria-hidden="true" />
            {t(`deal_add_${kind}`)}
          </Button>
        </div>
        {adding === kind && <DealForm kind={kind} clientId={clientId} author={author} onDone={() => setAdding(null)} />}
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(`deal_none_${kind}`)}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {list.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 basis-48">
                  <span className="block font-semibold" dir="auto">
                    {d.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    <bdi dir="ltr">{d.date}</bdi>
                    {d.plan ? ` · ${t(`plan_${d.plan}`)}` : ""} · {d.authorName}
                    {d.note ? ` · ${d.note}` : ""}
                  </span>
                </span>
                <bdi dir="ltr" className="font-bold tabular-nums">
                  {money(d.amount)}
                </bdi>
                <StatusPill tone={TONE[d.state] ?? "mute"}>{t(`deal_state_${d.state}`)}</StatusPill>
                <NativeSelect aria-label={t("deal_state_label", { title: d.title })} value={d.state} onChange={(e) => void setState(d, e.target.value)} className="h-8 w-32 text-xs">
                  {DEAL_STATES[d.kind].map((s) => (
                    <option key={s} value={s}>
                      {t(`deal_state_${s}`)}
                    </option>
                  ))}
                </NativeSelect>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {kinds.map((k) => (
        <div key={k}>{section(k)}</div>
      ))}
    </div>
  )
}

function DealForm({ kind, clientId, author, onDone }: { kind: DealKind; clientId: string; author: { uid: string; name: string }; onDone: () => void }) {
  const t = useTranslations("Portal.Admin.Crm")
  const firestore = useFirestore()
  const { toast } = useToast()
  const form = useForm<DealInput>({
    resolver: zodResolver(dealSchema),
    defaultValues: { kind, title: "", plan: null, amount: 0, date: toDateKey(new Date()), note: "" },
  })
  const submit = async (v: DealInput) => {
    if (!firestore) return
    try {
      await addDoc(collection(firestore, ADMIN_CRM_DEALS), {
        ...v,
        clientId,
        state: DEAL_STATES[kind][0],
        authorUid: author.uid,
        authorName: author.name,
        createdAt: serverTimestamp(),
      })
      toast({ title: t("saved") })
      onDone()
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }
  const id = (f: string) => `deal-${kind}-${f}`
  const err = form.formState.errors
  return (
    <form onSubmit={form.handleSubmit(submit)} className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor={id("title")}>{t("deal_title")}</Label>
        <Input id={id("title")} dir="auto" {...form.register("title")} />
        {err.title && <p className="text-xs text-destructive">{t("deal_title_required")}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("plan")}>{t("plan_label")}</Label>
        <NativeSelect id={id("plan")} value={form.watch("plan") ?? ""} onChange={(e) => form.setValue("plan", (e.target.value || null) as DealInput["plan"])}>
          <option value="">{t("plan_none")}</option>
          {CLIENT_PLANS.map((p) => (
            <option key={p} value={p}>
              {t(`plan_${p}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("amount")}>{t("deal_amount")}</Label>
        <Input id={id("amount")} type="number" inputMode="decimal" min={0} step="0.01" dir="ltr" {...form.register("amount", { valueAsNumber: true })} />
        {err.amount && <p className="text-xs text-destructive">{t("deal_amount_invalid")}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("date")}>{t(kind === "quote" ? "deal_date_quote" : "deal_date_opportunity")}</Label>
        <Input id={id("date")} type="date" dir="ltr" {...form.register("date")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id("note")}>{t("note_label")}</Label>
        <Textarea id={id("note")} rows={1} {...form.register("note")} />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting} className="gap-1.5">
          {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {t("deal_save")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onDone} disabled={form.formState.isSubmitting}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  )
}
