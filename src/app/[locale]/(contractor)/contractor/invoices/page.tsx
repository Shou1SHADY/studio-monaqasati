"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { cn } from "@/lib/utils"
import {
  Receipt,
  Plus,
  Trash2,
  Loader2,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  Send,
  Pencil,
  X,
} from "lucide-react"
import {
  type InvoiceStatus,
  type InvoiceItem,
  calculateInvoiceTotal,
  calculateVat,
  formatCurrency,
  generateInvoiceNumber,
  getInvoiceStatusVariant,
  resolveInvoiceStatus,
} from "@/utils/invoice-utils"

type Invoice = {
  id: string
  invoiceNumber: string
  status: InvoiceStatus
  clientName: string
  issueDate: string
  dueDate: string
  items: InvoiceItem[]
  vatPercent: number
  rfqId?: string
  notes?: string
  organizationId: string
}

const STATUS_ICONS: Record<InvoiceStatus, React.ElementType> = {
  draft: FileText,
  sent: Send,
  paid: CheckCircle2,
  overdue: AlertCircle,
}

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: "text-slate-500",
  sent: "text-primary",
  paid: "text-success",
  overdue: "text-destructive",
}

function InvoiceItemRow({
  item,
  index,
  onUpdate,
  onRemove,
  locale,
  t,
}: {
  item: InvoiceItem
  index: number
  onUpdate: (index: number, field: keyof InvoiceItem, value: string | number) => void
  onRemove: (index: number) => void
  locale: string
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
}) {
  return (
    <div className="grid grid-cols-12 gap-2 items-center">
      <div className="col-span-5">
        <Input
          value={item.description}
          onChange={(e) => onUpdate(index, "description", e.target.value)}
          placeholder={t("inv_item_desc_placeholder")}
          className="h-8 text-sm"
        />
      </div>
      <div className="col-span-2">
        <Input
          type="number"
          min="1"
          value={item.quantity}
          onChange={(e) => onUpdate(index, "quantity", parseFloat(e.target.value) || 1)}
          className="h-8 text-sm text-center"
          dir="ltr"
        />
      </div>
      <div className="col-span-3">
        <Input
          type="number"
          min="0"
          step="0.01"
          value={item.unitPrice}
          onChange={(e) => onUpdate(index, "unitPrice", parseFloat(e.target.value) || 0)}
          className="h-8 text-sm"
          dir="ltr"
        />
      </div>
      <div className="col-span-1 text-sm font-mono text-right" dir="ltr">
        {(item.quantity * item.unitPrice).toFixed(0)}
      </div>
      <div className="col-span-1 flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => onRemove(index)}
          aria-label={t("inv_remove_item")}
        >
          <X size={13} />
        </Button>
      </div>
    </div>
  )
}

