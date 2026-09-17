"use client"

// Cost from Manufacturing (REQ-02, REQ-08) — Sales' side of a non-standard
// line. Sales asks the workshop for cost and lead time
// (sales.cost_request.created); the cost controller sends back a statement
// with cost, earliest readiness and validity — never a price. Sales prices it
// in its own quotation and records here what became of the quote: issued,
// won or lost. A won quote's manufacturing request is sent from the sales
// order's coverage link, like any other line. Drafts stay the workshop's until
// they are sent; an expired statement goes back to Manufacturing to recalculate.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, doc, query, where } from "firebase/firestore"
import { Calculator, CheckCircle2, Clock, Factory, Info, Loader2, Plus, Send, Trash2, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useCollection, useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePermissions } from "@/hooks/usePermissions"
import { cn } from "@/lib/utils"
import { formatCrmDate, formatSar, type CrmContact } from "@/lib/crm"
import {
  MFG_COST_ESTIMATES,
  MFG_PRODUCTS,
  MFG_SETTINGS,
  addDaysISO,
  estimateCost,
  estimateExpired,
  normalizeMfgSettings,
  type MfgCostEstimate,
  type MfgProduct,
  type MfgSettings,
} from "@/lib/manufacturing-engine"
import { createCostingRequest, recordQuoteStatus } from "@/lib/manufacturing-writes"
import { emitMfgEvent, mfgLinks } from "@/lib/mfg-events"
import { MANUFACTURING_REQUESTS, type ManufacturingRequest, type MfgRequestLine } from "@/lib/sales-orders"
import { fmtQty } from "@/components/manufacturing/ui/MfgUi"
import { SignedInAs, mfgActError } from "@/components/shared/MfgHandoffBits"
import type { CrmPortal } from "@/components/crm/CrmShell"

const OTHER_CLIENT = "__other"

type Tab = "open" | "closed"

interface DraftLine {
  key: string
  productId: string
  quantity: string
}

const newLine = (): DraftLine => ({ key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, productId: "", quantity: "" })

