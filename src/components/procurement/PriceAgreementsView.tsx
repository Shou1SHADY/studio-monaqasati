"use client"

// The Suppliers tab's agreements segment (PRD 3.0 §7.2, prototype vSup:agr).
//
// An agreement is a price we already negotiated, so the only question the list
// has to answer at a glance is "which of these is about to stop being true".
// Expiring ones sort first and carry the amber; an expired one stays visible,
// because the orders placed on it still name it — and the last column counts
// them. Renewing and ending live in the drawer, beside the evidence: each
// material's agreed price against what we last paid ELSEWHERE.

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Handshake, Info, Loader2, Plus, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useFirestore } from "@/firebase"
import { matchesSearch } from "@/lib/search-text"
import { displayAgreementNumber } from "@/lib/procurement/format"
import { agreementRows, type PriceAgreement, type PriceHistoryEntry } from "@/lib/procurement/prices"
import { endPriceAgreement } from "@/lib/procurement/agreement-writes"
import { agreementOrderCounts } from "@/lib/procurement/supplier-file"
import { ProcWriteError } from "@/lib/procurement/writes"
import type { ProcActor, PurchaseOrder } from "@/lib/procurement/types"
import { AgreementDialog } from "./AgreementDialog"
import { AgreementDrawer } from "./AgreementDrawer"
import { sarLtr } from "@/lib/riyal"

