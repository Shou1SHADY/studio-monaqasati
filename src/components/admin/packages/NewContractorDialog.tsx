"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, UserPlus } from "lucide-react"
import { useRouter } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Callout } from "@/components/module-ui/Callout"
import { useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { BASE_PACKAGE, CONNECTORS, type Connector, type PackageFlags } from "@/lib/procurement/package"
import { UnitIcon } from "./PackageIcons"

/** «مقاول جديد»: starts on the base package; the connectors ticked here are opened with the account, the rest the admin sets on the contractor's page. */
export function NewContractorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("Portal.AdminPackages.new")
  const tp = useTranslations("Portal.ProcPackage")
  const { user } = useUser()
  const { toast } = useToast()
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [pkg, setPkg] = useState<PackageFlags>(BASE_PACKAGE)
  const [busy, setBusy] = useState(false)
  const ready = name.trim() !== "" && email.trim() !== ""

  const submit = async () => {
    if (!user || !ready) return
    setBusy(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name, email, phone, role: "Contractor", connectors: pkg }),
      })
      const body = (await res.json().catch(() => null)) as { success?: boolean; code?: string; data?: { uid?: string } } | null
      if (!res.ok || !body?.success) {
        toast({ title: t(body?.code === "EMAIL_IN_USE" ? "email_in_use" : "failed"), variant: "destructive" })
        return
      }
      toast({ title: t("created"), description: t("created_desc") })
      onOpenChange(false)
      if (body.data?.uid) router.push(`/admin/contractors/${body.data.uid}`)
    } catch {
      toast({ title: t("failed"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-2">
            <Label htmlFor="nc-name" className="font-bold">
              {t("name")}
            </Label>
            <Input id="nc-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nc-email" className="font-bold">
                {t("email")}
              </Label>
              <Input id="nc-email" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="nc-phone" className="font-bold">
                {t("phone")}
              </Label>
              <Input id="nc-phone" type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-bold">{t("connectors")}</legend>
            {CONNECTORS.map((c: Connector) => (
              <label key={c} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm font-bold">
                <span className="flex items-center gap-2">
                  <UnitIcon unit={c} on={pkg[c]} className="h-6 w-6" />
                  {tp(`conn.${c}.name`)}
                </span>
                <Switch checked={pkg[c]} onCheckedChange={(on) => setPkg((p) => ({ ...p, [c]: on }))} aria-label={tp(`conn.${c}.name`)} disabled={busy} />
              </label>
            ))}
          </fieldset>
          <Callout tone="info">{t("note")}</Callout>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !ready} className="gap-2">
            {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <UserPlus size={16} aria-hidden="true" />}
            {t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