export function SalesMfgCostingPanel({ contacts, canManage }: { portal: CrmPortal; contacts: CrmContact[]; canManage: boolean }) {
  const t = useTranslations("Portal.Shared")
  // The statement's figure IS a cost: it shows to the owner and the sales
  // manager, who price from it — a rep sees its lead time, validity and state
  // and never the number (Sales PRD PRC-05, INV-08).
  const { can, isOrgOwner } = usePermissions()
  const seesCost = isOrgOwner || can("sales.approve")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)
  const orgId = (profile as { organizationId?: string } | null)?.organizationId || user?.uid || ""
  const actor = { id: user?.uid || "", name: (profile as { name?: string } | null)?.name || user?.email || "" }

  const productsQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, MFG_PRODUCTS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: productsData } = useCollection(productsQuery)
  const products = useMemo(
    () => ((productsData || []) as MfgProduct[]).filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name, locale)),
    [productsData, locale]
  )

  const estimatesQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, MFG_COST_ESTIMATES), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: estimatesData } = useCollection(estimatesQuery)
  const estimates = useMemo(() => (estimatesData || []) as MfgCostEstimate[], [estimatesData])

  const requestsQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, MANUFACTURING_REQUESTS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: requestsData } = useCollection(requestsQuery)

  const settingsRef = useMemoFirebase(() => (firestore && orgId ? doc(firestore, MFG_SETTINGS, orgId) : null), [firestore, orgId])
  const { data: settingsData } = useDoc(settingsRef)
  const settings = useMemo(() => normalizeMfgSettings(settingsData as Partial<MfgSettings> | null), [settingsData])

  const today = new Date().toISOString().slice(0, 10)

  // Statements Manufacturing has sent — drafts are still the workshop's.
  const statements = useMemo(
    () =>
      estimates
        .filter((e) => e.state === "sent" || e.state === "quoted" || e.state === "won" || e.state === "lost")
        .sort((a, b) => ((a.sentAt || "") < (b.sentAt || "") ? 1 : -1)),
    [estimates]
  )

  // Sales' own costing requests still in the workshop, and the declined ones.
  const costRequests = useMemo(() => {
    const sentFor = new Set(statements.map((e) => e.requestId).filter(Boolean))
    return ((requestsData || []) as ManufacturingRequest[])
      .filter((r) => r.kind === "cost" && r.sourceKind === "sales" && !sentFor.has(r.id))
      .filter((r) => r.status === "new" || r.status === "estimated" || r.status === "rejected")
      .sort((a, b) => ((a.requestedAt || "") < (b.requestedAt || "") ? 1 : -1))
  }, [requestsData, statements])

  const isOpen = (e: MfgCostEstimate) => e.state === "sent" || e.state === "quoted"
  const openStatements = statements.filter(isOpen)
  const closedStatements = statements.filter((e) => !isOpen(e))
  const pendingRequests = costRequests.filter((r) => r.status !== "rejected")
  const declinedRequests = costRequests.filter((r) => r.status === "rejected")

  const [tab, setTab] = useState<Tab>("open")
  const [asking, setAsking] = useState(false)

  if (!orgId || (products.length === 0 && statements.length === 0 && costRequests.length === 0)) return null

  const openCount = openStatements.length + pendingRequests.length
  const closedCount = closedStatements.length + declinedRequests.length

  return (
    <section className="overflow-hidden rounded-xl border bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-black text-foreground">
            <Factory size={15} className="text-primary" aria-hidden="true" />
            {t("mfy_cost_title")}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{t("mfy_cost_desc")}</p>
        </div>
        {canManage && products.length > 0 && (
          <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => setAsking(true)}>
            <Calculator size={14} aria-hidden="true" />
            {t("mfy_cost_ask_btn")}
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5">
        {(["open", "closed"] as Tab[]).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === k ? "border-primary bg-primary text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            )}
          >
            {t(k === "open" ? "mfy_cost_tab_open" : "mfy_cost_tab_closed")}
            <span className={cn("text-[10px] tabular-nums", tab === k ? "text-white/70" : "text-muted-foreground")}>{k === "open" ? openCount : closedCount}</span>
          </button>
        ))}
      </div>

      {(tab === "open" ? openCount : closedCount) === 0 ? (
        <p className="px-5 py-6 text-center text-xs text-muted-foreground">{t(tab === "open" ? "mfy_cost_empty_open" : "mfy_cost_empty_closed")}</p>
      ) : (
        <ul className="divide-y">
          {(tab === "open" ? pendingRequests : declinedRequests).map((r) => (
            <RequestRow key={r.id} request={r} settings={settings} />
          ))}
          {(tab === "open" ? openStatements : closedStatements).map((e) => (
            <StatementRow key={e.id} estimate={e} settings={settings} today={today} canManage={canManage} seesCost={seesCost} actor={actor} />
          ))}
        </ul>
      )}

      {asking && (
        <AskForCostDialog
          open={asking}
          onClose={() => setAsking(false)}
          orgId={orgId}
          actor={actor}
          products={products}
          contacts={contacts}
          answerWindowHours={settings.answerWindowHours}
          onSent={() => {
            setAsking(false)
            setTab("open")
            toast({ title: t("mfy_cost_ask_sent") })
          }}
        />
      )}
    </section>
  )
}

function linesText(lines: Array<{ productName?: string; itemName?: string; quantity: number; unit: string }>): string {
  return lines.map((l) => `${l.productName || l.itemName || ""} × ${fmtQty(l.quantity)} ${l.unit}`).join(" · ")
}

function RequestRow({ request: r, settings }: { request: ManufacturingRequest; settings: MfgSettings }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const lines = r.lines?.length ? r.lines : [{ productId: null, itemName: r.itemName, unit: r.unit, quantity: r.quantity } as MfgRequestLine]
  const hours = r.requestedAt ? (Date.now() - new Date(r.requestedAt).getTime()) / 3600000 : 0
  const overdue = r.status === "new" && hours > settings.answerWindowHours
  const badge =
    r.status === "rejected"
      ? { cls: "bg-muted text-muted-foreground", text: t("mfy_cost_req_declined") }
      : r.status === "estimated"
        ? { cls: "bg-cta/10 text-cta", text: t("mfy_cost_req_costing") }
        : overdue
          ? { cls: "bg-destructive/10 text-destructive", text: t("mfy_cost_req_overdue") }
          : { cls: "bg-warning/10 text-warning", text: t("mfy_cost_req_awaiting") }
  return (
    <li className="space-y-1 px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground" dir="ltr">{r.requestNumber}</span>
        <span className="text-sm font-bold text-foreground" dir="auto">{r.contactName || "—"}</span>
        {r.rfqRef && <span className="text-[11px] text-muted-foreground" dir="auto">{t("mfy_cost_rfq_ref", { ref: r.rfqRef })}</span>}
        <Badge className={cn("border-none text-[10px]", badge.cls)}>{badge.text}</Badge>
      </div>
      <p className="text-xs text-slate-700" dir="auto">{linesText(lines)}</p>
      <p className="text-[11px] text-muted-foreground">
        {t("mfy_cost_req_meta", { name: r.createdByUserName, date: formatCrmDate(r.requestedAt, locale) })}
        {r.neededBy && <> · {t("mfy_cost_needed_by", { date: formatCrmDate(r.neededBy, locale) })}</>}
      </p>
      {r.status === "rejected" && (r.rejectionReason || r.answerNote) && (
        <p className="text-[11px] text-muted-foreground" dir="auto">{t("mfy_cost_req_reason", { reason: r.rejectionReason || r.answerNote || "" })}</p>
      )}
    </li>
  )
}

