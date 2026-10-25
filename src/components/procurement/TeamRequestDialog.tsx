"use client"

// «طلب مواد» from the team — a company WITHOUT Project Management (Procurement 2.0, REQ-02/03): the editor's own material
// rows, then the delivery site from «مواقع التسليم» (or a typed address), the need-by date and a note. «طلبه»: whoever sources
// raises it on behalf of a member or of a receiver who has no account — his status then reaches his phone. It reaches «طلبات
// الشراء الواردة» with no technical approval, and its state comes back to whoever it is for. Written by the server.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getAuth } from "firebase/auth"
import { collection, doc, query, where } from "firebase/firestore"
import { Loader2, Send } from "lucide-react"
import { useCollection, useDoc, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { usePermissions } from "@/hooks/usePermissions"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { PROCUREMENT_RECEIVERS, phoneUsable, type ProcReceiver } from "@/lib/procurement/receivers"
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

export function TeamRequestDialog({ open, onOpenChange, orgId, onSent, from = "team" }: { open: boolean; onOpenChange: (o: boolean) => void; orgId: string; onSent?: (number: string) => void; from?: "team" | "incoming" }) {
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

  // «طلبه»: only whoever sources may raise a request for somebody else (the server refuses anyone else).
  const { can } = usePermissions()
  const mayAsk = can("offers.accept") || can("rfq.manage") || can("po.approve")
  const { orgMembers } = useOrgMembers(open && mayAsk ? orgId : null)
  const receiversQ = useMemoFirebase(() => (firestore && orgId && open && mayAsk ? query(collection(firestore, PROCUREMENT_RECEIVERS), where("organizationId", "==", orgId)) : null), [firestore, orgId, open, mayAsk])
  const { data: receiversData } = useCollection(receiversQ)
  const people = useMemo(() => {
    const accounts = new Map(orgMembers.map((m) => [m.id, (m.name as string) || (m.email as string) || m.id]))
    const receivers = ((receiversData || []) as ProcReceiver[]).filter((r) => r.active !== false).map((r) => ({ value: r.userId ? `member:${r.userId}` : `receiver:${r.id}`, name: r.name, hasAccount: Boolean(r.userId), usable: Boolean(r.userId) || phoneUsable(r.phone) }))
    const members = Array.from(accounts, ([id, name]) => ({ value: `member:${id}`, name, hasAccount: true, usable: true }))
    const seen = new Set(members.map((m) => m.value))
    return [...members, ...receivers.filter((r) => !seen.has(r.value))].sort((a, b) => a.name.localeCompare(b.name))
  }, [orgMembers, receiversData])
  const [forWhom, setForWhom] = useState("self")

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
    setForWhom("self")
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
          requestedFor: forWhom === "self" ? { kind: "self" } : { kind: forWhom.startsWith("receiver:") ? "receiver" : "member", id: forWhom.slice(forWhom.indexOf(":") + 1) },
        }),
      })
      const body = (await res.json().catch(() => null)) as { data?: { number?: string } } | null
      if (!res.ok || !body?.data?.number) {
        setError(t("tr_failed"))
        return
      }
      toast({ title: t(from === "incoming" ? "tr_sent_incoming" : "tr_sent_team", { number: body.data.number }) })
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
          {mayAsk && (
            <div className="space-y-1">
              <Label htmlFor="tr-for" className="text-xs">
                {t("tr_for")}
              </Label>
              <NativeSelect id="tr-for" value={forWhom} onChange={(e) => setForWhom(e.target.value)}>
                <option value="self">{t("tr_for_self")}</option>
                {people.map((p) => (
                  <option key={p.value} value={p.value} disabled={!p.usable}>
                    {p.hasAccount ? p.name : `${p.name} — ${t("tr_for_none")}`}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-[11px] text-muted-foreground">{t("tr_for_hint")}</p>
            </div>
          )}
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
