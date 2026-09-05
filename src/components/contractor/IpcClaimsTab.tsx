"use client"

// Progress & IPC (مستخلصات) engine. Site measurements (recorded from the BOQ
// tab) roll into physical progress and generate measured claims: quantities ×
// BOQ unit prices, minus retention and advance recovery, plus VAT. Legacy
// hand-typed claims (amount/description only) still render and still count in
// the money flow — a structured claim carries `lines` and a claimNumber.

import { useEffect, useMemo, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useCollection, useDoc, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDocs, writeBatch } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/utils/invoice-utils"
import { logFinanceAudit } from "@/lib/finance-audit"
import { cn } from "@/lib/utils"
import {
  buildClaimLines,
  computeClaimTotals,
  computeProgress,
  previouslyClaimedByItem,
  nextClaimNumber,
  DEFAULT_IPC_TERMS,
  type ClaimLine,
  type ClaimTotals,
  type IpcTerms,
  type MeasurableBoqItem,
  type MeasurementEntry,
} from "@/lib/ipc"
import {
  PlusCircle,
  ClipboardCheck,
  Loader2,
  CheckCircle2,
  Receipt,
  Ruler,
  Settings2,
  FileSpreadsheet,
  Printer,
  Eye,
} from "lucide-react"

type IpcClaim = {
  id: string
  amount: number
  description: string
  percentOfContract: number | null
  status: "submitted" | "collected"
  submittedAt?: unknown
  collectedAt?: unknown
  claimNumber?: number
  lines?: ClaimLine[]
  totals?: ClaimTotals
  terms?: IpcTerms
  periodTo?: string
}

function fmtDate(val: unknown, locale: string) {
  if (!val) return "–"
  const d =
    val && typeof val === "object" && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function"
      ? (val as { toDate: () => Date }).toDate()
      : new Date(val as string | number)
  if (isNaN(d.getTime())) return "–"
  return d.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", { year: "numeric", month: "short", day: "numeric" })
}

interface IpcClaimsTabProps {
  projectId: string
  canManage: boolean
  canEditTerms: boolean
}