function StatementRow({
  estimate: e,
  settings,
  today,
  canManage,
  seesCost,
  actor,
}: {
  estimate: MfgCostEstimate
  settings: MfgSettings
  today: string
  canManage: boolean
  seesCost: boolean
  actor: { id: string; name: string }
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [mode, setMode] = useState<null | "quoted" | "won" | "lost">(null)
  const [quoteNumber, setQuoteNumber] = useState("")
  const [soNumber, setSoNumber] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const expired = estimateExpired(e, today, settings)
  const validity = e.validityDays || settings.estimateValidityDays
  const until = e.sentAt ? addDaysISO(e.sentAt, validity) : null

  const status =
    expired
      ? { cls: "bg-destructive/10 text-destructive", text: t("mfy_cost_st_expired") }
      : e.state === "quoted"
        ? { cls: "bg-accent/15 text-secondary", text: t("mfy_cost_st_quoted", { quote: e.quoteNumber || "—" }) }
        : e.state === "won"
          ? { cls: "bg-success/10 text-success", text: e.salesOrderNumber != null ? t("mfy_cost_st_won_so", { number: e.salesOrderNumber }) : t("mfy_cost_st_won") }
          : e.state === "lost"
            ? { cls: "bg-muted text-muted-foreground", text: t("mfy_cost_st_lost") }
            : { cls: "bg-cta/10 text-cta", text: t("mfy_cost_st_sent") }

  const start = (m: "quoted" | "won" | "lost") => {
    setMode(m)
    setError(null)
    setQuoteNumber("")
    setSoNumber("")
  }

  const submit = async () => {
    if (!firestore || !mode || busy) return
    if (mode === "quoted" && !quoteNumber.trim()) {
      setError(t("mfy_err_quote_required"))
      return
    }
    const so = soNumber.trim() ? Number(soNumber.trim().replace(/^#/, "")) : null
    if (mode === "won" && so != null && !(Number.isInteger(so) && so > 0)) {
      setError(t("mfy_cost_won_so_invalid"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await recordQuoteStatus(firestore, {
        estimate: e,
        state: mode,
        quoteNumber: mode === "quoted" ? quoteNumber.trim() : null,
        salesOrderNumber: mode === "won" ? so : null,
        actor,
      })
      // REQ-08: the cost controller who sent the statement learns what became of it.
      await emitMfgEvent(firestore, {
        kind: "quote_status",
        copy: t,
        organizationId: e.organizationId,
        actor,
        to: [{ permission: "manufacturing.cost" }],
        params: { number: e.estimateNumber, status: `@mfn_${mode}`, quote: mode === "quoted" ? quoteNumber.trim() : e.quoteNumber || (so != null ? `SO-${so}` : "—") },
        link: mfgLinks.estimates(),
      })
      toast({ title: t(mode === "quoted" ? "mfy_cost_saved_quoted" : mode === "won" ? "mfy_cost_saved_won" : "mfy_cost_saved_lost") })
      setMode(null)
    } catch (err) {
      console.error(err)
      setError(mfgActError(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="space-y-2.5 px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground" dir="ltr">{e.estimateNumber}</span>
        <span className="text-sm font-bold text-foreground" dir="auto">{e.contactName || "—"}</span>
        <Badge className={cn("border-none text-[10px]", status.cls)}>{status.text}</Badge>
      </div>
      <p className="text-xs text-slate-700" dir="auto">{linesText(e.lines)}</p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-[11px] text-muted-foreground">{t("mfy_cost_make_cost")}</dt>
          <dd className="font-black tabular-nums text-foreground" dir="ltr">{seesCost ? formatSar(estimateCost(e), locale) : <span className="font-normal text-muted-foreground" dir="auto">{t("mfy_cost_hidden")}</span>}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">{t("mfy_cost_earliest")}</dt>
          <dd className="font-semibold text-foreground">{e.earliestDays != null ? t("mfy_days", { count: e.earliestDays }) : "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">{t("mfy_cost_validity")}</dt>
          <dd className={cn("font-semibold", expired ? "text-destructive" : "text-foreground")}>
            {t("mfy_days", { count: validity })}
            {until && <span className="ms-1 text-[11px] font-normal text-muted-foreground">· {t("mfy_cost_until", { date: formatCrmDate(until, locale) })}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">{t("mfy_cost_sent_by")}</dt>
          <dd className="font-semibold text-foreground">
            {e.sentByName || "—"}
            {e.sentAt && <span className="ms-1 text-[11px] font-normal text-muted-foreground">· {formatCrmDate(e.sentAt, locale)}</span>}
          </dd>
        </div>
      </dl>

      {expired && (
        <p className="flex items-start gap-1.5 text-[11px] text-destructive">
          <Clock size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t("mfy_cost_expired_hint")}
        </p>
      )}

      {canManage && !expired && mode === null && (e.state === "sent" || e.state === "quoted") && (
        <div className="flex flex-wrap gap-2">
          {e.state === "sent" && (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => start("quoted")}>
              <Send size={13} aria-hidden="true" />
              {t("mfy_cost_btn_quoted")}
            </Button>
          )}
          {e.state === "quoted" && (
            <>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-success hover:text-success" onClick={() => start("won")}>
                <CheckCircle2 size={13} aria-hidden="true" />
                {t("mfy_cost_btn_won")}
              </Button>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-muted-foreground" onClick={() => start("lost")}>
                <XCircle size={13} aria-hidden="true" />
                {t("mfy_cost_btn_lost")}
              </Button>
            </>
          )}
        </div>
      )}

      {mode && (
        <div className="space-y-3 rounded-lg border bg-muted/20 px-3 py-3">
          {mode === "quoted" && (
            <div className="space-y-1.5">
              <Label htmlFor={`quote-${e.id}`} className="text-xs font-bold">
                {t("mfy_cost_quote_number")}
                <span className="ms-0.5 text-destructive">*</span>
              </Label>
              <Input id={`quote-${e.id}`} dir="ltr" className="h-10 sm:w-60" value={quoteNumber} onChange={(ev) => setQuoteNumber(ev.target.value)} />
              <p className="text-[11px] text-muted-foreground">{t("mfy_cost_quote_hint")}</p>
            </div>
          )}
          {mode === "won" && (
            <div className="space-y-1.5">
              <Label htmlFor={`so-${e.id}`} className="text-xs font-bold">{t("mfy_cost_won_so")}</Label>
              <Input id={`so-${e.id}`} dir="ltr" inputMode="numeric" className="h-10 sm:w-40" value={soNumber} onChange={(ev) => setSoNumber(ev.target.value)} />
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Info size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                {t("mfy_cost_won_hint")}
              </p>
            </div>
          )}
          {mode === "lost" && <p className="text-xs text-slate-700">{t("mfy_cost_lost_confirm")}</p>}
          <SignedInAs name={actor.name} />
          {error && <p className="text-[11px] font-semibold text-destructive" role="alert">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setMode(null)} disabled={busy}>
              {t("crm_cancel")}
            </Button>
            <Button size="sm" onClick={submit} disabled={busy} className="gap-1.5">
              {busy && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
              {t(mode === "quoted" ? "mfy_cost_btn_quoted" : mode === "won" ? "mfy_cost_btn_won" : "mfy_cost_btn_lost")}
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function AskForCostDialog({
  open,
  onClose,
  orgId,
  actor,
  products,
  contacts,
  answerWindowHours,
  onSent,
}: {
  open: boolean
  onClose: () => void
  orgId: string
  actor: { id: string; name: string }
  products: MfgProduct[]
  contacts: CrmContact[]
  answerWindowHours: number
  onSent: () => void
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const clients = useMemo(() => contacts.filter((c) => c.name).sort((a, b) => a.name.localeCompare(b.name, locale)), [contacts, locale])
  const [clientId, setClientId] = useState(clients.length ? "" : OTHER_CLIENT)
  const [clientText, setClientText] = useState("")
  const [rfqRef, setRfqRef] = useState("")
  const [neededBy, setNeededBy] = useState("")
  const [lines, setLines] = useState<DraftLine[]>([newLine()])
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  const submit = async () => {
    if (!firestore || busy) return
    const contactName = clientId === OTHER_CLIENT ? clientText.trim() : clients.find((c) => c.id === clientId)?.name || ""
    if (!contactName) {
      setError(t("mfy_cost_err_client"))
      return
    }
    const chosen: MfgRequestLine[] = []
    for (const l of lines) {
      const p = byId.get(l.productId)
      const q = Number(l.quantity)
      if (!p && !l.quantity.trim()) continue
      if (!p || !(q > 0)) {
        setError(t("mfy_err_lines_required"))
        return
      }
      chosen.push({ productId: p.id, itemName: p.name, unit: p.unit, quantity: q })
    }
    if (!chosen.length) {
      setError(t("mfy_err_lines_required"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const requestId = await createCostingRequest(firestore, {
        organizationId: orgId,
        contactName,
        rfqRef: rfqRef.trim() || null,
        neededBy: neededBy || null,
        lines: chosen,
        note: note.trim() || null,
        actor,
      })
      await emitMfgEvent(firestore, {
        kind: "cost_request_new",
        copy: t,
        organizationId: orgId,
        actor,
        to: [{ permission: "manufacturing.manage" }],
        params: { requestId, client: contactName || "—", lines: linesText(chosen) },
        link: mfgLinks.request(requestId),
      })
      onSent()
    } catch (err) {
      console.error(err)
      setError(mfgActError(t, err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !busy) onClose() }}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator size={18} className="text-primary" aria-hidden="true" />
            {t("mfy_cost_ask_title")}
          </DialogTitle>
          <DialogDescription>{t("mfy_cost_ask_desc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cost-client">
                {t("mfy_cost_client")}
                <span className="ms-0.5 text-destructive">*</span>
              </Label>
              {clients.length > 0 && (
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger id="cost-client" className="h-10">
                    <SelectValue placeholder={t("mfy_cost_client_pick")} />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                    <SelectItem value={OTHER_CLIENT}>{t("mfy_cost_client_other")}</SelectItem>
                  </SelectContent>
                </Select>
              )}
              {clientId === OTHER_CLIENT && (
                <Input
                  id={clients.length ? "cost-client-text" : "cost-client"}
                  aria-label={t("mfy_cost_client")}
                  className="h-10"
                  dir="auto"
                  value={clientText}
                  onChange={(ev) => setClientText(ev.target.value)}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cost-rfq">{t("mfy_cost_rfq")}</Label>
              <Input id="cost-rfq" className="h-10" dir="ltr" value={rfqRef} onChange={(ev) => setRfqRef(ev.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cost-need">{t("mfy_cost_need")}</Label>
              <Input id="cost-need" type="date" className="h-10" dir="ltr" min={new Date().toISOString().slice(0, 10)} value={neededBy} onChange={(ev) => setNeededBy(ev.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">
              {t("mfy_cost_lines")}
              <span className="ms-0.5 text-destructive">*</span>
            </p>
            {lines.map((l, i) => {
              const p = byId.get(l.productId)
              return (
                <div key={l.key} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/10 p-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <Select value={l.productId} onValueChange={(v) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, productId: v } : x)))}>
                      <SelectTrigger className="h-10" aria-label={t("mfy_cost_line_product", { n: i + 1 })}>
                        <SelectValue placeholder={t("mfy_cost_pick_product")} />
                      </SelectTrigger>
                      <SelectContent>
                        {products.map((prod) => (
                          <SelectItem key={prod.id} value={prod.id}>{prod.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    dir="ltr"
                    inputMode="decimal"
                    className="h-10 w-24"
                    aria-label={t("mfy_cost_line_qty", { n: i + 1 })}
                    placeholder="0"
                    value={l.quantity}
                    onChange={(ev) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantity: ev.target.value } : x)))}
                  />
                  <span className="w-10 text-xs text-muted-foreground">{p?.unit || ""}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-10 w-10 text-muted-foreground hover:text-destructive"
                    disabled={lines.length === 1}
                    aria-label={t("mfy_cost_remove_line", { n: i + 1 })}
                    onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </div>
              )
            })}
            <Button type="button" size="sm" variant="ghost" className="h-9 gap-1.5 text-cta" onClick={() => setLines((ls) => [...ls, newLine()])}>
              <Plus size={14} aria-hidden="true" />
              {t("mfy_cost_add_line")}
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cost-note">{t("mfy_cost_note")}</Label>
            <Textarea id="cost-note" rows={2} dir="auto" value={note} onChange={(ev) => setNote(ev.target.value)} />
          </div>

          <p className="flex items-start gap-1.5 rounded-lg border border-cta/20 bg-cta/5 px-3 py-2 text-[11px] text-cta">
            <Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            {t("mfy_cost_ask_effect", { hours: answerWindowHours })}
          </p>
          <SignedInAs name={actor.name} />
          {error && <p className="text-xs font-semibold text-destructive" role="alert">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("crm_cancel")}</Button>
          <Button onClick={submit} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
            {t("mfy_cost_ask_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
