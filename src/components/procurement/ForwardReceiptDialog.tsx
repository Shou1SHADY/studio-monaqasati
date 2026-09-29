"use client"

// Procurement forwards a delivery to whoever will receive it (22 Sep review,
// prototype `fwd`): a team member, or a name and mobile number for someone
// with no account. The review says what is coming, where, who receives at that
// place and whose order it is; a note to the receiver rides on the link and is
// shown there as "Note from Procurement". The server makes a single-use link
// and texts the code to that mobile when the receiver asks for it; here,
// Procurement copies the link or sends it by WhatsApp. Forwarding again
// replaces the earlier link. Nothing forwards itself on a timer (S-14): the
// product runs no scheduler, so the desk flags the notice instead.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, Copy, Loader2, MessageCircle, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useUser } from "@/firebase"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { useProcReceivers } from "@/hooks/useProcReceivers"
import { displayNoticeNumber, displayPoNumber } from "@/lib/procurement/format"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"
import { receiversForPlace } from "@/lib/procurement/receivers"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { cn } from "@/lib/utils"

// The register first: a delivery goes to a PERSON AT A PLACE, and the register
// knows both. The other two modes stay for whoever is not in it yet.
type Mode = "register" | "user" | "person"

export function ForwardReceiptDialog({
  open,
  onOpenChange,
  delivery,
  po,
  orgId,
  placeWarehouseId,
  placeName,
  noticeNumber,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  delivery: DeskDelivery
  po: PurchaseOrder | null
  orgId: string
  /** Our number for this notice (`noticeNumberOf`), when it has one. */
  noticeNumber?: string | null
  /** Where this delivery would land (the project's warehouse, else the central
   * one, as `resolveLandingWarehouse` decides), so the register offers the
   * people named for that place first. */
  placeWarehouseId: string | null
  placeName: string
}) {
  const t = useTranslations("Portal.ProcReceipts")
  const tRcv = useTranslations("Portal.ProcReceivers")
  const tp = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const { user } = useUser()
  const { orgMembers } = useOrgMembers(orgId)
  const { receivers } = useProcReceivers(orgId)
  const deliveryId = delivery.id
  const supplierName = delivery.supplierName || po?.supplierName || ""
  const choices = receiversForPlace(receivers, placeWarehouseId)
  const atPlace = choices.filter((c) => c.atThisPlace)
  const lines = (delivery.lines || []).map((l) => `${l.noticeQuantity} ${l.unit} ${l.name}`)
  const day = (delivery.deliveryDate || "").slice(0, 10)

  const [mode, setMode] = useState<Mode>("register")
  const [receiverId, setReceiverId] = useState("")
  const [userId, setUserId] = useState("")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; phoneMasked: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const member = orgMembers.find((m) => m.id === userId)
  const memberPhone = (member?.phone as string | undefined) || ""
  const chosen = choices.find((c) => c.id === receiverId)
  // By link: someone with no account gets the link and a code; anyone with one is forwarded inside their module.
  const byLink = mode === "person" || (mode === "register" && Boolean(chosen) && !chosen?.userId)
  const inApp = mode === "register" && chosen?.userId ? chosen : mode === "user" && userId ? receivers.find((r) => r.userId === userId && r.active !== false) || null : null
  const inAppPhone = inApp ? inApp.phone || memberPhone || phone.trim() : ""
  const ready =
    mode === "register"
      ? Boolean(chosen)
      : mode === "user"
        ? Boolean(userId) && (Boolean(memberPhone) || phone.trim().length >= 5)
        : name.trim().length >= 2 && phone.trim().length >= 5

  const close = (o: boolean) => {
    if (!o) {
      setResult(null)
      setError(null)
      setCopied(false)
      setReceiverId("")
      setNote("")
    }
    onOpenChange(o)
  }

  const submit = async () => {
    if (!user || !ready) return
    setBusy(true)
    setError(null)
    try {
      const idToken = await user.getIdToken()
      // A register entry with an account forwards as that member; one without is
      // a name and a mobile, which is what the link and its code are for.
      const receiver =
        mode === "register" && chosen
          ? chosen.userId
            ? { kind: "user", userId: chosen.userId, phone: chosen.phone }
            : { kind: "person", name: chosen.name, phone: chosen.phone }
          : mode === "user"
            ? { kind: "user", userId, ...(phone.trim() ? { phone: phone.trim() } : {}) }
            : { kind: "person", name: name.trim(), phone: phone.trim() }
      const res = await fetch("/api/receipt-links", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ deliveryId, receiver, note: note.trim() || null }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.code === "NO_PHONE" ? t("forward.errNoPhone") : body?.code === "ALREADY_RECEIVED" ? t("forward.errReceived") : t("forward.errGeneric"))
        return
      }
      setResult({ url: body.data.url, phoneMasked: body.data.phoneMasked })
    } catch {
      setError(t("forward.errGeneric"))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!result) return
    await navigator.clipboard.writeText(result.url).catch(() => {})
    setCopied(true)
  }

  // WhatsApp's own share screen: Procurement picks the contact there. The
  // receiver's number is never put in the address.
  const whatsappHref = result ? `https://wa.me/?text=${encodeURIComponent(t("forward.shareText", { supplier: supplierName, url: result.url }))}` : "#"

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("forward.title")}</DialogTitle>
          <DialogDescription>{t("forward.desc")}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
              <Check size={16} aria-hidden="true" />
              {t("forward.ready", { phone: result.phoneMasked })}
            </p>
            <Input readOnly value={result.url} dir="ltr" className="h-10 text-xs" onFocus={(e) => e.currentTarget.select()} />
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" className="h-10 gap-1.5" onClick={copy}>
                {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {copied ? t("forward.copied") : t("forward.copy")}
              </Button>
              <Button asChild className="h-10 gap-1.5">
                <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
                  <MessageCircle size={14} aria-hidden="true" />
                  {t("forward.whatsapp")}
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("forward.howItWorks")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1 rounded-lg border bg-muted/20 p-3 text-xs">
              <p className="text-sm font-bold" dir="auto">
                {supplierName}
                {noticeNumber ? (
                  <span className="font-medium text-muted-foreground"> · <bdi>{displayNoticeNumber(noticeNumber, locale)}</bdi></span>
                ) : (
                  po && <span className="font-medium text-muted-foreground"> · {displayPoNumber(po.docNumber, locale)}</span>
                )}
              </p>
              <p className="text-muted-foreground" dir="auto">
                {lines.join(" · ") || delivery.rfqTitle || "—"}
                {day && <> — {t("forward.arrives", { date: day })}</>}
                {delivery.deliveryWindow && <> {tp(`deliveryWindow.${delivery.deliveryWindow}` as "deliveryWindow.morning")}</>}
                {delivery.deliveryPersonName && <> · {delivery.deliveryPersonName}</>}
              </p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">{t("forward.place")}</dt>
                <dd dir="auto">{placeName}</dd>
                <dt className="text-muted-foreground">{t("forward.placeReceivers")}</dt>
                <dd dir="auto">{atPlace.length ? atPlace.map((c) => `${c.name} — ${c.title}`).join("، ") : t("incoming.noReceiver")}</dd>
                {po && (
                  <>
                    <dt className="text-muted-foreground">{tp("doc.PO")}</dt>
                    <dd dir="auto">{t("forward.orderOwner", { number: displayPoNumber(po.docNumber, locale), name: po.preparedByName })}</dd>
                  </>
                )}
              </dl>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-lg border p-1" role="group" aria-label={t("forward.title")}>
              {(["register", "user", "person"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "min-h-9 rounded-md px-3 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    mode === m ? "bg-module text-module-foreground" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {m === "register" ? tRcv("forward.fromRegister") : m === "user" ? t("forward.toMember") : t("forward.toPerson")}
                </button>
              ))}
            </div>

            {mode === "register" ? (
              choices.length === 0 ? (
                <p className="text-xs text-muted-foreground">{tRcv("forward.noRegister")}</p>
              ) : (
                <ul className="space-y-1.5">
                  {choices.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        aria-pressed={receiverId === c.id}
                        onClick={() => setReceiverId(c.id)}
                        className={cn(
                          "w-full rounded-lg border p-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          receiverId === c.id ? "border-module bg-module/5" : "border-border hover:bg-muted"
                        )}
                      >
                        <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                          <b className="text-sm" dir="auto">{c.name}</b>
                          <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">{c.phone}</span>
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground" dir="auto">
                          {c.title}
                          {" · "}
                          {c.atThisPlace ? tRcv("forward.atThisPlace") : tRcv("forward.elsewhere")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : mode === "user" ? (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="fw-member" className="text-xs">{t("forward.member")}</Label>
                  <select
                    id="fw-member"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">{t("forward.pickMember")}</option>
                    {orgMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.email || m.id}
                      </option>
                    ))}
                  </select>
                </div>
                {userId && !memberPhone && (
                  <div className="space-y-1">
                    <Label htmlFor="fw-mphone" className="text-xs">{t("forward.memberNoPhone")}</Label>
                    <Input id="fw-mphone" inputMode="tel" dir="ltr" placeholder="05XXXXXXXX" className="h-10" value={phone} onChange={(e) => setPhone(e.target.value)} />
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="fw-name" className="text-xs">{t("forward.name")}</Label>
                  <Input id="fw-name" dir="auto" className="h-10" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="fw-phone" className="text-xs">{t("forward.phone")}</Label>
                  <Input id="fw-phone" inputMode="tel" dir="ltr" placeholder="05XXXXXXXX" className="h-10" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
              </div>
            )}
            {inApp && (
              <p className="text-xs text-module" dir="auto">
                {t("forward.reachesIn", { module: t(`module.${inApp.module}`), phone: inAppPhone })}
              </p>
            )}
            <div className="space-y-1">
              <Label htmlFor="fw-note" className="text-xs">{t("forward.noteToReceiver")}</Label>
              <Textarea id="fw-note" rows={2} maxLength={500} dir="auto" placeholder={t("forward.notePlaceholder")} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <ul className="space-y-1 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
              {[byLink ? t("forward.effectLink") : t("forward.effectMember"), t("forward.effectTrail"), t("forward.effectNoTimer")].map((x) => (
                <li key={x} className="flex gap-2">
                  <span aria-hidden="true">•</span>
                  <span>{x}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t("forward.codeNote")}</p>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          </div>
        )}

        {!result && (
          <DialogFooter>
            <Button type="button" className="gap-1.5" disabled={busy || !ready} onClick={submit}>
              {busy ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
              {byLink ? t("forward.sendLink") : t("forward.forwardMember")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
