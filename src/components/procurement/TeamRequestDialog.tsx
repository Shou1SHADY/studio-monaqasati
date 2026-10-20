"use client"

// «طلب مواد» from the team — a company WITHOUT Project Management (Procurement 1.5, PUR-10,
// question 4): the editor's own material rows (PUR-02), then the delivery site from «مواقع التسليم»
// (or a typed address), the need-by date and a note. It reaches «طلبات الشراء الواردة» with no
// technical approval, and its state comes back to the requester. Written by the server.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getAuth } from "firebase/auth"
import { collection, doc, query, where } from "firebase/firestore"
import { Loader2, Send } from "lucide-react"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { EditorMaterials } from "@/components/procurement/rfq-editor/EditorMaterials"
import { blankLine, lineComplete, lineStarted, materialsProblems, newGroup, type EditorGroup } from "@/lib/procurement/rfq-editor"
import { toAmount } from "@/lib/procurement/offer-pricing"
import { deliverySites, storedSites } from "@/lib/procurement/delivery-sites"
import { todayOf } from "@/lib/procurement/po"
import { PROCUREMENT_SETTINGS } from "@/lib/procurement/types"

type Rec = Record<string, unknown>

export function TeamRequestDialog({ open, onOpenChange, orgId, onSent }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string; onSent?: (number: string) => void }) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { index } = useMaterialTree()
  const today = todayOf(new Date())

  const settingsRef = useMemoFirebase(() => (firestore && orgId && open ? doc(firestore, PROCUREMENT_SETTINGS, orgId) : null), [firestore, orgId, open])
  const { data: settingsDoc } = useDoc(settingsRef)
  const warehousesQ = useMemoFirebase(() => (firestore && orgId && open ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId, open])
  const { data: warehouses } = useCollection(warehousesQ)
  const sites = useMemo(() => deliverySites({ stored: storedSites((settingsDoc as Rec | null)?.deliverySites), warehouses: (warehouses || []) as Array<{ id: string; name?: string }>, projects: [], pmOn: false }), [settingsDoc, warehouses])

  const [groups, setGroups] = useState<EditorGroup[]>(() => [newGroup({ lines: [blankLine()] })])
  const [note, setNote] = useState("")
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const g = groups[0]
  const lines = g.lines.filter(lineStarted)
  const problems = materialsProblems(groups)
  const ready = lines.length > 0 && lines.every(lineComplete) && problems.length === 0 && !!g.needBy && g.needBy >= today && !!g.label.trim()

  const reset = () => {
    setGroups([newGroup({ lines: [blankLine()] })])
    setNote("")
    setTried(false)
    setError(null)
  }

  const submit = async () => {
    setTried(true)
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      const token = (await getAuth().currentUser?.getIdToken()) || ""
      const res = await fetch("/api/procurement/team-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "create",
          lines: lines.map((l) => ({ name: l.name.trim(), unit: l.unit.trim(), quantity: toAmount(l.quantity), needBy: l.needBy || null, material: l.material || null })),
          needBy: g.needBy,
          siteId: g.siteId,
          place: { label: g.label.trim(), city: g.city, district: g.district },
          note: note.trim() || null,
        }),
      })
      const body = (await res.json().catch(() => null)) as { data?: { number?: string } } | null
      if (!res.ok || !body?.data?.number) {
        setError(t("tr_failed"))
        return
      }
      toast({ title: t("tr_sent", { number: body.data.number }) })
      onSent?.(body.data.number)
      reset()
      onOpenChange(false)
    } catch {
      setError(t("tr_failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("tr_title")}</DialogTitle>
          <DialogDescription>{t("tr_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <EditorMaterials groups={groups} onChange={setGroups} index={index} sites={sites} problems={problems} showProblems={tried} />
          {!g.siteId && (
            <div className="space-y-1">
              <Label htmlFor="tr-address" className="text-xs">{t("tr_address")}</Label>
              <Input id="tr-address" value={g.label} onChange={(e) => setGroups([{ ...g, label: e.target.value }])} placeholder={t("tr_address_ph")} dir="auto" aria-invalid={(tried && !g.label.trim()) || undefined} />
              <p className="text-[11px] text-muted-foreground">{t("tr_address_hint")}</p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="tr-note" className="text-xs">{t("tr_note")}</Label>
            <Textarea id="tr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" />
          </div>
          {tried && !ready && <p className="text-xs text-destructive" role="alert">{!g.needBy || g.needBy < today ? t("tr_need_by_missing") : !g.label.trim() ? t("tr_place_missing") : t("tr_lines_missing")}</p>}
          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("acc_cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy} className="gap-1.5">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {t("tr_submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