export function IpcClaimsTab({ projectId, canManage, canEditTerms }: IpcClaimsTabProps) {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()

  const userDocRef = useMemoFirebase(() => {
    if (!firestore || !user) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user])
  const { data: profile } = useDoc(userDocRef)
  const actorName = (profile as { name?: string } | null)?.name || user?.email || ""

  const projectRef = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return doc(firestore, "projects", projectId)
  }, [firestore, projectId])
  const { data: project } = useDoc(projectRef)
  const terms: IpcTerms = { ...DEFAULT_IPC_TERMS, ...((project as { ipcTerms?: Partial<IpcTerms> } | null)?.ipcTerms || {}) }

  const claimsQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return collection(firestore, "projects", projectId, "ipcClaims")
  }, [firestore, projectId])
  const { data: claimsData, isLoading } = useCollection(claimsQuery)
  const claims = ((claimsData || []) as IpcClaim[]).sort((a, b) => {
    const getTime = (v: unknown) =>
      v && typeof v === "object" && "toDate" in v ? (v as { toDate: () => Date }).toDate().getTime() : 0
    return getTime(b.submittedAt) - getTime(a.submittedAt)
  })

  const measurementsQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return collection(firestore, "projects", projectId, "measurements")
  }, [firestore, projectId])
  const { data: measurementsData } = useCollection(measurementsQuery)
  const measurements = (measurementsData || []) as (MeasurementEntry & { recordedByName?: string })[]
  const unclaimedCount = measurements.filter((m) => !m.claimId).length

  const [boqItems, setBoqItems] = useState<MeasurableBoqItem[]>([])
  useEffect(() => {
    if (!firestore || !projectId) return
    let cancelled = false
    getDocs(collection(firestore, "projects", projectId, "boqItems")).then((snap) => {
      if (cancelled) return
      setBoqItems(
        snap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            itemNo: data.itemNo || "",
            descriptionAr: data.descriptionAr || "",
            descriptionEn: data.descriptionEn || data.description || "",
            unit: data.unit || "",
            quantity: Number(data.quantity) || 0,
            unitPrice: Number(data.unitPrice) || 0,
            executedQuantity: Number(data.executedQuantity) || 0,
          }
        })
      )
    })
    return () => { cancelled = true }
  }, [firestore, projectId, measurementsData])

  const progress = useMemo(() => computeProgress(boqItems), [boqItems])
  const claimedGross = claims.reduce((sum, c) => sum + (c.totals?.gross ?? c.amount ?? 0), 0)
  const collectedNet = claims.filter((c) => c.status === "collected").reduce((sum, c) => sum + (c.amount || 0), 0)

  // --- Manual (legacy) claim dialog ---
  const [showSubmit, setShowSubmit] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [percentOfContract, setPercentOfContract] = useState("")
  const [markingId, setMarkingId] = useState<string | null>(null)

  // --- Measured claim wizard ---
  const [showWizard, setShowWizard] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [detailClaim, setDetailClaim] = useState<IpcClaim | null>(null)

  // --- Terms dialog ---
  const [showTerms, setShowTerms] = useState(false)
  const [isSavingTerms, setIsSavingTerms] = useState(false)
  const [termRetention, setTermRetention] = useState("")
  const [termAdvance, setTermAdvance] = useState("")
  const [termVat, setTermVat] = useState("")

  const wizardLines = useMemo(
    () => buildClaimLines(measurements, boqItems, previouslyClaimedByItem(claims), locale),
    [measurements, boqItems, claims, locale]
  )
  const wizardTotals = useMemo(() => computeClaimTotals(wizardLines, terms), [wizardLines, terms])

  const resetForm = () => {
    setAmount("")
    setDescription("")
    setPercentOfContract("")
  }

  const handleSubmitClaim = async () => {
    if (!firestore || !user) return
    const amountNum = Number(amount)
    if (!amountNum || amountNum <= 0 || !description.trim()) {
      toast({ title: t("ipc_validation_error"), variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      const claimRef = await addDoc(collection(firestore, "projects", projectId, "ipcClaims"), {
        amount: amountNum,
        description: description.trim(),
        percentOfContract: percentOfContract ? Number(percentOfContract) : null,
        submittedByUserId: user.uid,
        status: "submitted",
        submittedAt: serverTimestamp(),
        collectedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      logFinanceAudit(firestore, projectId, {
        action: "ipc_submitted",
        actorId: user.uid,
        actorName,
        targetType: "ipcClaim",
        targetId: claimRef.id,
        amount: amountNum,
      })
      toast({ title: t("ipc_submit_success") })
      resetForm()
      setShowSubmit(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("ipc_save_error"), variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const handleGenerateClaim = async () => {
    if (!firestore || !user || wizardLines.length === 0) return
    setIsGenerating(true)
    try {
      const claimNumber = nextClaimNumber(claims)
      const claimRef = doc(collection(firestore, "projects", projectId, "ipcClaims"))
      const batch = writeBatch(firestore)
      batch.set(claimRef, {
        claimNumber,
        description: t("ipc_measured_claim_title", { number: claimNumber }),
        lines: wizardLines,
        totals: wizardTotals,
        terms,
        // `amount` keeps the money-flow claimed/collected stages working — the
        // collectible value of a measured claim is its NET.
        amount: wizardTotals.net,
        percentOfContract: progress.contractValue > 0
          ? Math.round((wizardTotals.gross / progress.contractValue) * 10000) / 100
          : null,
        periodTo: new Date().toISOString().slice(0, 10),
        submittedByUserId: user.uid,
        status: "submitted",
        submittedAt: serverTimestamp(),
        collectedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      measurements.filter((m) => !m.claimId).forEach((m) => {
        batch.update(doc(firestore, "projects", projectId, "measurements", m.id), { claimId: claimRef.id })
      })
      await batch.commit()
      logFinanceAudit(firestore, projectId, {
        action: "ipc_submitted",
        actorId: user.uid,
        actorName,
        targetType: "ipcClaim",
        targetId: claimRef.id,
        amount: wizardTotals.net,
      })
      toast({ title: t("ipc_generated_success", { number: claimNumber }) })
      setShowWizard(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("ipc_save_error"), variant: "destructive" })
    } finally {
      setIsGenerating(false)
    }
  }

  const handleMarkCollected = async (claim: IpcClaim) => {
    if (!firestore || !user) return
    setMarkingId(claim.id)
    try {
      await updateDoc(doc(firestore, "projects", projectId, "ipcClaims", claim.id), {
        status: "collected",
        collectedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      logFinanceAudit(firestore, projectId, {
        action: "ipc_collected",
        actorId: user.uid,
        actorName,
        targetType: "ipcClaim",
        targetId: claim.id,
        amount: claim.amount,
      })
      toast({ title: t("ipc_marked_collected") })
    } catch (err) {
      console.error(err)
      toast({ title: t("ipc_save_error"), variant: "destructive" })
    } finally {
      setMarkingId(null)
    }
  }

  const handleSaveTerms = async () => {
    if (!firestore || !projectRef) return
    setIsSavingTerms(true)
    try {
      await updateDoc(projectRef, {
        ipcTerms: {
          retentionPercent: Number(termRetention) || 0,
          advanceRecoveryPercent: Number(termAdvance) || 0,
          vatPercent: Number(termVat) || 0,
        },
        updatedAt: serverTimestamp(),
      })
      toast({ title: t("ipc_terms_saved") })
      setShowTerms(false)
    } catch (err) {
      console.error(err)
      toast({ title: t("ipc_save_error"), variant: "destructive" })
    } finally {
      setIsSavingTerms(false)
    }
  }

  const openTerms = () => {
    setTermRetention(String(terms.retentionPercent))
    setTermAdvance(String(terms.advanceRecoveryPercent))
    setTermVat(String(terms.vatPercent))
    setShowTerms(true)
  }

  const printClaim = (claim: IpcClaim) => {
    const w = window.open("", "_blank", "width=900,height=700")
    if (!w) return
    const rows = (claim.lines || [])
      .map(
        (l) => `<tr>
          <td>${l.itemNo}</td><td>${l.description}</td><td>${l.unit}</td>
          <td>${l.unitPrice.toLocaleString()}</td><td>${l.previousQty.toLocaleString()}</td>
          <td>${l.currentQty.toLocaleString()}</td><td>${l.cumulativeQty.toLocaleString()}</td>
          <td>${l.amount.toLocaleString()}</td></tr>`
      )
      .join("")
    const tt = claim.totals
    w.document.write(`<!doctype html><html dir="${isRtl ? "rtl" : "ltr"}"><head><meta charset="utf-8">
      <title>${t("ipc_measured_claim_title", { number: claim.claimNumber || 0 })}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px}h1{font-size:18px}table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:${isRtl ? "right" : "left"}}th{background:#f1f5f9}
      .totals{margin-top:16px;width:320px;margin-inline-start:auto}.totals td{font-weight:bold}</style></head><body>
      <h1>${t("ipc_measured_claim_title", { number: claim.claimNumber || 0 })} — ${(project as { name?: string } | null)?.name || ""}</h1>
      <p>${t("ipc_period_to")}: ${claim.periodTo || "–"}</p>
      <table><thead><tr><th>${t("proj_boq_item_no")}</th><th>${t("proj_boq_description")}</th><th>${t("proj_boq_unit")}</th>
      <th>${t("proj_boq_unit_price")}</th><th>${t("ipc_col_previous")}</th><th>${t("ipc_col_current")}</th>
      <th>${t("ipc_col_cumulative")}</th><th>${t("ipc_col_amount")}</th></tr></thead><tbody>${rows}</tbody></table>
      ${tt ? `<table class="totals"><tr><td>${t("ipc_total_gross")}</td><td>${tt.gross.toLocaleString()}</td></tr>
      <tr><td>${t("ipc_total_retention")} (${claim.terms?.retentionPercent ?? ""}%)</td><td>-${tt.retention.toLocaleString()}</td></tr>
      <tr><td>${t("ipc_total_advance")} (${claim.terms?.advanceRecoveryPercent ?? ""}%)</td><td>-${tt.advanceRecovery.toLocaleString()}</td></tr>
      <tr><td>${t("ipc_total_vat")} (${claim.terms?.vatPercent ?? ""}%)</td><td>+${tt.vat.toLocaleString()}</td></tr>
      <tr><td>${t("ipc_total_net")}</td><td>${tt.net.toLocaleString()}</td></tr></table>` : ""}
      <script>window.print()</script></body></html>`)
    w.document.close()
  }

  const claimLinesTable = (lines: ClaimLine[]) => (
    <div className="overflow-x-auto border rounded-lg">
      <table className="w-full text-xs">
        <thead className="bg-slate-50">
          <tr>
            <th className="p-2 text-start font-bold">{t("proj_boq_item_no")}</th>
            <th className="p-2 text-start font-bold">{t("proj_boq_description")}</th>
            <th className="p-2 text-start font-bold">{t("proj_boq_unit")}</th>
            <th className="p-2 text-start font-bold">{t("proj_boq_unit_price")}</th>
            <th className="p-2 text-start font-bold">{t("ipc_col_previous")}</th>
            <th className="p-2 text-start font-bold">{t("ipc_col_current")}</th>
            <th className="p-2 text-start font-bold">{t("ipc_col_cumulative")}</th>
            <th className="p-2 text-start font-bold">{t("ipc_col_amount")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.boqItemId} className="border-t">
              <td className="p-2 whitespace-nowrap">{l.itemNo || "–"}</td>
              <td className="p-2 max-w-[220px] truncate" title={l.description}>{l.description}</td>
              <td className="p-2">{l.unit}</td>
              <td className="p-2 tabular-nums" dir="ltr">{l.unitPrice.toLocaleString()}</td>
              <td className="p-2 tabular-nums" dir="ltr">{l.previousQty.toLocaleString()}</td>
              <td className="p-2 tabular-nums font-bold text-cta" dir="ltr">{l.currentQty.toLocaleString()}</td>
              <td className="p-2 tabular-nums" dir="ltr">
                {l.cumulativeQty.toLocaleString()}
                {l.contractQty > 0 && l.cumulativeQty > l.contractQty && (
                  <span className="text-destructive font-bold mx-1">!</span>
                )}
              </td>
              <td className="p-2 tabular-nums font-semibold" dir="ltr">{l.amount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const totalsBlock = (tt: ClaimTotals, tm: IpcTerms) => (
    <div className="ms-auto w-full sm:w-72 space-y-1 text-sm">
      <div className="flex justify-between"><span className="text-muted-foreground">{t("ipc_total_gross")}</span><b dir="ltr">{formatCurrency(tt.gross, locale)}</b></div>
      <div className="flex justify-between"><span className="text-muted-foreground">{t("ipc_total_retention")} ({tm.retentionPercent}%)</span><b dir="ltr" className="text-destructive">-{formatCurrency(tt.retention, locale)}</b></div>
      <div className="flex justify-between"><span className="text-muted-foreground">{t("ipc_total_advance")} ({tm.advanceRecoveryPercent}%)</span><b dir="ltr" className="text-destructive">-{formatCurrency(tt.advanceRecovery, locale)}</b></div>
      <div className="flex justify-between"><span className="text-muted-foreground">{t("ipc_total_vat")} ({tm.vatPercent}%)</span><b dir="ltr">+{formatCurrency(tt.vat, locale)}</b></div>
      <Separator />
      <div className="flex justify-between text-base"><span className="font-bold">{t("ipc_total_net")}</span><b dir="ltr" className="text-success">{formatCurrency(tt.net, locale)}</b></div>
    </div>
  )

  return (
    <div className="space-y-5" dir={isRtl ? "rtl" : "ltr"}>
      {/* Physical progress + money summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-4 rounded-xl border bg-white col-span-2 lg:col-span-1">
          <p className="text-xs text-muted-foreground font-semibold">{t("ipc_progress_title")}</p>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-2xl font-black text-foreground tabular-nums" dir="ltr">{progress.percent}%</span>
            <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-cta" style={{ width: `${Math.min(100, progress.percent)}%` }} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5" dir="ltr">
            {formatCurrency(progress.executedValue, locale)} / {formatCurrency(progress.contractValue, locale)}
          </p>
        </div>
        <div className="p-4 rounded-xl border bg-white">
          <p className="text-xs text-muted-foreground font-semibold">{t("ipc_stat_claimed")}</p>
          <p className="text-xl font-black mt-2 tabular-nums" dir="ltr">{formatCurrency(claimedGross, locale)}</p>
        </div>
        <div className="p-4 rounded-xl border bg-white">
          <p className="text-xs text-muted-foreground font-semibold">{t("ipc_stat_collected")}</p>
          <p className="text-xl font-black mt-2 tabular-nums text-success" dir="ltr">{formatCurrency(collectedNet, locale)}</p>
        </div>
        <div className="p-4 rounded-xl border bg-white">
          <p className="text-xs text-muted-foreground font-semibold">{t("ipc_stat_unclaimed")}</p>
          <p className="text-xl font-black mt-2 tabular-nums" dir="ltr">{unclaimedCount}</p>
          <p className="text-[11px] text-muted-foreground">{t("ipc_stat_unclaimed_hint")}</p>
        </div>
      </div>

      {/* Contract terms */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <Badge variant="outline" className="gap-1">{t("ipc_terms_retention")}: {terms.retentionPercent}%</Badge>
        <Badge variant="outline" className="gap-1">{t("ipc_terms_advance")}: {terms.advanceRecoveryPercent}%</Badge>
        <Badge variant="outline" className="gap-1">{t("ipc_terms_vat")}: {terms.vatPercent}%</Badge>
        {canEditTerms && (
          <button
            type="button"
            onClick={openTerms}
            className="inline-flex items-center gap-1 text-cta font-semibold hover:underline rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings2 size={13} />
            {t("ipc_terms_edit")}
          </button>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Receipt size={18} className="text-primary" />
            {t("ipc_list_title")}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">{t("ipc_list_desc")}</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowSubmit(true)}>
              <PlusCircle size={15} />
              {t("ipc_manual_btn")}
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setShowWizard(true)} disabled={unclaimedCount === 0}>
              <FileSpreadsheet size={15} />
              {t("ipc_generate_btn")}
              {unclaimedCount > 0 && (
                <span className="h-5 min-w-5 px-1 rounded-full bg-white/20 text-[11px] font-black grid place-items-center">{unclaimedCount}</span>
              )}
            </Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-16">
          <Loader2 className="animate-spin text-muted-foreground" size={28} />
        </div>
      ) : claims.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground border border-dashed rounded-xl">
          <ClipboardCheck size={36} className="mx-auto mb-2 opacity-20" />
          <p className="text-sm">{t("ipc_empty_state")}</p>
          <p className="text-xs mt-1">{t("ipc_empty_hint")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {claims.map((claim) => (
            <div key={claim.id} className="flex items-center justify-between gap-3 p-4 rounded-xl border border-slate-200/70 bg-white">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {claim.claimNumber != null && (
                    <Badge className="bg-primary/10 text-primary border-none text-[11px] font-bold">
                      {t("ipc_claim_number", { number: claim.claimNumber })}
                    </Badge>
                  )}
                  <span className="font-bold text-sm text-slate-800" dir="ltr">{formatCurrency(claim.amount, locale)}</span>
                  {claim.percentOfContract != null && (
                    <span className="text-xs text-muted-foreground">({claim.percentOfContract}%)</span>
                  )}
                  <Badge variant={claim.status === "collected" ? "default" : "outline"} className={claim.status === "collected" ? "bg-success text-white border-none" : ""}>
                    {claim.status === "collected" ? t("ipc_status_collected") : t("ipc_status_submitted")}
                  </Badge>
                </div>
                <p className="text-sm text-slate-600 mt-1 truncate">{claim.description}</p>
                <p className="text-xs text-muted-foreground mt-1" suppressHydrationWarning>
                  {fmtDate(claim.submittedAt, locale)}
                  {claim.lines && <span className="mx-2">·</span>}
                  {claim.lines && t("ipc_lines_count", { count: claim.lines.length })}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {claim.lines && (
                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setDetailClaim(claim)}>
                    <Eye size={14} />
                    {t("ipc_view_detail")}
                  </Button>
                )}
                {canManage && claim.status === "submitted" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-success/30 text-success hover:bg-success hover:text-white hover:border-success"
                    onClick={() => handleMarkCollected(claim)}
                    disabled={markingId === claim.id}
                  >
                    {markingId === claim.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                    {t("ipc_mark_collected")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Measured-claim wizard */}
      <Dialog open={showWizard} onOpenChange={(open) => { if (!isGenerating) setShowWizard(open) }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir={isRtl ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ruler size={18} className="text-cta" />
              {t("ipc_wizard_title", { number: nextClaimNumber(claims) })}
            </DialogTitle>
            <DialogDescription>{t("ipc_wizard_desc")}</DialogDescription>
          </DialogHeader>
          {wizardLines.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">{t("ipc_wizard_empty")}</p>
          ) : (
            <div className="space-y-4">
              {claimLinesTable(wizardLines)}
              {totalsBlock(wizardTotals, terms)}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWizard(false)} disabled={isGenerating}>{t("cancel")}</Button>
            <Button onClick={handleGenerateClaim} disabled={isGenerating || wizardLines.length === 0} className="gap-2">
              {isGenerating ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
              {t("ipc_wizard_submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Claim detail */}
      <Dialog open={!!detailClaim} onOpenChange={(open) => { if (!open) setDetailClaim(null) }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir={isRtl ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2 flex-wrap">
              <span>{t("ipc_claim_number", { number: detailClaim?.claimNumber || 0 })}</span>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => detailClaim && printClaim(detailClaim)}>
                <Printer size={14} />
                {t("ipc_print")}
              </Button>
            </DialogTitle>
            <DialogDescription suppressHydrationWarning>
              {t("ipc_period_to")}: {detailClaim?.periodTo || "–"} · {fmtDate(detailClaim?.submittedAt, locale)}
            </DialogDescription>
          </DialogHeader>
          {detailClaim?.lines && (
            <div className="space-y-4">
              {claimLinesTable(detailClaim.lines)}
              {detailClaim.totals && totalsBlock(detailClaim.totals, detailClaim.terms || terms)}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Contract terms dialog */}
      <Dialog open={showTerms} onOpenChange={(open) => { if (!isSavingTerms) setShowTerms(open) }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{t("ipc_terms_title")}</DialogTitle>
            <DialogDescription>{t("ipc_terms_desc")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="term-retention">{t("ipc_terms_retention")} %</Label>
              <Input id="term-retention" type="number" min={0} max={100} value={termRetention} onChange={(e) => setTermRetention(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="term-advance">{t("ipc_terms_advance")} %</Label>
              <Input id="term-advance" type="number" min={0} max={100} value={termAdvance} onChange={(e) => setTermAdvance(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="term-vat">{t("ipc_terms_vat")} %</Label>
              <Input id="term-vat" type="number" min={0} max={100} value={termVat} onChange={(e) => setTermVat(e.target.value)} dir="ltr" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTerms(false)} disabled={isSavingTerms}>{t("cancel")}</Button>
            <Button onClick={handleSaveTerms} disabled={isSavingTerms} className="gap-2">
              {isSavingTerms ? <Loader2 size={15} className="animate-spin" /> : null}
              {t("ipc_terms_save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual claim (legacy) */}
      <Dialog open={showSubmit} onOpenChange={(open) => { if (!isSaving) { setShowSubmit(open); if (!open) resetForm() } }}>
        <DialogContent dir={isRtl ? "rtl" : "ltr"}>
          <DialogHeader>
            <DialogTitle>{t("ipc_submit_title")}</DialogTitle>
            <DialogDescription>{t("ipc_submit_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ipc-amount">{t("ipc_amount")} *</Label>
              <Input id="ipc-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ipc-percent">{t("ipc_percent_of_contract")}</Label>
              <Input id="ipc-percent" type="number" min={0} max={100} value={percentOfContract} onChange={(e) => setPercentOfContract(e.target.value)} dir="ltr" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ipc-desc">{t("ipc_description")} *</Label>
              <Textarea id="ipc-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSubmit(false)} disabled={isSaving}>{t("cancel")}</Button>
            <Button onClick={handleSubmitClaim} disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 size={15} className="animate-spin" /> : null}
              {t("ipc_submit_btn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
