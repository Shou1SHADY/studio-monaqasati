"use client"

import { useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { HandCoins, Plus, Pencil, Search, Loader2, FileText, Factory, Banknote, CheckCircle2, Lock } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { useCrmData } from "@/hooks/useCrmData"
import { cn } from "@/lib/utils"
import {
  QUOTATION_PHASES,
  QUOTATION_PHASE_BADGE_CLASS,
  QUOTATION_STATUS_BADGE_CLASS,
  formatCrmDate,
  formatSar,
  formatSarCompact,
  quotationPhase,
  type CrmQuotation,
  type QuotationPhase,
} from "@/lib/crm"
import { WORK_ORDERS, effectiveOutput, type WorkOrder } from "@/lib/manufacturing"
import {
  SALES_TABS,
  isAwaitingPayment,
  markQuotationPaid,
  paymentRecipients,
  quotationMatchesSearch,
  quotationMatchesTab,
  quotationPrefillFromWorkOrder,
  salesTotals,
  type SalesTab,
} from "@/lib/sales"
import { CrmQuotationDialog, type QuotationDefaults } from "@/components/crm/CrmQuotationDialog"

const TAB_PARAM_VALUES = new Set<string>(SALES_TABS)

type Draft = { contactId: string; contactName: string | null; defaults: QuotationDefaults }

/**
 * Sales (المبيعات) — every quotation the org has written, before manufacturing
 * (estimates) and after it (a finished item's price), plus the customer
 * payments recorded against them. Its own module, not a Finance page; the
 * records are the CRM's quotations, so the contact page and this list agree.
 */
export function SalesView() {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const { can, groups } = usePermissions()
  const canManage = can("sales.manage")
  const canMarkPaid = canManage || can("invoices.manage")

  const { orgId, contacts, quotations, teamMembers, isLoading } = useCrmData({ quotations: true })

  const ordersQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, WORK_ORDERS), where("organizationId", "==", orgId))
  }, [firestore, orgId])
  const { data: ordersData } = useCollection(ordersQuery)
  const finishedOrders = useMemo(
    () =>
      ((ordersData || []) as WorkOrder[])
        .filter((o) => o.status === "done")
        .sort((a, b) => (b.orderNumber || 0) - (a.orderNumber || 0)),
    [ordersData]
  )

  const actorName = teamMembers.find((m) => m.id === user?.uid)?.name || user?.email || ""

  // ── Tabs & search ──
  const [tab, setTab] = useState<SalesTab>("all")
  const [search, setSearch] = useState("")
  useEffect(() => {
    // The sidebar deep-links `/contractor/sales?tab=awaiting`.
    try {
      const wanted = new URLSearchParams(window.location.search).get("tab")
      if (wanted && TAB_PARAM_VALUES.has(wanted)) setTab(wanted as SalesTab)
    } catch {
      /* not in a browser */
    }
  }, [])

  const sorted = useMemo(
    () => [...quotations].sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    [quotations]
  )
  const totals = useMemo(() => salesTotals(quotations), [quotations])
  const visible = sorted.filter((q) => quotationMatchesTab(q, tab) && quotationMatchesSearch(q, search))

  // ── New quotation: pick the phase and the customer, then open the shared dialog ──
  const [showNew, setShowNew] = useState(false)
  const [newPhase, setNewPhase] = useState<QuotationPhase>("pre_manufacturing")
  const [newContactId, setNewContactId] = useState("")
  const [newOrderId, setNewOrderId] = useState("")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [editQuote, setEditQuote] = useState<CrmQuotation | null>(null)

  const sortedContacts = useMemo(() => [...contacts].sort((a, b) => a.name.localeCompare(b.name)), [contacts])

  const openNew = () => {
    setNewPhase("pre_manufacturing")
    setNewContactId("")
    setNewOrderId("")
    setShowNew(true)
  }
  const pickOrder = (id: string) => {
    setNewOrderId(id)
    const order = finishedOrders.find((o) => o.id === id)
    // An order born from a quotation already knows its customer.
    if (order?.source?.contactId && contacts.some((c) => c.id === order.source.contactId)) {
      setNewContactId(order.source.contactId)
    }
  }
  const startQuotation = () => {
    const contact = contacts.find((c) => c.id === newContactId)
    if (!contact) return
    const order = newPhase === "post_manufacturing" ? finishedOrders.find((o) => o.id === newOrderId) : undefined
    const prefill = order ? quotationPrefillFromWorkOrder(order) : null
    setDraft({
      contactId: contact.id,
      contactName: contact.name,
      defaults: {
        phase: newPhase,
        items: prefill?.items,
        workOrderId: prefill?.workOrderId ?? null,
        workOrderNumber: prefill?.workOrderNumber ?? null,
      },
    })
    setShowNew(false)
  }

  // ── Record a customer payment ──
  const [payQuote, setPayQuote] = useState<CrmQuotation | null>(null)
  const [payAmount, setPayAmount] = useState("")
  const [payNote, setPayNote] = useState("")
  const [isPaying, setIsPaying] = useState(false)

  const openPay = (q: CrmQuotation) => {
    setPayQuote(q)
    setPayAmount(q.amount != null ? String(q.amount) : "")
    setPayNote("")
  }
  const confirmPaid = async () => {
    if (!firestore || !user || !payQuote || isPaying) return
    const amount = parseFloat(payAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: t("crm_quote_amount_error"), variant: "destructive" })
      return
    }
    setIsPaying(true)
    try {
      const recipients = paymentRecipients({ ownerId: orgId, actorId: user.uid, members: teamMembers, groups })
      await markQuotationPaid(firestore, {
        quotation: payQuote,
        amount,
        note: payNote.trim() || null,
        actor: { id: user.uid, name: actorName },
        recipients,
        notification: {
          title: t("sales_notif_paid_title"),
          message: t("sales_notif_paid_msg", {
            contact: payQuote.contactName || "—",
            number: payQuote.quotationNumber,
            amount: formatSar(amount, locale),
          }),
        },
      })
      toast({ title: t("sales_paid_toast", { count: recipients.length }) })
      setPayQuote(null)
    } catch (err) {
      console.error(err)
      toast({ title: t("crm_save_error"), variant: "destructive" })
    } finally {
      setIsPaying(false)
    }
  }

  const stats: Array<{ key: string; label: string; value: number; tone: string }> = [
    { key: "quoted", label: t("sales_stat_quoted"), value: totals.quoted, tone: "text-cta" },
    { key: "accepted", label: t("sales_stat_accepted"), value: totals.accepted, tone: "text-primary" },
    { key: "awaiting", label: t("sales_stat_awaiting"), value: totals.awaitingPayment, tone: "text-warning" },
    { key: "paid", label: t("sales_stat_paid"), value: totals.paid, tone: "text-success" },
  ]

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <header className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-primary flex items-center gap-2">
            <HandCoins size={22} className="shrink-0" aria-hidden="true" />
            {t("sales_page_title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t("sales_page_desc")}</p>
          {!isLoading && !canManage && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
              <Lock size={12} aria-hidden="true" />
              {t("sales_no_permission")}
            </p>
          )}
        </div>
        <Button className="gap-2 shrink-0" onClick={openNew} disabled={!canManage || isLoading}>
          <Plus size={16} />
          {t("sales_new_quote_btn")}
        </Button>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.key} className="p-4 rounded-xl border bg-white">
            <p className="text-xs text-muted-foreground font-semibold">{s.label}</p>
            <p className={cn("text-xl font-black mt-1 tabular-nums", s.tone)} dir="ltr">
              {formatSarCompact(s.value, locale)}
            </p>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {SALES_TABS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={tab === s}
              onClick={() => setTab(s)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === s ? "bg-primary text-white border-primary" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
              )}
            >
              {t(`sales_tab_${s}`)}
              <span className={cn("text-[10px] tabular-nums", tab === s ? "text-white/70" : "text-muted-foreground")}>
                {totals.counts[s]}
              </span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute top-1/2 -translate-y-1/2 start-3 text-muted-foreground pointer-events-none" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("sales_search_placeholder")}
            aria-label={t("sales_search_placeholder")}
            className="h-9 ps-9"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : visible.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
          <FileText size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">{t("sales_empty")}</p>
        </div>
      ) : (
        <ul className="rounded-2xl border bg-white divide-y overflow-hidden">
          {visible.map((q) => {
            const phase = quotationPhase(q)
            return (
              <li key={q.id} className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">{q.quotationNumber}</span>
                    <Badge className={cn("text-[10px]", QUOTATION_PHASE_BADGE_CLASS[phase])}>{t(`crm_quote_phase_${phase}`)}</Badge>
                    <Badge className={cn("text-[10px]", QUOTATION_STATUS_BADGE_CLASS[q.status])}>{t(`crm_quote_status_${q.status}`)}</Badge>
                    {q.paidAt && (
                      <Badge className="text-[10px] bg-success/10 text-success border-success/20 gap-1">
                        <CheckCircle2 size={10} aria-hidden="true" />
                        {t("crm_quote_paid_badge")}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-bold text-foreground mt-1 flex items-center gap-2 flex-wrap">
                    {q.contactId ? (
                      <Link
                        href={`/contractor/crm/leads/${q.contactId}`}
                        className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                        dir="auto"
                      >
                        {q.contactName || t("sales_col_customer")}
                      </Link>
                    ) : (
                      <span dir="auto">{q.contactName || "—"}</span>
                    )}
                    {q.workOrderNumber != null && (
                      <Link
                        href="/contractor/manufacturing"
                        className="text-xs font-semibold text-cta flex items-center gap-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      >
                        <Factory size={11} aria-hidden="true" />
                        {t("crm_quote_work_order_ref", { number: q.workOrderNumber })}
                      </Link>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {q.date && formatCrmDate(q.date, locale)}
                    {q.paidAt && (
                      <>
                        {q.date && " · "}
                        {t("sales_paid_on", { date: formatCrmDate(q.paidAt, locale) })}
                        {q.paidByUserName && ` ${t("sales_paid_by", { name: q.paidByUserName })}`}
                        {q.paidAmount != null && q.paidAmount !== q.amount && (
                          <span dir="ltr" className="ms-1">({formatSar(q.paidAmount, locale)})</span>
                        )}
                      </>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                  <span className="text-sm font-black tabular-nums" dir="ltr">{formatSar(q.amount, locale)}</span>
                  {canMarkPaid && isAwaitingPayment(q) && (
                    <Button size="sm" className="h-8 gap-1.5" onClick={() => openPay(q)}>
                      <Banknote size={13} />
                      {t("sales_mark_paid_btn")}
                    </Button>
                  )}
                  {canManage && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                      aria-label={`${t("crm_quote_edit_title")} — ${q.quotationNumber}`}
                      onClick={() => setEditQuote(q)}
                    >
                      <Pencil size={13} />
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Step 1 of a new quotation: phase + customer (+ finished order for post-manufacturing). */}
      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sales_new_dialog_title")}</DialogTitle>
            <DialogDescription>{t("sales_new_dialog_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("crm_quote_phase")}</Label>
              <div role="group" aria-label={t("crm_quote_phase")} className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/30 p-1">
                {QUOTATION_PHASES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={newPhase === p}
                    onClick={() => setNewPhase(p)}
                    className={cn(
                      "h-9 rounded-md text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      newPhase === p ? "bg-primary text-white shadow-sm" : "text-slate-600 hover:bg-white"
                    )}
                  >
                    {t(`crm_quote_phase_${p}`)}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t(newPhase === "post_manufacturing" ? "crm_quote_phase_hint_post" : "crm_quote_phase_hint_pre")}
              </p>
            </div>

            {newPhase === "post_manufacturing" && (
              <div className="space-y-1.5">
                <Label>{t("sales_pick_work_order")}</Label>
                <Select value={newOrderId || "__none__"} onValueChange={(v) => pickOrder(v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("sales_pick_work_order_placeholder")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("sales_pick_work_order_none")}</SelectItem>
                    {finishedOrders.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        #{o.orderNumber} {o.title} — {effectiveOutput(o).name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>{t("sales_pick_contact")}</Label>
              {sortedContacts.length === 0 ? (
                <p className="text-xs text-muted-foreground border border-dashed rounded-lg p-3">{t("sales_no_contacts")}</p>
              ) : (
                <Select value={newContactId || undefined} onValueChange={setNewContactId}>
                  <SelectTrigger><SelectValue placeholder={t("sales_pick_contact_placeholder")} /></SelectTrigger>
                  <SelectContent>
                    {sortedContacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNew(false)}>{t("crm_cancel")}</Button>
            <Button onClick={startQuotation} disabled={!newContactId} className="gap-2">
              <FileText size={15} />
              {t("sales_continue")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step 2: the shared CRM quotation dialog, seeded with the phase (and the finished item). */}
      {draft && (
        <CrmQuotationDialog
          open
          onOpenChange={(open) => { if (!open) setDraft(null) }}
          orgId={orgId}
          contactId={draft.contactId}
          contactName={draft.contactName}
          defaults={draft.defaults}
        />
      )}
      {editQuote && (
        <CrmQuotationDialog
          open
          onOpenChange={(open) => { if (!open) setEditQuote(null) }}
          orgId={orgId}
          contactId={editQuote.contactId}
          contactName={editQuote.contactName}
          quotation={editQuote}
        />
      )}

      {/* Record a customer payment — finance is notified in the same write. */}
      <Dialog open={!!payQuote} onOpenChange={(open) => { if (!open && !isPaying) setPayQuote(null) }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Banknote size={18} className="text-success" aria-hidden="true" />
              {t("sales_mark_paid_title")}
            </DialogTitle>
            <DialogDescription>
              {payQuote && t("sales_mark_paid_desc", { number: payQuote.quotationNumber, contact: payQuote.contactName || "—" })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="sales-paid-amount">{t("sales_paid_amount")}</Label>
              <Input
                id="sales-paid-amount"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                dir="ltr"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                disabled={isPaying}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sales-paid-note">{t("sales_payment_note")}</Label>
              <Textarea id="sales-paid-note" value={payNote} onChange={(e) => setPayNote(e.target.value)} disabled={isPaying} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayQuote(null)} disabled={isPaying}>{t("crm_cancel")}</Button>
            <Button onClick={confirmPaid} disabled={isPaying} className="gap-2 bg-success hover:bg-success/90 text-white">
              {isPaying ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {t("sales_confirm_paid")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
