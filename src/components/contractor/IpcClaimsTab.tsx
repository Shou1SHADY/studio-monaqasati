"use client"

// Minimal IPC/claims (مستخلصات) feature — submit a claim, then flip it to
// collected. No measurement/retention logic; exists to power the money-flow
// visualization's collection side (claimed/collected stages) with real data.

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useCollection, useDoc, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { collection, addDoc, doc, updateDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/utils/invoice-utils"
import { logFinanceAudit } from "@/lib/finance-audit"
import { PlusCircle, ClipboardCheck, Loader2, CheckCircle2, Receipt, History } from "lucide-react"

type FinanceAuditEntry = {
  id: string
  action: "ipc_submitted" | "ipc_collected"
  actorName: string
  amount: number
  createdAt?: unknown
}

type IpcClaim = {
  id: string
  amount: number
  description: string
  percentOfContract: number | null
  status: "submitted" | "collected"
  submittedAt?: unknown
  collectedAt?: unknown
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
}

export function IpcClaimsTab({ projectId, canManage }: IpcClaimsTabProps) {
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
  const actorName = (profile as { name?: string } | null)?.name || user?.email || "عضو الفريق"

  const auditQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return collection(firestore, "projects", projectId, "financeAuditLog")
  }, [firestore, projectId])
  const { data: auditData } = useCollection(auditQuery)
  const auditLog = ((auditData || []) as FinanceAuditEntry[]).sort((a, b) => {
    const getTime = (v: unknown) =>
      v && typeof v === "object" && "toDate" in v ? (v as { toDate: () => Date }).toDate().getTime() : 0
    return getTime(b.createdAt) - getTime(a.createdAt)
  })

  const [showSubmit, setShowSubmit] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [percentOfContract, setPercentOfContract] = useState("")
  const [markingId, setMarkingId] = useState<string | null>(null)

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

  return (
    <div className="space-y-4" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Receipt size={18} className="text-primary" />
            {t("ipc_list_title")}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">{t("ipc_list_desc")}</p>
        </div>
        {canManage && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowSubmit(true)}>
            <PlusCircle size={15} />
            {t("ipc_submit_btn")}
          </Button>
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
        </div>
      ) : (
        <div className="space-y-2">
          {claims.map((claim) => (
            <div key={claim.id} className="flex items-center justify-between gap-3 p-4 rounded-xl border border-slate-200/70 bg-white">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
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
                </p>
              </div>
              {canManage && claim.status === "submitted" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 shrink-0 border-success/30 text-success hover:bg-success hover:text-white hover:border-success"
                  onClick={() => handleMarkCollected(claim)}
                  disabled={markingId === claim.id}
                >
                  {markingId === claim.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {t("ipc_mark_collected")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {auditLog.length > 0 && (
        <div className="pt-2">
          <h4 className="font-bold text-sm flex items-center gap-1.5 text-slate-600 mb-2">
            <History size={14} />
            {t("finance_audit_title")}
          </h4>
          <div className="space-y-1.5">
            {auditLog.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-50 text-xs">
                <span className="text-slate-600">
                  <span className="font-bold text-slate-800">{entry.actorName}</span>{" "}
                  {entry.action === "ipc_submitted" ? t("finance_audit_ipc_submitted") : t("finance_audit_ipc_collected")}{" "}
                  <span className="font-semibold" dir="ltr">{formatCurrency(entry.amount, locale)}</span>
                </span>
                <span className="text-slate-400 shrink-0" suppressHydrationWarning>{fmtDate(entry.createdAt, locale)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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
