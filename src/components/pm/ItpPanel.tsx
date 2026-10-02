"use client"

// Execution › Inspections & punch › Inspection & test plan (the prototype's
// qaPanel table): what must be tested on each item, at which stage, how often
// and who signs it — before the work is covered. "Done" is counted from the
// item's passed inspections; the shortfall is shown in amber.

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { Loader2, Plus, ShieldCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Panel } from "@/components/module-ui/Panel"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { PM_INSPECTIONS, WIR_PARTIES, type PmInspection, type WirParty } from "@/lib/pm/inspection"
import { itpBlocks, itpDone, itpGap, PM_ITP, type PmItpRow } from "@/lib/pm/itp"
import { addItpRow, PmItpError } from "@/lib/pm/itp-writes"

export function ItpPanel({ projectId, items, access, actor }: { projectId: string; items: Array<{ id: string; code: string; description: string }>; access: PmAccess; actor: { uid: string; name: string | null } }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { toast } = useToast()
  const [adding, setAdding] = useState(false)
  const [itemId, setItemId] = useState("")
  const [stage, setStage] = useState("")
  const [test, setTest] = useState("")
  const [freq, setFreq] = useState("")
  const [need, setNeed] = useState("1")
  const [party, setParty] = useState<WirParty>("consultant")
  const [partyText, setPartyText] = useState("")
  const [busy, setBusy] = useState(false)

  const rowsQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_ITP) : null), [firestore, projectId])
  const wirQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_INSPECTIONS) : null), [firestore, projectId])
  const { data } = useCollection(rowsQ)
  const { data: wirData } = useCollection(wirQ)
  const rows = useMemo(() => ((data ?? []) as unknown as PmItpRow[]).slice().sort((a, b) => a.seq - b.seq), [data])
  const inspections = (wirData ?? []) as unknown as PmInspection[]
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const canQa = !access.ctx.archived && access.allowed("qa.record")
  const needNum = Number(need)
  const blocks = itpBlocks({ archived: access.ctx.archived, itemId: itemId || null, stage, test, freq, need: needNum, party, partyText })
  const partyName = (r: PmItpRow) => (r.party === "other" ? t("amend.other_stated", { text: r.partyText ?? "" }) : t(`wir.party.${r.party}`))

  useEffect(() => {
    if (adding) {
      setItemId("")
      setStage("")
      setTest("")
      setFreq("")
      setNeed("1")
      setParty("consultant")
      setPartyText("")
    }
  }, [adding])

  const save = async () => {
    if (!firestore || blocks.length) return
    setBusy(true)
    try {
      await addItpRow(firestore, access.ctx, projectId, actor, { itemId, stage, test, freq, need: needNum, party, partyText })
      toast({ title: t("itp.saved") })
      setAdding(false)
    } catch (err) {
      console.error(err)
      toast({ title: t(err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmItpError && err.blocks[0] ? `itp.block.${err.blocks[0]}` : "error.save"), variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={t("itp.title")}
      icon={ShieldCheck}
      bodyClassName="p-0"
      actions={
        canQa && items.length > 0 ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus size={15} className="me-1.5" aria-hidden="true" />
            {t("itp.add")}
          </Button>
        ) : null
      }
    >
      <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("itp.sub")}</p>
      {rows.length === 0 ? (
        <p className="px-4 py-5 text-center text-sm text-muted-foreground">{t("itp.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-start font-semibold">{t("itp.col_item")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("itp.col_stage")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("itp.col_test")}</th>
                <th className="px-3 py-2 text-start font-semibold">{t("itp.col_freq")}</th>
                <th className="px-4 py-2 text-center font-semibold">{t("itp.col_done")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const i = byId.get(r.itemId)
                const done = itpDone(r.itemId, inspections)
                const gap = itpGap(r.need, done)
                return (
                  <tr key={r.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold" dir="auto">
                        {i?.description || r.code}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        <span dir="ltr">{i?.code ?? r.code}</span> · {partyName(r)}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-xs" dir="auto">
                      {r.stage}
                    </td>
                    <td className="px-3 py-2.5 text-xs" dir="auto">
                      {r.test}
                    </td>
                    <td className="px-3 py-2.5 text-xs" dir="auto">
                      {r.freq}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span dir="ltr" className="tabular-nums">
                        <b>{done}</b>
                        <span className="text-xs text-muted-foreground">/{r.need}</span>
                      </span>
                      {gap > 0 && <p className="text-xs font-bold text-warning">{t("itp.short", { count: gap })}</p>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("itp.add")}</DialogTitle>
            <DialogDescription>{t("itp.add_desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t("itp.col_item")}</Label>
              <SearchableSelect
                value={itemId}
                onChange={setItemId}
                options={items.map((i) => ({ value: i.id, label: `${i.code} — ${i.description}`, keywords: i.code }))}
                placeholder={t("wir.pick_item")}
                searchPlaceholder={t("meas.search")}
                noResultsText={t("wir.no_items")}
                ariaLabel={t("itp.col_item")}
                disabled={busy}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="itp-stage">{t("itp.col_stage")}</Label>
                <Input id="itp-stage" value={stage} placeholder={t("itp.stage_ph")} onChange={(e) => setStage(e.target.value)} disabled={busy} dir="auto" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="itp-freq">{t("itp.col_freq")}</Label>
                <Input id="itp-freq" value={freq} placeholder={t("itp.freq_ph")} onChange={(e) => setFreq(e.target.value)} disabled={busy} dir="auto" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="itp-test">{t("itp.col_test")}</Label>
              <Input id="itp-test" value={test} placeholder={t("itp.test_ph")} onChange={(e) => setTest(e.target.value)} disabled={busy} dir="auto" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="itp-need">{t("itp.need")}</Label>
                <Input id="itp-need" type="number" min="1" step="1" dir="ltr" value={need} onChange={(e) => setNeed(e.target.value)} disabled={busy} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="itp-party">{t("itp.signs")}</Label>
                <Select value={party} onValueChange={(v) => setParty(v as WirParty)} disabled={busy}>
                  <SelectTrigger id="itp-party">
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
                <Label htmlFor="itp-party-text">{t("wir.party_text")}</Label>
                <Input id="itp-party-text" value={partyText} onChange={(e) => setPartyText(e.target.value)} disabled={busy} />
              </div>
            )}
            <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`itp.block.${b}`))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdding(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={busy || blocks.length > 0}>
              {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
              {t("itp.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  )
}
