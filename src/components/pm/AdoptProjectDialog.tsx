"use client"

// Bringing a project made before PM 1.0 into the module, as it stands: its
// executed quantities, claims and status carry over; nothing is rewritten. The
// owner appoints its project manager; everyone else is seated afterwards.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { adoptProject, PmAdoptError } from "@/lib/pm/adopt-writes"

export function AdoptProjectDialog({ open, onOpenChange, projectId, orgId, actor }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; orgId: string; actor: { uid: string; name: string | null } }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const { orgMembers } = useOrgMembers(orgId)
  const [manager, setManager] = useState(actor.uid)
  const [startOn, setStartOn] = useState("")
  const [days, setDays] = useState("")
  const [busy, setBusy] = useState(false)
  const nameOf = (id: string) => {
    const m = orgMembers.find((o) => o.id === id)
    return (m?.name as string | undefined) || (m?.email as string | undefined) || id
  }
  const valid = Boolean(manager) && days !== "" && Number.isInteger(Number(days)) && Number(days) >= 0

  const adopt = async () => {
    if (!firestore || !valid) return
    setBusy(true)
    try {
      const { projectNo } = await adoptProject(firestore, projectId, actor, { isOwner: true, managerId: manager, managerName: nameOf(manager), startOn: startOn || null, durationDays: Number(days) })
      toast({ title: t("adopt.done", { no: projectNo }) })
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAdoptError ? `adopt.err.${err.code}` : "error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("adopt.title")}</DialogTitle>
          <DialogDescription>{t("adopt.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("adopt.manager")}</Label>
            <SearchableSelect
              value={manager}
              onChange={setManager}
              options={orgMembers.map((m) => ({ value: m.id, label: nameOf(m.id) }))}
              placeholder={t("adopt.pick_manager")}
              searchPlaceholder={t("adopt.search")}
              noResultsText={t("adopt.nobody")}
              ariaLabel={t("adopt.manager")}
              disabled={busy}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="adopt-start">{t("adopt.start_on")}</Label>
              <Input id="adopt-start" type="date" dir="ltr" value={startOn} onChange={(e) => setStartOn(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adopt-days">{t("adopt.duration")}</Label>
              <Input id="adopt-days" dir="ltr" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} disabled={busy} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("adopt.team_note")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void adopt()} disabled={busy || !valid}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("adopt.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