function InvoiceDialog({
  open,
  onOpenChange,
  invoice,
  orgId,
  t,
  locale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice?: Invoice
  orgId: string
  t: ReturnType<typeof useTranslations<"Portal.Contractor">>
  locale: string
}) {
  const firestore = useFirestore()
  const { toast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const today = new Date().toISOString().split("T")[0]
  const thirtyDaysLater = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]

  const [clientName, setClientName] = useState(invoice?.clientName ?? "")
  const [issueDate, setIssueDate] = useState(invoice?.issueDate ?? today)
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? thirtyDaysLater)
  const [rfqId, setRfqId] = useState(invoice?.rfqId ?? "")
  const [notes, setNotes] = useState(invoice?.notes ?? "")
  const [vatPercent, setVatPercent] = useState(invoice?.vatPercent ?? 15)
  const [items, setItems] = useState<InvoiceItem[]>(
    invoice?.items ?? [{ description: "", quantity: 1, unitPrice: 0 }]
  )

  const updateItem = (index: number, field: keyof InvoiceItem, value: string | number) => {
    setItems((prev) => prev.map((it, i) => i === index ? { ...it, [field]: value } : it))
  }

  const addItem = () => setItems((prev) => [...prev, { description: "", quantity: 1, unitPrice: 0 }])
  const removeItem = (index: number) => setItems((prev) => prev.filter((_, i) => i !== index))

  const subtotal = calculateInvoiceTotal(items)
  const vat = calculateVat(subtotal, vatPercent)
  const grandTotal = subtotal + vat

  const handleSave = async () => {
    if (!firestore) return
    if (!clientName.trim()) {
      toast({ title: t("inv_validation_error"), variant: "destructive" })
      return
    }
    if (items.every((it) => !it.description.trim())) {
      toast({ title: t("inv_items_required"), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const data = {
        clientName: clientName.trim(),
        issueDate,
        dueDate,
        rfqId: rfqId.trim() || null,
        notes: notes.trim() || null,
        vatPercent,
        items: items.filter((it) => it.description.trim()),
        organizationId: orgId,
        updatedAt: serverTimestamp(),
      }
      if (invoice) {
        await updateDoc(doc(firestore, "invoices", invoice.id), data)
        toast({ title: t("inv_updated") })
      } else {
        await addDoc(collection(firestore, "invoices"), {
          ...data,
          invoiceNumber: generateInvoiceNumber(),
          status: "draft" as InvoiceStatus,
          createdAt: serverTimestamp(),
        })
        toast({ title: t("inv_created") })
      }
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("inv_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isSaving) onOpenChange(next) }}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{invoice ? t("inv_edit_title") : t("inv_create_title")}</DialogTitle>
          <DialogDescription>{t("inv_dialog_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="inv-client">{t("inv_client")} *</Label>
              <Input id="inv-client" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder={t("inv_client_placeholder")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-rfq">{t("inv_rfq_link")}</Label>
              <Input id="inv-rfq" value={rfqId} onChange={(e) => setRfqId(e.target.value)} placeholder={t("inv_rfq_placeholder")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-issue">{t("inv_issue_date")} *</Label>
              <input id="inv-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} dir="ltr"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-due">{t("inv_due_date")} *</Label>
              <input id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} dir="ltr"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
            </div>
          </div>

          {/* Items */}
          <div className="space-y-2">
            <p className="text-sm font-bold">{t("inv_items_label")}</p>
            <div className="grid grid-cols-12 gap-2 text-xs font-bold text-muted-foreground mb-1">
              <div className="col-span-5">{t("inv_item_desc")}</div>
              <div className="col-span-2 text-center">{t("inv_item_qty")}</div>
              <div className="col-span-3">{t("inv_item_price")}</div>
              <div className="col-span-1 text-right">{t("inv_item_total")}</div>
              <div className="col-span-1" />
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <InvoiceItemRow
                  key={idx}
                  item={item}
                  index={idx}
                  onUpdate={updateItem}
                  onRemove={removeItem}
                  locale={locale}
                  t={t}
                />
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addItem} className="gap-1.5 mt-1 h-8 text-xs">
              <Plus size={12} />
              {t("inv_add_item")}
            </Button>
          </div>

          {/* Totals */}
          <div className="border-t pt-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("inv_subtotal")}</span>
              <span dir="ltr" className="font-mono">{formatCurrency(subtotal, locale)}</span>
            </div>
            <div className="flex justify-between items-center gap-4">
              <span className="text-muted-foreground">{t("inv_vat")} ({vatPercent}%)</span>
              <div className="flex items-center gap-2">
                <Select value={vatPercent.toString()} onValueChange={(v) => setVatPercent(Number(v))}>
                  <SelectTrigger className="h-7 w-20 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0%</SelectItem>
                    <SelectItem value="5">5%</SelectItem>
                    <SelectItem value="15">15%</SelectItem>
                  </SelectContent>
                </Select>
                <span dir="ltr" className="font-mono w-28 text-right">{formatCurrency(vat, locale)}</span>
              </div>
            </div>
            <div className="flex justify-between font-bold border-t pt-1.5">
              <span>{t("inv_total")}</span>
              <span dir="ltr" className="font-mono">{formatCurrency(grandTotal, locale)}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inv-notes">{t("inv_notes")}</Label>
            <Input id="inv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("inv_notes_placeholder")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>{t("inv_cancel")}</Button>
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            {isSaving ? <Loader2 size={15} className="animate-spin" /> : null}
            {invoice ? t("inv_update_btn") : t("inv_create_btn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const STATUS_TABS: Array<InvoiceStatus | "all"> = ["all", "draft", "sent", "paid", "overdue"]

export default function ContractorInvoicesPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const { can } = usePermissions()
  const canManageInvoices = can("invoices.manage")

  const [showCreate, setShowCreate] = useState(false)
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null)
  const [activeTab, setActiveTab] = useState<InvoiceStatus | "all">("all")
  const [isDeleting, setIsDeleting] = useState<string | null>(null)

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const myOrgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""

  const invoicesQuery = useMemoFirebase(() => {
    if (!firestore || !myOrgId) return null
    return query(collection(firestore, "invoices"), where("organizationId", "==", myOrgId))
  }, [firestore, myOrgId])
  const { data: invoices, isLoading } = useCollection(invoicesQuery)
  const list = (invoices || []) as Invoice[]

  const withResolvedStatus = list.map((inv) => ({
    ...inv,
    status: resolveInvoiceStatus(inv.dueDate, inv.status),
  }))

  const filtered = activeTab === "all" ? withResolvedStatus : withResolvedStatus.filter((inv) => inv.status === activeTab)

  const handleStatusChange = async (invoice: Invoice, newStatus: InvoiceStatus) => {
    if (!firestore) return
    try {
      await updateDoc(doc(firestore, "invoices", invoice.id), { status: newStatus, updatedAt: serverTimestamp() })
      toast({ title: t("inv_status_updated") })
    } catch (err) {
      console.error(err)
      toast({ title: t("inv_save_error"), variant: "destructive" })
    }
  }

  const handleDelete = async (invoiceId: string) => {
    if (!firestore) return
    setIsDeleting(invoiceId)
    try {
      await deleteDoc(doc(firestore, "invoices", invoiceId))
      toast({ title: t("inv_deleted") })
    } catch (err) {
      console.error(err)
      toast({ title: t("inv_save_error"), variant: "destructive" })
    } finally {
      setIsDeleting(null)
    }
  }

  const counts = STATUS_TABS.slice(1).reduce((acc, s) => {
    acc[s as InvoiceStatus] = withResolvedStatus.filter((inv) => inv.status === s).length
    return acc
  }, {} as Record<InvoiceStatus, number>)

  return (
    <PortalLayout>
      <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-primary flex items-center gap-2">
              <Receipt size={22} />
              {t("inv_page_title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">{t("inv_page_desc")}</p>
          </div>
          {canManageInvoices && (
            <Button onClick={() => setShowCreate(true)} className="gap-2 shrink-0">
              <Plus size={16} />
              {t("inv_create_btn")}
            </Button>
          )}
        </div>

        {/* Status tabs */}
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors",
                activeTab === tab
                  ? "bg-primary text-white"
                  : "bg-muted/30 text-muted-foreground hover:bg-muted/60"
              )}
            >
              {t(`inv_tab_${tab}`)}
              {tab !== "all" && counts[tab as InvoiceStatus] > 0 && (
                <span className="ms-1.5 bg-white/20 rounded-full px-1.5 text-xs">{counts[tab as InvoiceStatus]}</span>
              )}
            </button>
          ))}
        </div>

        {/* Invoice list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={32} className="animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Receipt size={48} className="text-muted-foreground/20" />
            <p className="font-bold text-muted-foreground">{t("inv_empty_title")}</p>
            <p className="text-sm text-muted-foreground/70">{t("inv_empty_desc")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((inv) => {
              const StatusIcon = STATUS_ICONS[inv.status]
              const subtotal = calculateInvoiceTotal(inv.items || [])
              const vat = calculateVat(subtotal, inv.vatPercent ?? 15)
              return (
                <Card key={inv.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="font-black text-primary font-mono text-sm">{inv.invoiceNumber}</p>
                          <Badge variant={getInvoiceStatusVariant(inv.status)} className="text-xs">
                            <StatusIcon size={11} className="me-1" />
                            {t(`inv_status_${inv.status}`)}
                          </Badge>
                          {inv.rfqId && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">
                              <FileText size={10} className="me-1" />
                              {t("inv_linked_rfq")}
                            </Badge>
                          )}
                        </div>
                        <p className="font-semibold text-base">{inv.clientName}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {t("inv_issue_date")}: <span dir="ltr">{inv.issueDate}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <AlertCircle size={11} />
                            {t("inv_due_date")}: <span dir="ltr">{inv.dueDate}</span>
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted-foreground">{t("inv_total")}</p>
                        <p className="text-lg font-black text-primary" dir="ltr">{formatCurrency(subtotal + vat, locale)}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-muted/40">
                      {canManageInvoices && inv.status === "draft" && (
                        <Button size="sm" variant="outline" className="gap-1 h-7 text-xs"
                          onClick={() => handleStatusChange(inv, "sent")}>
                          <Send size={12} />
                          {t("inv_mark_sent")}
                        </Button>
                      )}
                      {canManageInvoices && inv.status === "sent" && (
                        <Button size="sm" className="gap-1 h-7 text-xs bg-success hover:bg-success/90 text-white"
                          onClick={() => handleStatusChange(inv, "paid")}>
                          <CheckCircle2 size={12} />
                          {t("inv_mark_paid")}
                        </Button>
                      )}
                      {canManageInvoices && inv.status === "overdue" && (
                        <Button size="sm" className="gap-1 h-7 text-xs bg-success hover:bg-success/90 text-white"
                          onClick={() => handleStatusChange(inv, "paid")}>
                          <CheckCircle2 size={12} />
                          {t("inv_mark_paid")}
                        </Button>
                      )}
                      {canManageInvoices && (
                        <Button size="sm" variant="ghost" className="gap-1 h-7 text-xs text-muted-foreground"
                          onClick={() => setEditInvoice(inv)}>
                          <Pencil size={12} />
                          {t("inv_edit_title")}
                        </Button>
                      )}
                      {canManageInvoices && inv.status === "draft" && (
                        <Button size="sm" variant="ghost"
                          className="gap-1 h-7 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(inv.id)}
                          disabled={isDeleting === inv.id}>
                          {isDeleting === inv.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          {t("inv_delete_btn")}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      <InvoiceDialog open={showCreate} onOpenChange={setShowCreate} orgId={myOrgId} t={t} locale={locale} />
      {editInvoice && (
        <InvoiceDialog
          open={!!editInvoice}
          onOpenChange={(open) => { if (!open) setEditInvoice(null) }}
          invoice={editInvoice}
          orgId={myOrgId}
          t={t}
          locale={locale}
        />
      )}
    </PortalLayout>
  )
}