/** A unit price, as the prototype's R2: two decimals, the riyal sign on its left. */
const priceText = (n: number) => sarLtr(Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export function PriceAgreementsView({
  agreements,
  history,
  orders,
  actor,
  orgId,
  locale,
  suppliers,
  mayEdit,
  mayRenew,
  ownerHasTeam = false,
  fmtDate,
  focusId,
  onFocusChange,
}: {
  agreements: PriceAgreement[]
  history: PriceHistoryEntry[]
  orders: PurchaseOrder[]
  actor: ProcActor
  orgId: string
  locale: string
  suppliers: Array<{ id: string; name: string }>
  /** Sign a new agreement: the manager and the buyer. */
  mayEdit: boolean
  /** Renew or end one: the manager only (prototype «جدّد» — `CAN('all')`). */
  mayRenew: boolean
  ownerHasTeam?: boolean
  fmtDate: (value: unknown, locale: string) => string
  /** The agreement whose drawer is open — `?agreement=` or a supplier file's link. */
  focusId?: string | null
  onFocusChange?: (id: string | null) => void
}) {
  const t = useTranslations("Portal.ProcPrices")
  const firestore = useFirestore()
  const [dialogFor, setDialogFor] = useState<PriceAgreement | null | undefined>(undefined)
  const [endTarget, setEndTarget] = useState<PriceAgreement | null>(null)
  const [endReason, setEndReason] = useState("")
  const [ending, setEnding] = useState(false)
  const [endError, setEndError] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [openId, setOpenId] = useState<string | null>(focusId || null)
  useEffect(() => setOpenId(focusId || null), [focusId])
  const pick = (id: string | null) => {
    setOpenId(id)
    onFocusChange?.(id)
  }

  const today = new Date().toISOString().slice(0, 10)
  const counts = useMemo(() => agreementOrderCounts(orders), [orders])
  const rows = useMemo(
    () => agreementRows(agreements, today).filter((a) => matchesSearch(q, [a.docNumber, displayAgreementNumber(a.docNumber, locale), a.supplierName, ...(a.lines || []).map((l) => l.name)])),
    [agreements, today, q, locale]
  )
  // One entry per material history knows, in the words its orders used.
  const knownMaterials = useMemo(() => {
    const seen = new Map<string, { name: string; unit: string }>()
    for (const h of history) if (!seen.has(h.materialKey)) seen.set(h.materialKey, { name: h.name, unit: h.unit })
    return Array.from(seen.values())
  }, [history])
  const open = agreements.find((a) => a.id === openId) || null

  const endIt = async () => {
    if (!firestore || !endTarget || !endReason.trim()) return
    setEnding(true)
    setEndError(null)
    try {
      await endPriceAgreement(firestore, actor, endTarget.id, endReason, { ownerHasTeam })
      setEndTarget(null)
      setEndReason("")
    } catch (err) {
      // The real reason, not "try again": a retry never fixes a refusal.
      setEndError(err instanceof ProcWriteError && t.has(`err.${err.code}`) ? t(`err.${err.code}`) : t("err.generic"))
    } finally {
      setEnding(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("agreements.intro")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("agreements.search")} aria-label={t("agreements.search")} className="ps-9" />
          </div>
          {mayEdit && (
            <Button size="sm" onClick={() => setDialogFor(null)}>
              <Plus size={14} className="me-1.5" aria-hidden="true" />
              {t("agreements.new")}
            </Button>
          )}
        </div>
      </div>

      {agreements.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-muted/30 p-16 text-center text-muted-foreground">
          <Handshake size={44} className="mx-auto mb-4 opacity-20" aria-hidden="true" />
          <p className="text-lg font-bold">{t("agreements.emptyTitle")}</p>
          <p className="mt-1 text-sm">{t("agreements.emptyDesc")}</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/50 text-xs">
              <tr>
                <th className="p-3 text-start font-bold">{t("agreements.colAgreement")}</th>
                <th className="p-3 text-start font-bold">{t("agreements.colItems")}</th>
                <th className="p-3 text-start font-bold">{t("agreements.colEnds")}</th>
                <th className="p-3 text-end font-bold">{t("agreements.colOrders")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-6 text-center text-sm text-muted-foreground">
                    {t("agreements.noMatch")}
                  </td>
                </tr>
              )}
              {rows.map((a) => (
                <tr key={a.id} className="cursor-pointer border-t align-top hover:bg-muted/40" onClick={() => pick(a.id)}>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        pick(a.id)
                      }}
                      className="rounded font-bold tabular-nums hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      dir="ltr"
                    >
                      {displayAgreementNumber(a.docNumber, locale)}
                    </button>
                    <span className="block text-xs text-muted-foreground" dir="auto">
                      {a.supplierName || "—"}
                    </span>
                  </td>
                  <td className="p-3">
                    <ul className="space-y-1">
                      {(a.lines || []).map((l, i) => (
                        <li key={i}>
                          <span dir="auto">{l.name}</span>
                          <span className="text-muted-foreground">
                            {" — "}
                            <b className="tabular-nums text-foreground" dir="ltr">
                              {priceText(l.price)}
                            </b>
                            {` / ${l.unit}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="p-3">
                    {a.state === "expired" ? (
                      <StatusPill tone="bad">{t("state.expired")}</StatusPill>
                    ) : a.state === "upcoming" ? (
                      <>
                        <StatusPill tone="mute">{t("state.upcoming")}</StatusPill>
                        <span className="mt-1 block text-[11px] text-muted-foreground">{fmtDate(a.until, locale)}</span>
                      </>
                    ) : (
                      <span className={a.state === "expiring" ? "font-bold text-warning" : undefined}>{fmtDate(a.until, locale)}</span>
                    )}
                  </td>
                  <td className="p-3 text-end tabular-nums">{counts.get(a.id) || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="flex gap-2 rounded-xl border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
        {t("agreements.skipsRfq")}
      </p>

      <AgreementDrawer
        agreement={open}
        open={Boolean(open)}
        onOpenChange={(o) => !o && pick(null)}
        history={history}
        orders={orders}
        today={today}
        mayEdit={mayRenew}
        onRenew={(a) => setDialogFor(a)}
        onEnd={(a) => {
          setEndTarget(a)
          setEndReason("")
          setEndError(null)
        }}
      />

      <Dialog open={Boolean(endTarget)} onOpenChange={(o) => !o && setEndTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("end.title", { number: displayAgreementNumber(endTarget?.docNumber, locale) })}</DialogTitle>
            <DialogDescription>{t("end.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="agr-end-reason" className="text-sm font-medium">
              {t("endReason")}
            </label>
            <Textarea id="agr-end-reason" rows={2} value={endReason} onChange={(e) => setEndReason(e.target.value)} />
            {endError && <p className="text-sm font-bold text-destructive">{endError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEndTarget(null)} disabled={ending}>
              {t("dialog.cancel")}
            </Button>
            <Button variant="destructive" onClick={endIt} disabled={!endReason.trim() || ending}>
              {ending && <Loader2 className="me-1.5 animate-spin" size={14} aria-hidden="true" />}
              {t("agreements.end")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AgreementDialog
        open={dialogFor !== undefined}
        onOpenChange={(o) => !o && setDialogFor(undefined)}
        actor={actor}
        orgId={orgId}
        locale={locale}
        agreement={dialogFor}
        suppliers={suppliers}
        knownMaterials={knownMaterials}
        ownerHasTeam={ownerHasTeam}
      />
    </div>
  )
}
