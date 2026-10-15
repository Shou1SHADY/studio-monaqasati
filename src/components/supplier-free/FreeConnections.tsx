"use client"

// Contractors (PRD CON-01…03, WF-17): the connected (their mobile and private requests reach the supplier), the invitations
// that wait for his answer — accept, or decline after a confirmation — and the requests he sent himself.

import { useMemo, useState } from "react"
import { collection, doc, getDocs, query, setDoc, updateDoc, where, serverTimestamp } from "firebase/firestore"
import { Building2, Check, Link2, Loader2, MessageSquare, Phone, Plus } from "lucide-react"
import { Link } from "@/i18n/routing"
import { useFirestore } from "@/firebase"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { useToast } from "@/hooks/use-toast"
import { answerInvitation, tellOwnerAboutRequest } from "@/lib/supplier-free/connections"
import { FreePage, Pill, VerifiedMark, useQueryState } from "./ui"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { useFree } from "./useFree"

export function FreeConnections() {
  const f = useFree()
  const { t, world, L, fmt, profile, refreshInvites } = f
  const q = useQueryState()
  const firestore = useFirestore()
  const { toast } = useToast()
  const tab = (["active", "inv", "req"] as const).find((x) => x === q.get("tab")) || "active"
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reqOpen, setReqOpen] = useState(false)
  const connected = Object.entries(world.contractors).filter(([, c]) => c.conn)
  const reqs = useMemo(() => world.requests || [], [world.requests])

  const answer = async (id: string, contractorOrgId: string, a: "accepted" | "declined") => {
    setBusy(id)
    try {
      await answerInvitation(id, a)
      await refreshInvites()
      toast({ title: a === "accepted" ? t("tInvOk", { c: L.C(contractorOrgId)?.name || "" }) : t("tInvNo") })
    } catch (err) {
      console.error(err)
      toast({ title: t("errSave"), variant: "destructive" })
    } finally {
      setBusy(null)
      setConfirm(null)
    }
  }

  const pending = world.invites
  const confirmFor = confirm ? pending.find((i) => i.id === confirm) : null
  return (
    <FreePage
      icon={Link2}
      title={t("navConnections")}
      description={t("cSub")}
      action={
        <Button onClick={() => setReqOpen(true)} className="bg-cta text-cta-foreground hover:bg-cta/90">
          <Plus size={15} className="me-1.5" aria-hidden="true" />
          {t("btnConnReq")}
        </Button>
      }
    >
      <SegmentedNav
        ariaLabel={t("navConnections")}
        active={tab}
        onSelect={(id) => q.set({ tab: id === "active" ? "" : id })}
        segments={[
          { id: "active", label: t("cConn"), count: connected.length },
          { id: "inv", label: t("cInv"), count: pending.length, tone: "warn" },
          { id: "req", label: t("cReq"), count: reqs.length },
        ]}
      />
      {tab === "active" &&
        (connected.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {connected.map(([id, c]) => {
              const ds = world.deals.filter((d) => d.c === id)
              const open = ds.filter((d) => L.stage(d) !== "done").length
              const won = ds.filter((d) => L.offerSt(d) === "won").length
              return (
                <article key={id} className="flex flex-col gap-3 rounded-xl border bg-card p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-module/10 text-module"><Building2 size={18} aria-hidden="true" /></span>
                    <div className="min-w-0">
                      <b className="block text-sm"><bdi>{c.name}</bdi> <VerifiedMark f={f} verified={c.verified} /></b>
                      <small className="text-xs text-muted-foreground">{c.city} · {t("connSince", { x: fmt.date(c.conn, true) })}</small>
                    </div>
                  </div>
                  <p className="text-sm"><b className="tabular-nums">{ds.length}</b> {t("cDeals")} · {open} {t("cOpen")} · {won} {t("cWon")}</p>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <Link href={`/supplier/offers?c=${id}` as never} className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-bold hover:bg-muted/50"><MessageSquare size={13} aria-hidden="true" />{t("cSeeOffers")}</Link>
                    {c.phone && <a href={`tel:${c.phone}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border bg-card px-3 text-xs font-bold hover:bg-muted/50"><Phone size={13} aria-hidden="true" />{t("call")}</a>}
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <EmptyState icon={Link2} title={t("cConnEmpty")} description={t("cConnEmptyX")} />
        ))}
      {tab === "inv" &&
        (pending.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pending.map((iv) => {
              const c = L.C(iv.c)
              return (
                <article key={iv.id} className="flex flex-col gap-3 rounded-xl border border-cta/30 bg-cta/5 p-4">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cta/10 text-cta"><Building2 size={18} aria-hidden="true" /></span>
                    <div className="min-w-0">
                      <small className="block text-[11px] text-muted-foreground">{t("invFrom")}</small>
                      <b className="block text-sm"><bdi>{c?.name || "—"}</bdi> <VerifiedMark f={f} verified={!!c?.verified} /></b>
                      <small className="text-xs text-muted-foreground">{c?.city} · {t("invAt", { x: fmt.date(iv.at, true) })}</small>
                    </div>
                  </div>
                  {iv.note && <p className="rounded-lg bg-card px-3 py-2 text-sm" dir="auto">{iv.note}</p>}
                  <p className="text-xs text-muted-foreground">{t("invWhat")}</p>
                  <div className="mt-auto flex gap-2">
                    <Button size="sm" disabled={busy === iv.id} onClick={() => iv.id && void answer(iv.id, iv.c, "accepted")} className="bg-cta text-cta-foreground hover:bg-cta/90">
                      {busy === iv.id ? <Loader2 size={13} className="me-1 animate-spin" aria-hidden="true" /> : <Check size={13} className="me-1" aria-hidden="true" />}
                      {t("btnInvOk")}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === iv.id} onClick={() => setConfirm(iv.id || null)} className="text-destructive">
                      {t("btnInvNo")}
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        ) : (
          <EmptyState icon={Link2} title={t("cInvEmpty")} />
        ))}
      {tab === "req" &&
        (reqs.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {reqs.map((r) => (
              <article key={r.c} className="flex items-center gap-3 rounded-xl border bg-card p-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-module/10 text-module"><Building2 size={18} aria-hidden="true" /></span>
                <div className="min-w-0 flex-1">
                  <b className="block text-sm"><bdi>{L.C(r.c)?.name}</bdi></b>
                  <small className="text-xs text-muted-foreground">{t("reqAt", { x: fmt.date(r.at, true) })}</small>
                </div>
                <Pill tone="info" dot>{t("reqWait")}</Pill>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon={Link2} title={t("cReqEmpty")} />
        ))}

      {confirmFor && (
        <Dialog open onOpenChange={(o) => !o && !busy && setConfirm(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("mInvNoT", { c: L.C(confirmFor.c)?.name || "" })}</DialogTitle>
              <DialogDescription>{t("mInvNoSub")}</DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">{t("mInvNoX")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirm(null)} disabled={!!busy}>{t("cancel")}</Button>
              <Button variant="destructive" disabled={!!busy} onClick={() => confirmFor.id && void answer(confirmFor.id, confirmFor.c, "declined")}>{t("btnInvNo")}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {reqOpen && profile && firestore && (
        <RequestDialog
          onClose={() => setReqOpen(false)}
          onSent={(name) => {
            toast({ title: t("tConnSent", { c: name }) })
            setReqOpen(false)
          }}
        />
      )}
    </FreePage>
  )
}

function RequestDialog({ onClose, onSent }: { onClose: () => void; onSent: (name: string) => void }) {
  const f = useFree()
  const { t, world, L, profile } = f
  const firestore = useFirestore()
  const { toast } = useToast()
  const [pick, setPick] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const invited = new Set(world.invites.map((i) => i.c))
  const requested = new Set((world.requests || []).map((r) => r.c))
  const options = Object.entries(world.contractors).filter(([id, c]) => !c.conn && !invited.has(id) && !requested.has(id))
  const send = async () => {
    if (!firestore || !profile || !pick) return
    setBusy(true)
    try {
      const existing = await getDocs(query(collection(firestore, "contractorSupplierLinks"), where("supplierOrgId", "==", profile.orgId), where("contractorOrgId", "==", pick)))
      const stale = existing.docs[0]
      const data = { contractorOrgId: pick, supplierOrgId: profile.orgId, supplierName: profile.companyName, supplierCategories: profile.specializations, status: "pending", requestedBy: "supplier", requestNote: note.trim().slice(0, 300), requestedAt: serverTimestamp(), updatedAt: serverTimestamp() }
      if (stale) await updateDoc(stale.ref, data)
      else await setDoc(doc(collection(firestore, "contractorSupplierLinks")), data)
      await tellOwnerAboutRequest(firestore, { orgId: profile.orgId, uid: profile.uid, name: profile.name, company: profile.companyName }, pick, note)
      onSent(L.C(pick)?.name || "")
    } catch (err) {
      // A refused write (an old link the rules will not reopen, the network) is said, never swallowed (CON-03).
      console.error(err)
      toast({ title: t("errSave"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("mConnT")}</DialogTitle>
          <DialogDescription>{t("mConnSub")}</DialogDescription>
        </DialogHeader>
        {options.length ? (
          <>
            <label className="block text-sm font-semibold">
              {t("mConnPick")}
              <NativeSelect className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="" />
                {options.map(([id, c]) => <option key={id} value={id}>{c.name}</option>)}
              </NativeSelect>
            </label>
            <textarea rows={2} maxLength={300} placeholder={t("mConnPh")} aria-label={t("mConnPh")} className="w-full rounded-lg border bg-background px-3 py-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("tNoMoreConn")}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("cancel")}</Button>
          <Button disabled={!pick || busy} onClick={() => void send()} className="bg-cta text-cta-foreground hover:bg-cta/90">{t("btnConnSend")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
