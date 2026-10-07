"use client"

// Admin → a company's components. Project Management, HR and Manufacturing can be switched off for one
// company; everything else is core and stays on. The company's menu, tiles and pages follow at once.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { doc } from "firebase/firestore"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Callout } from "@/components/module-ui/Callout"
import { useDoc, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { COMPANY_MODULES, offSet, optionalFor, type ModulePortal, type OptionalModule } from "@/lib/company-modules"
import { setCompanyModules } from "@/lib/company-modules-writes"

const LABEL: Record<OptionalModule, { name: string; desc: string }> = {
  "project-management": { name: "component_project_management", desc: "component_project_management_desc" },
  hr: { name: "component_hr", desc: "component_hr_desc" },
  manufacturing: { name: "component_manufacturing", desc: "component_manufacturing_desc" },
}

export function CompanyModulesDialog({ orgId, companyName, portal, onClose }: { orgId: string; companyName: string; portal: ModulePortal; onClose: () => void }) {
  const t = useTranslations("Portal.AdminModules")
  const tSide = useTranslations("Portal.Sidebar")
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()
  const ref = useMemoFirebase(() => (firestore ? doc(firestore, COMPANY_MODULES, orgId) : null), [firestore, orgId])
  const { data, isLoading } = useDoc(ref)
  const [off, setOff] = useState<ReadonlySet<OptionalModule>>(new Set())
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (isLoading || ready) return
    setOff(offSet(data as { off?: unknown } | null, portal))
    setReady(true)
  }, [isLoading, data, portal, ready])

  const toggle = (id: OptionalModule, on: boolean) =>
    setOff((prev) => {
      const next = new Set(prev)
      if (on) next.delete(id)
      else next.add(id)
      return next
    })

  const save = async () => {
    if (!firestore || !user) return
    setBusy(true)
    try {
      await setCompanyModules(firestore, orgId, [...off], { uid: user.uid, name: user.displayName || user.email || "" })
      toast({ title: t("saved") })
      onClose()
    } catch (err) {
      console.error(err)
      toast({ title: t("save_failed"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription dir="auto">{companyName}</DialogDescription>
        </DialogHeader>
        {!ready ? (
          <div className="flex justify-center p-6">
            <Loader2 className="animate-spin text-primary" size={22} aria-hidden="true" />
          </div>
        ) : (
          <div className="space-y-3">
            <ul className="divide-y rounded-lg border">
              {optionalFor(portal).map((id) => {
                const on = !off.has(id)
                return (
                  <li key={id} className="flex items-center justify-between gap-3 px-3 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold">{tSide(LABEL[id].name)}</p>
                      <p className="text-xs text-muted-foreground">{tSide(LABEL[id].desc)}</p>
                    </div>
                    <Switch checked={on} onCheckedChange={(v) => toggle(id, v)} aria-label={tSide(LABEL[id].name)} disabled={busy} />
                  </li>
                )
              })}
            </ul>
            <Callout tone="info">{t("note")}</Callout>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={!ready || busy}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
