"use client"

// Subcontractor custody on the project store ledger (prototype formPmv «اصرف
// لمقاول باطن», formCNT, formRCV): issuing a material into his custody, taking
// it back, counting what he holds, and recovering the value of his waste. The
// material stays ours — these move custody, never the store balance. Used from
// Execution › Subcontractors and from a material's drawer in the project store.

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { CheckCheck, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import type { PmAttachment } from "@/lib/pm/attachments"
import { PmAccessError } from "@/lib/pm/access"
import { pmMoney, todayDay } from "@/lib/pm/format"
import type { PmStoreLine, StoreItem } from "@/lib/pm/store"
import { engineerHold, ledgerCustody, recoveryAmount, recoveryBlocks, subIssueLeft, subStoreBlocks, type PmSubcontract } from "@/lib/pm/subcontract"
import { PmSubError, recordStoreRecovery, recordSubStoreMove, type SubActor } from "@/lib/pm/subcontract-writes"
import { ChoiceChips, FormHint } from "./ContractBits"
import { PmFilesField } from "./PmAttachments"

const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s))
const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US")

type Contracts = Array<Pick<PmSubcontract, "partyKey" | "party" | "lines">>

/** The subcontractors of the project, once each (a party may hold several contracts). */
export function projectSubs(contracts: Contracts): Array<{ key: string; name: string }> {
  const seen = new Map<string, string>()
  for (const c of contracts) if (!seen.has(c.partyKey)) seen.set(c.partyKey, c.party.name)
  return [...seen.entries()].map(([key, name]) => ({ key, name }))
}

