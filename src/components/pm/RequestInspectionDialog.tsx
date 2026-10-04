"use client"

// Inspection request (form 18, WIR-01 — the prototype's formWir): the item
// (those that cannot be measured without a passed inspection first), what is
// to be inspected and where, the requested day, who inspects, and the
// readiness documents. An open request on the same item is flagged, not refused.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import type { PmAttachment } from "@/lib/pm/attachments"
import { todayDay } from "@/lib/pm/format"
import { requestBlocks, WIR_PARTIES, wirNo, type PmInspection, type WirParty } from "@/lib/pm/inspection"
import { PmInspectionError, requestInspection, type InspectionActor } from "@/lib/pm/inspection-writes"
import { addDays } from "@/lib/pm/programme"
import { PmFilesField } from "./PmAttachments"
import type { SheetItem } from "./WriteSheetDialog"
import type { PmUnit } from "@/lib/pm/units"
import { UnitField } from "./UnitField"

export function RequestInspectionDialog({
  open,
  onOpenChange,
  projectId,
  orgId,
  access,
  actor,
  items,
  inspections = [],
  units = [],
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  orgId?: string | null
  access: PmAccess
  actor: InspectionActor
  items: SheetItem[]
  inspections?: PmInspection[]
  /** The project's delivery units, when the section is on. */
  units?: PmUnit[]
  onSaved?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [itemId, setItemId] = useState("")
  const [location, setLocation] = useState("")
  const [unit, setUnit] = useState("")
  const [party, setParty] = useState<WirParty | null>("consultant")
  const [partyText, setPartyText] = useState("")
  const [on, setOn] = useState(addDays(todayDay(), 1))
  const [files, setFiles] = useState<PmAttachment[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setItemId("")
      setLocation("")
      setUnit("")
      setParty("consultant")
      setPartyText("")
      setOn(addDays(todayDay(), 1))
      setFiles([])
    }
  }, [open])

  const blocks = requestBlocks({ archived: access.ctx.archived, itemId: itemId || null, location, on: on || null, party, partyText })
  const chosen = items.find((i) => i.id === itemId)
  const dup = inspections.find((w) => w.itemId === itemId && w.status === "open")
  const open_ = items.filter((i) => i.executed < i.quantity - 0.001)

  const save = async () => {
    if (!firestore || blocks.length || !party) return
    setBusy(true)
    try {
      const seq = await requestInspection(firestore, access.ctx, projectId, actor, { itemId, location, unit, party, partyText, on, files })
      toast({ title: t("wir.requested", { no: wirNo(seq) }) })
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      console.error(err)
      const msg = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmInspectionError && err.blocks[0] ? `wir.block.${err.blocks[0]}` : "error.save"
      toast({ title: t(msg), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("wir.new")}</DialogTitle>
          <DialogDescription>{t("wir.new_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wir-item">{t("wir.item")}</Label>
            <SearchableSelect
              id="wir-item"
              value={itemId}
              onChange={setItemId}
              options={[...open_]
                .sort((a, b) => Number(Boolean(b.gate?.pmInspect)) - Number(Boolean(a.gate?.pmInspect)))
                .map((i) => ({ value: i.id, label: `${i.code} — ${i.description}`, keywords: `${i.code} ${i.description}`, group: i.gate?.pmInspect ? t("wir.group_gated") : t("wir.group_other") }))}
              placeholder={t("wir.pick_item")}
              searchPlaceholder={t("meas.search")}
              noResultsText={t("wir.no_items")}
              disabled={busy}
            />
            {chosen?.gate?.pmInspect && <p className="text-[11px] text-muted-foreground">{t("wir.gated_hint")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wir-loc">{t("wir.what_where")}</Label>
            <Input id="wir-loc" value={location} placeholder={t("wir.what_where_ph")} onChange={(e) => setLocation(e.target.value)} disabled={busy} dir="auto" />
            <p className="text-[11px] text-muted-foreground">{t("wir.what_where_hint")}</p>
          </div>
          <UnitField id="wir-unit" units={units} value={unit} onChange={setUnit} disabled={busy} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wir-on">{t("wir.requested_on")}</Label>
              <Input id="wir-on" type="date" dir="ltr" value={on} onChange={(e) => setOn(e.target.value)} disabled={busy} />
              <p className="text-[11px] text-muted-foreground">{t("wir.requested_hint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wir-party">{t("wir.party_label")}</Label>
              <Select value={party ?? ""} onValueChange={(v) => setParty(v as WirParty)} disabled={busy}>
                <SelectTrigger id="wir-party">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WIR_PARTIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {t(`wir.party.${p}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {party === "other" && (
            <div className="space-y-1.5">
              <Label htmlFor="wir-party-text">{t("wir.party_text")}</Label>
              <Input id="wir-party-text" value={partyText} onChange={(e) => setPartyText(e.target.value)} disabled={busy} />
            </div>
          )}
          <PmFilesField orgId={orgId} folder={`projects/${projectId}/inspections`} value={files} onChange={setFiles} label={t("wir.files")} hint={t("wir.files_hint")} disabled={busy} />
          {dup && <Callout tone="warn">{t("wir.dup", { no: wirNo(dup.seq), where: dup.location })}</Callout>}
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`wir.block.${b}`))} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
            {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("wir.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
