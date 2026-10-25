"use client"

// PRJ-01 — the consultant and his representative in the project's details:
// name, mobile (05XXXXXXXX or +9665XXXXXXXX — anything else refused, here and
// at save), e-mail; each optional. The mobile is what the portal link goes to
// (CP-02). Saved on the server (`/api/pm-portal/consultant`): a new
// representative or mobile, or removing the consultant, revokes the link
// already sent (CP-03) — the dialog says so before saving.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/module-ui/Callout"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { saudiMobileE164 } from "@/lib/supplier-free/phone-auth"

export interface ConsultantDetails {
  consultant?: string | null
  consultantRep?: { name?: string | null; phone?: string | null; email?: string | null } | null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** "+966501234567" → "0501234567", the way people type it. */
const localPhone = (e164: string | null | undefined) => (e164 && e164.startsWith("+9665") ? `0${e164.slice(4)}` : (e164 ?? ""))

export function ConsultantRepDialog({
  open,
  onOpenChange,
  projectId,
  project,
  linkSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  project: ConsultantDetails
  /** A portal link is out: changing the representative or the mobile revokes it. */
  linkSent?: boolean
}) {
  const t = useTranslations("Portal.PM.info")
  const { user } = useUser()
  const { toast } = useToast()
  const [consultant, setConsultant] = useState("")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (!open) return
    setConsultant(project.consultant ?? "")
    setName(project.consultantRep?.name ?? "")
    setPhone(localPhone(project.consultantRep?.phone))
    setEmail(project.consultantRep?.email ?? "")
    setTried(false)
  }, [open, project.consultant, project.consultantRep?.name, project.consultantRep?.phone, project.consultantRep?.email])

  const phoneBad = phone.trim() !== "" && !saudiMobileE164(phone)
  const emailBad = email.trim() !== "" && !EMAIL.test(email.trim())
  const revokes =
    Boolean(linkSent) &&
    ((Boolean(project.consultant?.trim()) && !consultant.trim()) || (saudiMobileE164(phone) ?? null) !== (project.consultantRep?.phone ?? null) || (name.trim() || null) !== (project.consultantRep?.name?.trim() || null))

  const save = async () => {
    setTried(true)
    if (phoneBad || emailBad || !user) return
    setBusy(true)
    try {
      const res = await fetch("/api/pm-portal/consultant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ projectId, consultant: consultant.trim(), repName: name.trim(), repPhone: phone.trim(), repEmail: email.trim() }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        const code = body?.code as string | undefined
        toast({ title: t(code === "BAD_PHONE" ? "rep_bad_phone" : code === "BAD_EMAIL" ? "rep_bad_email" : code === "FORBIDDEN" || code === "PROJECT_CLOSED" ? "rep_forbidden" : "rep_error"), variant: "destructive" })
        return
      }
      toast({ title: t("saved"), description: body?.data?.revoked ? t("rep_revoked") : undefined })
      onOpenChange(false)
    } catch {
      toast({ title: t("rep_error"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("rep_title")}</DialogTitle>
          <DialogDescription>{t("rep_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cr-cons">{t("consultant")}</Label>
            <Input id="cr-cons" dir="auto" className="h-11" maxLength={200} value={consultant} placeholder={t("consultant_ph")} disabled={busy} onChange={(e) => setConsultant(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-name">{t("rep_name")}</Label>
            <Input id="cr-name" dir="auto" className="h-11" maxLength={120} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cr-phone">{t("rep_phone")}</Label>
              <Input id="cr-phone" dir="ltr" type="tel" inputMode="tel" autoComplete="off" placeholder="05XXXXXXXX" className="h-11" maxLength={30} value={phone} disabled={busy} onChange={(e) => setPhone(e.target.value)} aria-invalid={tried && phoneBad} />
              {tried && phoneBad ? (
                <p className="text-xs text-destructive" role="alert">
                  {t("rep_bad_phone")}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">{t("rep_phone_hint")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cr-email">{t("rep_email")}</Label>
              <Input id="cr-email" dir="ltr" type="email" inputMode="email" autoComplete="off" className="h-11" maxLength={160} value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} aria-invalid={tried && emailBad} />
              {tried && emailBad && (
                <p className="text-xs text-destructive" role="alert">
                  {t("rep_bad_email")}
                </p>
              )}
            </div>
          </div>
          {revokes && <Callout tone="warn">{t("rep_will_revoke")}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("rep_cancel")}
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy && <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
