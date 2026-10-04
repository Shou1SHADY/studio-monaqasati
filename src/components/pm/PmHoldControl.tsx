"use client"

// Postpone / resume a PM 1.0 project (live ⇄ hold). The day it stopped and the
// reason are kept, so the portfolio card and the `hold` decision can say how
// long it has been postponed and why. Approve only.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { pmDate, todayDay } from "@/lib/pm/format"
import { holdBlocks, holdProject, PmHoldError, resumeProject } from "@/lib/pm/hold-writes"
import { lifecycleOf } from "@/lib/pm/lifecycle"
import { useLocaleDir } from "./SupplyDialogs"

type HoldProject = { pm?: { lifecycle?: string | null; holdSince?: string | null; holdWhy?: string | null } | null; status?: string | null }

export function PmHoldControl({ projectId, project, access, actor }: { projectId: string; project: HoldProject; access: PmAccess; actor: { uid: string; name: string | null } }) {
  const t = useTranslations("Portal.PM")
  const { locale } = useLocaleDir()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [why, setWhy] = useState("")
  const [since, setSince] = useState(todayDay())
  const [busy, setBusy] = useState(false)
  const life = lifecycleOf(project)
  const can = !access.ctx.archived && access.allowed("project.edit")
  if (!can || (life !== "live" && life !== "hold")) return null
  const today = todayDay()
  const blocks = holdBlocks({ archived: access.ctx.archived, lifecycle: life, to: "hold", why, since, today })

  const run = async (fn: () => Promise<void>, ok: string) => {
    if (!firestore) return
    setBusy(true)
    try {
      await fn()
      toast({ title: ok })
      setOpen(false)
    } catch (err) {
      console.error(err)
      toast({ title: err instanceof PmAccessError ? t(`refused.${err.code}`) : err instanceof PmHoldError && err.blocks[0] ? t(`hold.block.${err.blocks[0]}`) : t("error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  if (life === "hold")
    return (
      <Button size="sm" variant="outline" disabled={busy} onClick={() => firestore && void run(() => resumeProject(firestore, access.ctx, projectId, actor), t("hold.resumed"))}>
        {busy ? <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" /> : <Play size={14} className="me-1.5" aria-hidden="true" />}
        {t("hold.resume")}
      </Button>
    )

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Pause size={14} className="me-1.5" aria-hidden="true" />
        {t("hold.hold")}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && setOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("hold.title")}</DialogTitle>
            <DialogDescription>{t("hold.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="hold-why">{t("hold.why")} *</Label>
              <Textarea id="hold-why" dir="auto" rows={3} value={why} onChange={(e) => setWhy(e.target.value)} placeholder={t("hold.why_ph")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hold-since">{t("hold.since")}</Label>
              <Input id="hold-since" type="date" dir="ltr" max={today} value={since} onChange={(e) => setSince(e.target.value)} />
            </div>
            <Callout tone="warn">{t("hold.note", { date: pmDate(since || today, locale) })}</Callout>
            <BlockingReasons title={t("cannot_save")} reasons={why ? blocks.filter((b) => b !== "archived").map((b) => t(`hold.block.${b}`)) : []} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button disabled={busy || blocks.length > 0} onClick={() => firestore && void run(() => holdProject(firestore, access.ctx, projectId, { why, since }), t("hold.held"))}>
              {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
              {t("hold.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
