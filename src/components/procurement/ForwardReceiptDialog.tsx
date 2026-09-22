"use client"

// Procurement forwards a delivery to whoever will receive it (22 Sep review):
// a team member, or a name and mobile number for someone with no account. The
// server makes a single-use link and texts the code to that mobile when the
// receiver asks for it; here, Procurement copies the link or sends it by
// WhatsApp. Forwarding again replaces the earlier link.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Check, Copy, Loader2, MessageCircle, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useUser } from "@/firebase"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { cn } from "@/lib/utils"

type Mode = "user" | "person"

export function ForwardReceiptDialog({
  open,
  onOpenChange,
  deliveryId,
  supplierName,
  orgId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  deliveryId: string
  supplierName: string
  orgId: string
}) {
  const t = useTranslations("Portal.ProcReceipts")
  const { user } = useUser()
  const { orgMembers } = useOrgMembers(orgId)
  const [mode, setMode] = useState<Mode>("user")
  const [userId, setUserId] = useState("")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ url: string; phoneMasked: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const member = orgMembers.find((m) => m.id === userId)
  const memberPhone = (member?.phone as string | undefined) || ""
  const ready = mode === "user" ? Boolean(userId) && (Boolean(memberPhone) || phone.trim().length >= 5) : name.trim().length >= 2 && phone.trim().length >= 5

  const close = (o: boolean) => {
    if (!o) {
      setResult(null)
      setError(null)
      setCopied(false)
    }
    onOpenChange(o)
  }

  const submit = async () => {
    if (!user || !ready) return
    setBusy(true)
    setError(null)
    try {
      const idToken = await user.getIdToken()
      const receiver = mode === "user" ? { kind: "user", userId, ...(phone.trim() ? { phone: phone.trim() } : {}) } : { kind: "person", name: name.trim(), phone: phone.trim() }
      const res = await fetch("/api/receipt-links", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ deliveryId, receiver }),
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
            <div className="grid grid-cols-2 gap-1 rounded-lg border p-1" role="group" aria-label={t("forward.title")}>
              {(["user", "person"] as const).map((m) => (
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
                  {m === "user" ? t("forward.toMember") : t("forward.toPerson")}
                </button>
              ))}
            </div>

            {mode === "user" ? (
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
            <p className="text-xs text-muted-foreground">{t("forward.codeNote")}</p>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          </div>
        )}

        {!result && (
          <DialogFooter>
            <Button type="button" className="gap-1.5" disabled={busy || !ready} onClick={submit}>
              {busy ? <Loader2 className="animate-spin" size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
              {t("forward.create")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