function useSubRun() {
  const t = useTranslations("Portal.PM")
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<string>) => {
    setBusy(true)
    try {
      toast({ title: await fn() })
      return true
    } catch (err) {
      console.error(err)
      const title = err instanceof PmAccessError ? t(`refused.${err.code}`) : err instanceof PmSubError ? (err.blocks[0] ? t(`subs.block.${err.blocks[0]}`) : t(`subs.err.${err.code}`)) : t("error.save")
      toast({ title, variant: "destructive" })
      return false
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

function Footer({ onClose, busy, disabled, onSave, label, tone }: { onClose: () => void; busy: boolean; disabled: boolean; onSave: () => void; label: string; tone?: "destructive" }) {
  const t = useTranslations("Portal.PM")
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onClose} disabled={busy}>
        {t("cancel")}
      </Button>
      <Button variant={tone ?? "default"} disabled={busy || disabled} onClick={onSave}>
        {busy ? <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" /> : <CheckCheck size={16} className="me-2" aria-hidden="true" />}
        {label}
      </Button>
    </DialogFooter>
  )
}

export function SubStoreMoveDialog({
  projectId,
  orgId,
  kind,
  lines,
  items,
  contracts,
  storeId,
  partyKey,
  access,
  actor,
  onClose,
}: {
  projectId: string
  orgId?: string | null
  kind: "iss" | "back" | "cnt"
  lines: PmStoreLine[]
  items: StoreItem[]
  contracts: Contracts
  /** The material; absent = chosen here (an issue from the subcontractors screen). */
  storeId?: string | null
  partyKey?: string | null
  access: PmAccess
  actor: SubActor
  onClose: () => void
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { busy, run } = useSubRun()
  const subs = projectSubs(contracts)
  const today = todayDay()
  const choices = useMemo(() => lines.filter((x) => x.id === storeId || engineerHold(x, items, contracts) > 0.005), [lines, items, contracts, storeId])
  const [sid, setSid] = useState<string | null>(storeId ?? (choices.length === 1 ? choices[0].id : null))
  const [sub, setSub] = useState<string | null>(partyKey ?? subs[0]?.key ?? null)
  const [q, setQ] = useState("")
  const [day, setDay] = useState(today)
  const [note, setNote] = useState("")
  const [files, setFiles] = useState<PmAttachment[]>([])
  const x = lines.find((l) => l.id === sid) ?? null
  const qn = num(q)
  const c = x && sub ? ledgerCustody(x, items, contracts, sub) : null
  const hold = x ? engineerHold(x, items, contracts) : 0
  const left = c ? subIssueLeft(c) : 0
  const over = kind === "iss" && c && Number.isFinite(qn) ? Math.max(0, Math.round((qn - left) * 1000) / 1000) : 0
  const gap = kind === "cnt" && c && Number.isFinite(qn) ? Math.round((c.book - qn) * 100) / 100 : null
  const blocks = [
    ...(x ? [] : ["no_material"]),
    ...subStoreBlocks({ archived: access.ctx.archived, t: kind, hasSub: Boolean(sub), q: qn, hold, custody: c ?? { issued: 0, cap: 0 }, note, day, today }),
  ]
  const subName = subs.find((s) => s.key === sub)?.name ?? ""

  const save = async () => {
    if (!firestore || !x || !sub) return
    const ok = await run(async () => {
      const out = await recordSubStoreMove(firestore, access.ctx, projectId, actor, x.id, { t: kind, partyKey: sub, q: qn, day, note: note.trim() || null, files })
      if (kind === "iss") return out.over > 0 ? t("subs.led.issued_over", { q: qty(qn), unit: x.unit, name: subName, over: qty(out.over) }) : t("subs.led.issued", { q: qty(qn), unit: x.unit, name: subName })
      if (kind === "cnt") return out.gap !== null && out.gap > 0.005 ? t("subs.led.counted_gap", { q: qty(out.gap), unit: x.unit, name: subName }) : t("subs.led.counted_ok")
      return t("subs.recon.saved_back")
    })
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{kind === "iss" ? t("subs.recon.issue") : t(`subs.recon.move_title_${kind}`)}</DialogTitle>
          <DialogDescription dir="auto">
            {x ? `${x.name} — ${t("subs.led.on_project", { q: qty(Math.max(0, hold)), unit: x.unit })}` : t("subs.led.pick_material_desc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!storeId && (
            <div className="space-y-1.5">
              <Label>{t("subs.recon.material")} *</Label>
              {choices.length ? (
                <ChoiceChips label={t("subs.recon.material")} options={choices.map((l) => ({ id: l.id, label: `${l.name} · ${qty(engineerHold(l, items, contracts))} ${l.unit}` }))} value={sid} onChange={setSid} />
              ) : (
                <Callout tone="info">{t("subs.led.no_material")}</Callout>
              )}
            </div>
          )}
          {!partyKey && (
            <div className="space-y-1.5">
              <Label>{t("subs.led.to_sub")} *</Label>
              <ChoiceChips label={t("subs.led.to_sub")} options={subs.map((s) => ({ id: s.key, label: s.name }))} value={sub} onChange={setSub} />
            </div>
          )}
          {x && c && kind === "iss" && (
            <div className="rounded-xl border px-3">
              <KeyValueRow label={t("subs.led.theo")} value={`${qty(c.theoretical)} ${x.unit}`} ltr />
              <KeyValueRow label={t("subs.led.allow")} value={qty(c.allowed)} ltr />
              <KeyValueRow label={t("subs.led.issued_so_far")} value={qty(c.issued)} ltr />
              <KeyValueRow label={t("subs.led.may_draw")} value={<span className={left <= 0 ? "text-destructive" : undefined}>{qty(Math.max(0, left))}</span>} ltr strong />
            </div>
          )}
          {x && c && kind === "cnt" && (
            <>
              <Callout tone="info">{t("subs.recon.count_note")}</Callout>
              <div className="rounded-xl border px-3">
                <KeyValueRow label={t("subs.recon.col.issued")} value={`${qty(c.issued)} ${x.unit}`} ltr />
                <KeyValueRow label={t("subs.recon.earned")} value={qty(c.cap)} ltr />
                <KeyValueRow label={t("subs.recon.should_hold")} value={qty(c.book)} ltr strong />
              </div>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sm-q">
                {t(`subs.recon.move_qty_${kind}`)}
                {x ? ` (${x.unit})` : ""} *
              </Label>
              <Input id="sm-q" dir="ltr" type="number" min={0} step={0.01} value={q} onChange={(e) => setQ(e.target.value)} />
              {kind === "iss" && x && Number.isFinite(qn) && qn > hold + 0.005 && <FormHint tone="bad">{t("subs.led.over_hold", { q: qty(hold) })}</FormHint>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sm-day">{kind === "cnt" ? t("subs.recon.count_day") : t("subs.recon.day")}</Label>
              <Input id="sm-day" dir="ltr" type="date" max={today} value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
          </div>
          {over > 0 && x && (
            <Callout tone="block" title={t("subs.led.over_cap", { q: qty(over), unit: x.unit })}>
              {t("subs.led.over_cap_body")}
            </Callout>
          )}
          {gap !== null &&
            x &&
            (gap > 0.005 ? (
              <Callout tone="block" title={t("subs.recon.short", { qty: qty(gap), unit: x.unit })}>
                {t("subs.recon.short_note")}
              </Callout>
            ) : gap < -0.005 ? (
              <Callout tone="info">{t("subs.recon.more", { qty: qty(-gap) })}</Callout>
            ) : (
              <Callout tone="info">{t("subs.recon.exact")}</Callout>
            ))}
          <div className="space-y-1.5">
            <Label htmlFor="sm-note">
              {over > 0 ? `${t("subs.led.over_reason")} *` : t("subs.form.note")}
            </Label>
            <Input id="sm-note" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} placeholder={over > 0 ? t("subs.led.over_reason_ph") : kind === "cnt" ? t("subs.recon.count_note_ph") : ""} />
          </div>
          {kind === "cnt" && <PmFilesField orgId={orgId} folder={`projects/${projectId}/custody`} value={files} onChange={setFiles} label={t("subs.led.count_sheet")} hint={t("subs.led.count_sheet_hint")} />}
          {kind === "iss" && <Callout tone="info">{t("subs.led.stays_ours")}</Callout>}
          <BlockingReasons title={t("cannot_save")} reasons={blocks.filter((b) => b !== "archived").map((b) => t(`subs.block.${b}`))} />
        </div>
        <Footer onClose={onClose} busy={busy} disabled={blocks.length > 0} label={t(`subs.recon.move_save_${kind}`)} onSave={() => void save()} />
      </DialogContent>
    </Dialog>
  )
}

export function SubStoreRecoverDialog({
  projectId,
  line: x,
  partyKey,
  name,
  gap,
  unitCost,
  money,
  access,
  actor,
  onClose,
}: {
  projectId: string
  line: PmStoreLine
  partyKey: string
  name: string
  gap: number | null
  /** Our last price paid for the material — the default recovery rate. */
  unitCost: number | null
  money: boolean
  access: PmAccess
  actor: SubActor
  onClose: () => void
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { busy, run } = useSubRun()
  const [q, setQ] = useState(gap !== null && gap > 0 ? String(gap) : "")
  const [rate, setRate] = useState(unitCost && unitCost > 0 ? String(unitCost) : "")
  const [double, setDouble] = useState(false)
  const [note, setNote] = useState("")
  const blocks = recoveryBlocks({ archived: access.ctx.archived, q: num(q), rate: num(rate) })
  const amount = recoveryAmount(num(q) || 0, num(rate) || 0, double)

  const save = async () => {
    if (!firestore) return
    const ok = await run(async () => {
      const v = await recordStoreRecovery(firestore, access.ctx, projectId, actor, x.id, { partyKey, q: num(q), rate: num(rate), double, note: note.trim() || null })
      return money ? t("subs.led.recovered", { amount: pmMoney(v), name }) : t("subs.recon.recovered", { name })
    })
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("subs.recon.recover_title")}</DialogTitle>
          <DialogDescription dir="auto">
            {name} — {x.name}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Callout tone="info">{t("subs.recon.recover_note")}</Callout>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sr-q">
                {t("subs.recon.recover_qty")} ({x.unit}) *
              </Label>
              <Input id="sr-q" dir="ltr" type="number" min={0} step={0.01} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sr-rate">{t("subs.recon.recover_rate")} *</Label>
              <Input id="sr-rate" dir="ltr" type="number" min={0} step={0.01} value={money ? rate : rate ? "•••" : ""} readOnly={!money} onChange={(e) => setRate(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t("subs.recon.recover_rate_hint")}</p>
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-xl border p-3">
            <Checkbox checked={double} onCheckedChange={(v) => setDouble(v === true)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-semibold">{t("subs.recon.double")}</span>
              <span className="block text-xs text-muted-foreground">{t("subs.recon.double_hint")}</span>
            </span>
          </label>
          {money && (
            <div className="rounded-xl border px-3">
              <KeyValueRow label={t("subs.recon.to_deduct")} value={pmMoney(amount)} ltr strong />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="sr-note">{t("subs.recon.basis")}</Label>
            <Input id="sr-note" dir="auto" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("subs.recon.basis_ph")} />
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.filter((b) => b !== "archived").map((b) => t(`subs.block.${b}`))} />
        </div>
        <Footer onClose={onClose} busy={busy} disabled={blocks.length > 0} tone="destructive" label={t("subs.recon.recover_save")} onSave={() => void save()} />
      </DialogContent>
    </Dialog>
  )
}
