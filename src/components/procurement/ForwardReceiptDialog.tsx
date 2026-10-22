"use client"

// «حوّل الإشعار إلى المستلم» (Procurement 1.5, PUR-06): two ways, as the receiver is.
// · A TEAM MEMBER gets it in his own account — «مهامي» and his module — and confirms
//   signed in, with no code. The place's receivers come first (from the register), then
//   the rest of the team; the company itself is never listed as a member. Forwarding to
//   whoever prepared the order flags the receipt (the owner excepted — a company of one).
// · SOMEONE WITH NO ACCOUNT gets a link and a code to his mobile, good for 3 days;
//   Procurement copies the link or sends it by WhatsApp.
// Forwarding again replaces the earlier link. A note rides to the receiver.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, ChevronDown, Copy, Loader2, MessageCircle, Send, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { useProcReceivers } from "@/hooks/useProcReceivers"
import { displayNoticeNumber, displayPoNumber } from "@/lib/procurement/format"
import type { DeskDelivery } from "@/lib/procurement/receipt-desk"
import { receiversForPlace } from "@/lib/procurement/receivers"
import type { PurchaseOrder } from "@/lib/procurement/types"
import { cn } from "@/lib/utils"

type Mode = "member" | "person"

interface MemberChoice {
  userId: string
  name: string
  title: string
  atPlace: boolean
  preparedOrder: boolean
}

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
  /** Where this delivery would land, so the register offers the people named for that place first. */
  placeWarehouseId: string | null
  placeName: string
}) {
  const t = useTranslations("Portal.ProcReceipts")
  const tRcv = useTranslations("Portal.ProcReceivers")
  const tp = useTranslations("Portal.Procurement")
  const locale = useLocale()
  const { user } = useUser()
  const { toast } = useToast()
  const { orgMembers } = useOrgMembers(orgId)
  const { receivers } = useProcReceivers(orgId)
  const supplierName = delivery.supplierName || po?.supplierName || ""
  const choices = receiversForPlace(receivers, placeWarehouseId)
  const day = (delivery.deliveryDate || "").slice(0, 10)

  // Members: the place's receivers who have an account first, then everyone else on the team.
  const memberName = (id: string, fallback: string) => {
    const m = orgMembers.find((x) => x.id === id)
    return (m?.name as string) || (m?.email as string) || fallback
  }
  const atPlaceMembers: MemberChoice[] = choices
    .filter((c) => c.userId && c.atThisPlace)
    .map((c) => ({ userId: c.userId as string, name: c.name || memberName(c.userId as string, ""), title: c.title, atPlace: true, preparedOrder: po?.preparedById === c.userId }))
  const listed = new Set(atPlaceMembers.map((m) => m.userId))
  const otherMembers: MemberChoice[] = orgMembers
    .filter((m) => !listed.has(m.id))
    .map((m) => {
      const isOwner = m.id === orgId || m.organizationRole === "owner"
      const own = (m.name as string) || (m.email as string) || ""
      // The company is not a member: its owner is listed as the person he is.
      return { userId: m.id, name: isOwner ? t("forward.ownerName", { name: own }) : own, title: choices.find((c) => c.userId === m.id)?.title || "", atPlace: false, preparedOrder: po?.preparedById === m.id }
    })
  const people = choices.filter((c) => !c.userId)

  const [mode, setMode] = useState<Mode>("member")
  const [userId, setUserId] = useState("")
  const [showOthers, setShowOthers] = useState(atPlaceMembers.length === 0)
  const [personId, setPersonId] = useState("")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; phoneMasked: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const pickedMember = [...atPlaceMembers, ...otherMembers].find((m) => m.userId === userId) || null
  const pickedPerson = people.find((p) => p.id === personId) || null
  // The owner receiving his own order is a company of one, not an exception.
  const selfFlag = pickedMember?.preparedOrder && pickedMember.userId !== orgId
  const ready = mode === "member" ? Boolean(pickedMember) : Boolean(pickedPerson) || (name.trim().length >= 2 && phone.trim().length >= 5)

  const close = (o: boolean) => {
    if (!o) {
      setResult(null)
      setError(null)
      setCopied(false)
      setUserId("")
      setPersonId("")
      setNote("")
    }
    onOpenChange(o)
  }

  const submit = async () => {
    if (!user || !ready) return
    setBusy(true)
    setError(null)
    try {
      const receiver =
        mode === "member" && pickedMember
          ? { kind: "user", userId: pickedMember.userId }
          : pickedPerson
            ? { kind: "person", name: pickedPerson.name, phone: pickedPerson.phone }
            : { kind: "person", name: name.trim(), phone: phone.trim() }
      const res = await fetch("/api/receipt-links", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ deliveryId: delivery.id, receiver, note: note.trim() || null }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.code === "NO_PHONE" ? t("forward.errNoPhone") : body?.code === "ALREADY_RECEIVED" ? t("forward.errReceived") : body?.code === "NOT_A_MEMBER" ? t("forward.errNotMember") : t("forward.errGeneric"))
        return
      }
      if (mode === "member" && pickedMember) {
        toast({ title: t("forward.toMemberDone", { name: pickedMember.name }) })
        close(false)
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
  // WhatsApp's own share screen: Procurement picks the contact there.
  const whatsappHref = result ? `https://wa.me/?text=${encodeURIComponent(t("forward.shareText", { supplier: supplierName, url: result.url }))}` : "#"

  const memberRow = (m: MemberChoice) => (
    <li key={m.userId}>
      <button
        type="button"
        aria-pressed={userId === m.userId}
        onClick={() => setUserId(m.userId)}
        className={cn("w-full rounded-lg border p-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", userId === m.userId ? "border-module bg-module/5" : "border-border hover:bg-muted")}
      >
        <span className="flex flex-wrap items-baseline gap-x-2">
          <b className="text-sm" dir="auto">
            {m.name}
          </b>
          {m.title && <span className="text-xs text-muted-foreground" dir="auto">{m.title}</span>}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {m.atPlace ? t("forward.atPlaceHasAccount", { place: placeName }) : t("forward.hasAccount")}
          {m.preparedOrder && m.userId !== orgId && <span className="ms-1 font-semibold text-amber-700">· {t("forward.preparedIt")}</span>}
        </span>
      </button>
    </li>
  )

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent dir={locale === "ar" ? "rtl" : "ltr"} className="max-h-[90vh] max-w-md overflow-y-auto">
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
                  <span className="font-medium text-muted-foreground">
                    {" "}
                    · <bdi>{displayNoticeNumber(noticeNumber, locale)}</bdi>
                  </span>
                ) : (
                  po && <span className="font-medium text-muted-foreground"> · {displayPoNumber(po.docNumber, locale)}</span>
                )}
              </p>
              <p className="text-muted-foreground" dir="auto">
                {delivery.rfqTitle || po?.rfqTitle || "—"}
                {day && <> — {t("forward.arrives", { date: day })}</>}
                {delivery.notes && <> · {delivery.notes}</>}
              </p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">{t("forward.place")}</dt>
                <dd dir="auto">{placeName || "—"}</dd>
                {po && (
                  <>
                    <dt className="text-muted-foreground">{tp("doc.PO")}</dt>
                    <dd dir="auto">{t("forward.orderOwner", { number: displayPoNumber(po.docNumber, locale), name: po.preparedByName })}</dd>
                  </>
                )}
              </dl>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("forward.title")}>
              {(["member", "person"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={cn("rounded-lg border p-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", mode === m ? "border-module bg-module/5" : "hover:bg-muted")}
                >
                  <b className="block text-sm">{m === "member" ? t("forward.toMember") : t("forward.toPerson")}</b>
                  <span className="text-[11px] text-muted-foreground">{m === "member" ? t("forward.memberHint") : t("forward.personHint")}</span>
                </button>
              ))}
            </div>

            {mode === "member" ? (
              <div className="space-y-2">
                {atPlaceMembers.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-muted-foreground">{t("forward.placeReceiversOf", { place: placeName || "—" })}</p>
                    <ul className="space-y-1.5">{atPlaceMembers.map(memberRow)}</ul>
                  </>
                )}
                <button type="button" onClick={() => setShowOthers(!showOthers)} aria-expanded={showOthers} className="flex w-full items-center justify-between text-xs font-semibold text-muted-foreground">
                  {t("forward.otherMembers")}
                  <ChevronDown size={14} className={cn("transition-transform", showOthers && "rotate-180")} aria-hidden="true" />
                </button>
                {showOthers && <ul className="space-y-1.5">{otherMembers.map(memberRow)}</ul>}
                {selfFlag && (
                  <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <TriangleAlert size={13} className="mt-0.5 shrink-0" aria-hidden="true" /> {t("forward.selfWarning")}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {people.length > 0 && (
                  <ul className="space-y-1.5">
                    {people.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          aria-pressed={personId === c.id}
                          onClick={() => setPersonId(personId === c.id ? "" : c.id)}
                          className={cn("w-full rounded-lg border p-2.5 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", personId === c.id ? "border-module bg-module/5" : "border-border hover:bg-muted")}
                        >
                          <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                            <b className="text-sm" dir="auto">{c.name}</b>
                            <span className="text-xs tabular-nums text-muted-foreground" dir="ltr">{c.phone}</span>
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground" dir="auto">
                            {c.title} · {c.atThisPlace ? tRcv("forward.atThisPlace") : tRcv("forward.elsewhere")}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!pickedPerson && (
                  <div className="grid gap-3 sm:grid-cols-2">
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
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="fw-note" className="text-xs">{t("forward.noteToReceiver")}</Label>
              <Textarea id="fw-note" rows={2} maxLength={500} dir="auto" placeholder={t("forward.notePlaceholder")} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          </div>
        )}

        {!result && (
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={busy}>
              {t("forward.cancel")}
            </Button>
            <Button type="button" className="gap-1.5" disabled={busy || !ready} onClick={submit}>
              {busy ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
              {mode === "member" && pickedMember ? t("forward.toMemberNamed", { name: pickedMember.name }) : t("forward.sendLink")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
