"use client"

// Inspection request (form 18, WIR-01): item · location · party · day.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { todayDay } from "@/lib/pm/format"
import { requestBlocks, WIR_PARTIES, wirNo, type WirParty } from "@/lib/pm/inspection"
import { PmInspectionError, requestInspection, type InspectionActor } from "@/lib/pm/inspection-writes"
import type { SheetItem } from "./WriteSheetDialog"

export function RequestInspectionDialog({
  open,
  onOpenChange,
  projectId,
  access,
  actor,
  items,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  access: PmAccess
  actor: InspectionActor
  items: SheetItem[]
  onSaved?: () => void
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [itemId, setItemId] = useState("")
  const [location, setLocation] = useState("")
  const [party, setParty] = useState<WirParty | null>("consultant")
  const [partyText, setPartyText] = useState("")
  const [on, setOn] = useState(todayDay())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setItemId("")
      setLocation("")
      setParty("consultant")
      setPartyText("")
      setOn(todayDay())
    }
  }, [open])

  const blocks = requestBlocks({ archived: access.ctx.archived, itemId: itemId || null, location, on: on || null, party, partyText })

  const save = async () => {
    if (!firestore || blocks.length || !party) return
    setBusy(true)
    try {
      const seq = await requestInspection(firestore, access.ctx, projectId, actor, { itemId, location, party, partyText, on })
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
      <DialogContent className="max-w-lg">
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
              options={items.map((i) => ({ value: i.id, label: `${i.code} — ${i.description}`, keywords: `${i.code} ${i.description}` }))}
              placeholder={t("wir.pick_item")}
              searchPlaceholder={t("meas.search")}
              noResultsText={t("wir.no_items")}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wir-loc">{t("wir.location")}</Label>
            <Input id="wir-loc" value={location} onChange={(e) => setLocation(e.target.value)} disabled={busy} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
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
            <div className="space-y-1.5">
              <Label htmlFor="wir-on">{t("wir.on")}</Label>
              <Input id="wir-on" type="date" dir="ltr" value={on} onChange={(e) => setOn(e.target.value)} disabled={busy} />
            </div>
          </div>
          {party === "other" && (
            <div className="space-y-1.5">
              <Label htmlFor="wir-party-text">{t("wir.party_text")}</Label>
              <Input id="wir-party-text" value={partyText} onChange={(e) => setPartyText(e.target.value)} disabled={busy} />
            </div>
          )}
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
