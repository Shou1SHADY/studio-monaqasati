"use client"

import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CrmFormDialog, RequiredMark, type CrmFormStep } from "@/components/crm/CrmFormDialog"
import {
  QuotationItemsEditor,
  QuotationPhaseControl,
  QuotationScheduleEditor,
  QuotationStatusField,
} from "@/components/crm/QuotationFormFields"
import { FileText } from "lucide-react"
import { DATE_INPUT_CLASS } from "@/components/crm/CrmOpportunityDialog"
import type { CrmQuotation } from "@/lib/crm"
import type { WorkOrder } from "@/lib/manufacturing"
import { useQuotationForm, type QuotationDefaults } from "@/hooks/useQuotationForm"

export type { QuotationDefaults }

export function CrmQuotationDialog({
  open,
  onOpenChange,
  orgId,
  contactId,
  contactName,
  quotation,
  defaults,
  contacts,
  finishedOrders,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  /** The contact the quotation is for. Leave empty and pass `contacts` to let
   * the user choose one (Sales mode) — the dialog then opens with a customer step. */
  contactId?: string
  contactName?: string | null
  quotation?: CrmQuotation
  defaults?: QuotationDefaults
  /** Sales mode: the org's contacts to pick a customer from. */
  contacts?: Array<{ id: string; name: string }>
  /** Sales mode: finished work orders a post-manufacturing quotation can price. */
  finishedOrders?: WorkOrder[]
  /** Called with the saved quotation's id — Sales opens its detail page. */
  onSaved?: (quotationId: string) => void
}) {
  const t = useTranslations("Portal.Shared")
  // All state and the save path live in the shared hook — the Sales
  // quotation builder page uses the very same one.
  const form = useQuotationForm({ open, orgId, contactId, quotation, contactName, defaults, contacts, finishedOrders })
  const {
    salesMode, isSaving, amount, setAmount, date, setDate, notes, setNotes,
    selectedContactId, setSelectedContactId, linkedOrderId, pickFinishedOrder,
    phase, hasItems, itemsTotal,
  } = form

  const handleSave = async () => {
    const quotationId = await form.save()
    if (!quotationId) return
    onOpenChange(false)
    onSaved?.(quotationId)
  }

  const phaseControl = <QuotationPhaseControl form={form} />

  const customerStep: CrmFormStep = {
    id: "customer",
    title: t("crm_quote_step_customer"),
    validate: () => (selectedContactId ? null : t("sales_pick_contact_required")),
    content: (
      <>
        <div className="space-y-1.5">
          <Label htmlFor="quote-customer">{t("sales_pick_contact")} <RequiredMark /></Label>
          {contacts && contacts.length > 0 ? (
            <Select value={selectedContactId || undefined} onValueChange={setSelectedContactId} disabled={isSaving}>
              <SelectTrigger id="quote-customer"><SelectValue placeholder={t("sales_pick_contact_placeholder")} /></SelectTrigger>
              <SelectContent>
                {[...contacts].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground border border-dashed rounded-lg p-3">{t("sales_no_contacts")}</p>
          )}
        </div>
        {phaseControl}
        {phase === "post_manufacturing" && finishedOrders && (
          <div className="space-y-1.5">
            <Label htmlFor="quote-order">{t("sales_pick_work_order")}</Label>
            <Select value={linkedOrderId || "__none__"} onValueChange={(v) => pickFinishedOrder(v === "__none__" ? "" : v)} disabled={isSaving}>
              <SelectTrigger id="quote-order"><SelectValue placeholder={t("sales_pick_work_order_placeholder")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("sales_pick_work_order_none")}</SelectItem>
                {finishedOrders.map((o) => (
                  <SelectItem key={o.id} value={o.id}>#{o.orderNumber} {o.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </>
    ),
  }

  const detailsStep: CrmFormStep = {
    id: "quotation",
    title: salesMode ? t("crm_quote_step_details") : t("crm_quote_add_title"),
    validate: () => null,
    content: (
      <>
        {!salesMode && phaseControl}
        <QuotationItemsEditor form={form} />
        <QuotationScheduleEditor form={form} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="quote-amount">{t("crm_quote_amount")} <RequiredMark /></Label>
            <Input
              id="quote-amount" type="number" min="0" step="any" inputMode="decimal"
              value={hasItems ? String(itemsTotal) : amount}
              onChange={(e) => setAmount(e.target.value)}
              dir="ltr"
              disabled={isSaving || hasItems}
            />
          </div>
          <QuotationStatusField form={form} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quote-date">{t("crm_quote_date")}</Label>
          <input id="quote-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} dir="ltr" disabled={isSaving} className={DATE_INPUT_CLASS} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="quote-notes">{t("crm_notes")}</Label>
          <Textarea id="quote-notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={isSaving} />
        </div>
      </>
    ),
  }

  const steps: CrmFormStep[] = salesMode ? [customerStep, detailsStep] : [detailsStep]

  return (
    <CrmFormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={FileText}
      title={quotation ? t("crm_quote_edit_title") : t("crm_quote_add_title")}
      description={t("crm_quote_dialog_desc")}
      steps={steps}
      isSaving={isSaving}
      submitLabel={t("crm_save")}
      onSubmit={() => void handleSave()}
      size="md"
    />
  )
}
