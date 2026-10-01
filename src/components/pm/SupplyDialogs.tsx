"use client"

// The Supply forms of a PM 1.0 project (prototype formReq · formRcv · formMrc ·
// formChgv): a material request line by line on its BOQ item, the project-side
// receipt from the delivery note, stopping what has not arrived, and "on the
// client" for a change. Every check shown here runs again in the write.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection, query, where } from "firebase/firestore"
import { Loader2, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { useOrgStock } from "@/hooks/useOrgStock"
import { usePmIndirect } from "@/hooks/usePmIndirect"
import type { PmAccess } from "@/hooks/usePmAccess"
import type { SupplyWorld } from "@/hooks/useSupplyWorld"
import { PmAccessError } from "@/lib/pm/access"
import type { PmAttachment } from "@/lib/pm/attachments"
import { INVENTORY_UNIT_CODES, unitMessageKey } from "@/lib/inventory-units"
import { pmMoney, todayDay } from "@/lib/pm/format"
import { addDays } from "@/lib/pm/programme"
import { itemMaterials, lineDays, lineGot, lineInTransit, lineKind, lineLink, lineNeed, lineOut, mainStock, receivablePortions, reqNo, reqTitle, siteOverheadLeft, stockCatalogue, CLOSE_WHY, type CloseWhy, type LineDraft, type MainStockRow, type OrderFact, type PmMaterialRequest, type PortionKind } from "@/lib/pm/supply"
import { materialKeyOf, r2, ratedOn, storeBalance, type StoreItem } from "@/lib/pm/store"
import { PM_VARIATIONS, voNo, type PmVariation } from "@/lib/pm/variation"
import { createMaterialRequest, decideChange, PmSupplyError, receiveOnProject, rejectMaterialRequest, stopLine, type SupplyActor } from "@/lib/pm/supply-writes"
import { PURCHASE_ORDERS } from "@/lib/procurement/types"
import { ChoiceChips, FormHint } from "./ContractBits"
import { PmFilesField } from "./PmAttachments"

export type SupplyItem = StoreItem & { division?: string; pmSample?: boolean | null; pmSub?: string | null; estCost?: number }

export const qty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-US")
const SELECT = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

/** One place for the toast after a write: the guard's refusal, the rule's block, or a failure. */
export function useSupplyRun() {
  const t = useTranslations("Portal.PM")
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (key: string, fn: () => Promise<unknown>, ok: string | (() => string)) => {
    setBusy(key)
    try {
      await fn()
      toast({ title: typeof ok === "function" ? ok() : ok })
      return true
    } catch (err) {
      console.error(err)
      const title =
        err instanceof PmAccessError ? t(`refused.${err.code}`) : err instanceof PmSupplyError ? (err.blocks[0] ? t(`sup.block.${err.blocks[0]}`) : t(`sup.err.${err.code}`)) : t("error.save")
      toast({ title, variant: "destructive" })
      return false
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

/** The project's purchase orders, as far as Supply needs them: is the order
 * behind a line coming yet? An order the project cannot see here (one raised for
 * several projects, or an award older than orders) answers undefined — the line
 * is shown as coming and the receipt's own transaction decides. */
export function useProjectOrderFacts(projectId: string, orgId: string | null | undefined): (poId: string | null | undefined) => OrderFact {
  const firestore = useFirestore()
  const q = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, PURCHASE_ORDERS), where("organizationId", "==", orgId), where("projectId", "==", projectId)) : null), [firestore, orgId, projectId])
  const { data } = useCollection(q)
  return useMemo(() => {
    const byId = new Map(((data ?? []) as Array<{ id: string; status?: string | null }>).map((o) => [o.id, { status: o.status ?? null }]))
    return (poId) => (poId ? byId.get(poId) : undefined)
  }, [data])
}

// ── A new request ────────────────────────────────────────────────────────────

type LineState = { itemId: string; mat: string; name: string; unit: string; unitOther?: boolean; q: string; why: string }
const GEN = "_gen"
const NEW = "__new"
/** A general line's pick from the Inventory catalogue (`cat:` + material key). */
const CAT = "cat:"
const OTHER_UNIT = "__other"
const blankLine = (itemId = ""): LineState => ({ itemId, mat: "", name: "", unit: "", q: "", why: "" })
type Catalogue = Array<{ key: string; name: string; unit: string }>

export function NewRequestDialog({
  projectId,
  orgId,
  access,
  actor,
  items,
  world,
  startOn,
  seed,
  onClose,
}: {
  projectId: string
  orgId?: string | null
  access: PmAccess
  actor: SupplyActor
  items: SupplyItem[]
  world: SupplyWorld
  startOn: string | null
  seed?: { itemId: string; key: string; name: string; unit: string; q: number } | null
  onClose: () => void
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const today = todayDay()
  const [lines, setLines] = useState<LineState[]>(() => (seed ? [{ itemId: seed.itemId, mat: seed.key, name: seed.name, unit: seed.unit, q: String(seed.q), why: "" }] : [blankLine()]))
  const [needBy, setNeedBy] = useState(addDays(today, seed ? 21 : 14))
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")

  const whQ = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, "warehouses"), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data: whData } = useCollection(whQ)
  const mains = useMemo(() => ((whData ?? []) as Array<{ id: string; projectId?: string | null; isOutbound?: boolean }>).filter((w) => !w.projectId && !w.isOutbound), [whData])
  const stock = useOrgStock(mains, mains.length > 0)
  const stockRows = useMemo(() => [...stock.byWarehouse.values()].flat(), [stock])
  const catalogue = useMemo(() => stockCatalogue(stockRows), [stockRows])
  const money = access.has("money")
  const hasGen = lines.some((l) => l.itemId === GEN)
  const indirect = usePmIndirect(projectId, orgId ?? null, money && hasGen)
  const ovhLeft = money ? siteOverheadLeft(indirect.budgets.ovh, indirect.byKind.ovh) : undefined

  const resolve = (l: LineState): LineDraft | null => {
    const mat = l.itemId === GEN && !l.mat && !catalogue.length ? NEW : l.mat
    if (!l.itemId || !mat) return null
    const q = Number(l.q)
    const picked = mat.startsWith(CAT) ? catalogue.find((c) => c.key === mat.slice(CAT.length)) : mat !== NEW ? world.stores.find((s) => s.key === mat) : null
    const name = picked ? picked.name : l.name.trim()
    const unit = picked ? picked.unit : l.unit.trim()
    if (!name || !unit || !(q > 0)) return null
    return { itemId: l.itemId === GEN ? null : l.itemId, name, unit, qty: q, why: l.why }
  }
  const drafts = lines.map(resolve)
  const ok = drafts.some(Boolean) && needBy >= today
  const valid = drafts.filter((d): d is LineDraft => Boolean(d))
  const changes = valid.filter((d) => lineKind(world.stores, d) === "change").length
  const gens = valid.filter((d) => !d.itemId).length
  const auto = reqTitle(valid, t("sup.form.title_ph"))
  const set = (i: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))

  const save = async () => {
    if (!firestore) return
    const done = await run("new", () => createMaterialRequest(firestore, access.ctx, projectId, actor, { title: title.trim() || auto, needBy, notes, lines: valid }), () => (changes ? t("sup.sent_chg", { count: changes }) : valid.some((d) => lineKind(world.stores, d) === "first") ? t("sup.sent_first") : t("sup.sent")))
    if (done) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("sup.form.title")}</DialogTitle>
          <DialogDescription>{t("sup.form.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("sup.form.materials")} *</Label>
            {lines.map((l, i) => (
              <LineEditor
                key={i}
                line={l}
                items={items}
                world={world}
                startOn={startOn}
                today={today}
                catalogue={catalogue}
                stockRows={!whData || stock.loading ? null : stockRows}
                ovhLeft={ovhLeft}
                removable={lines.length > 1}
                onChange={(p) => set(i, p)}
                onRemove={() => setLines((ls) => ls.filter((_, j) => j !== i))}
              />
            ))}
            {lines.length < 8 && (
              <Button type="button" size="sm" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine(ls[ls.length - 1]?.itemId ?? "")])}>
                <Plus size={14} className="me-1.5" aria-hidden="true" />
                {t("sup.form.add_line")}
              </Button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="mr-need">{t("sup.form.need_by")}</Label>
              <Input id="mr-need" type="date" dir="ltr" min={today} value={needBy} onChange={(e) => setNeedBy(e.target.value)} />
              <FormHint>{t("sup.form.need_hint")}</FormHint>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mr-title">
                {t("sup.form.req_title")} <span className="text-xs text-muted-foreground">{t("sup.form.optional")}</span>
              </Label>
              <Input id="mr-title" dir="auto" value={title} placeholder={auto} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mr-spec">{t("sup.form.spec")}</Label>
            <Textarea id="mr-spec" dir="auto" rows={2} value={notes} placeholder={t("sup.form.spec_ph")} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {valid.length > 0 && (
            <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
              <KeyValueRow label={t("sup.form.route")} value={<span className="text-xs">{t("sup.form.route_body", { changes })}</span>} />
              {gens > 0 && <KeyValueRow label={t("sup.form.consumables")} value={<span className="text-xs">{t("sup.form.consumables_body")}</span>} />}
              <KeyValueRow label={t("sup.form.price")} value={<span className="text-xs">{t("sup.form.price_body")}</span>} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            {t("sup.cancel")}
          </Button>
          <Button onClick={() => void save()} disabled={!ok || busy !== null}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {t("sup.form.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LineEditor({
  line,
  items,
  world,
  startOn,
  today,
  catalogue,
  stockRows,
  ovhLeft,
  removable,
  onChange,
  onRemove,
}: {
  line: LineState
  items: SupplyItem[]
  world: SupplyWorld
  startOn: string | null
  today: string
  /** The Inventory catalogue a general line picks from. */
  catalogue: Catalogue
  /** What the main stores hold (null while it is read). */
  stockRows: MainStockRow[] | null
  /** Money holders: the site-overheads budget left (null = none recorded); undefined for everyone else. */
  ovhLeft: number | null | undefined
  removable: boolean
  onChange: (p: Partial<LineState>) => void
  onRemove: () => void
}) {
  const t = useTranslations("Portal.PM")
  const tc = useTranslations("Portal.Contractor")
  const gen = line.itemId === GEN
  const item = !gen ? items.find((i) => i.id === line.itemId) : undefined
  const own = item ? itemMaterials(world.stores, item.id) : []
  const others = item ? world.stores.filter((s) => !own.some((o) => o.key === s.key)) : []
  const first = Boolean(item) && own.length === 0
  const mat = gen && !line.mat && !catalogue.length ? NEW : line.mat
  const store = !gen && mat && mat !== NEW ? world.stores.find((s) => s.key === mat) : null
  const fromCat = gen && mat.startsWith(CAT) ? catalogue.find((c) => c.key === mat.slice(CAT.length)) : undefined
  const picked = store ?? fromCat ?? null
  const name = picked ? picked.name : line.name.trim()
  const unit = picked ? picked.unit : line.unit.trim()
  const q = Number(line.q) || 0
  const key = name && unit ? materialKeyOf(name, unit) : ""
  const kind = line.itemId && name && unit ? lineKind(world.stores, { itemId: gen ? null : line.itemId, name, unit }) : null
  const need = item && key ? lineNeed({ key, stores: world.stores, items, requests: world.requests }) : null
  const days = item && key ? lineDays({ stores: world.stores, items, itemId: item.id, key, qty: q, startOn, today }) : null
  const rate = item && store ? ratedOn(store, item.id) : null
  const onHand = store ? Math.max(0, storeBalance(store, items)) : null
  const inMain = stockRows && name && unit ? mainStock(stockRows, name, unit) : null
  const divisions = [...new Set(items.map((i) => i.division || ""))]
  const units = INVENTORY_UNIT_CODES.map((c) => tc(unitMessageKey(c) as Parameters<typeof tc>[0]))
  const unitValue = line.unitOther ? OTHER_UNIT : units.includes(line.unit) ? line.unit : ""

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <select aria-label={t("sup.form.which_item")} className={SELECT} value={line.itemId} onChange={(e) => onChange({ itemId: e.target.value, mat: "", name: "", unit: "", unitOther: false })}>
          <option value="">{t("sup.form.which_item")}</option>
          {divisions.map((d) => (
            <optgroup key={d || "_"} label={d || t("sup.general_items")}>
              {items
                .filter((i) => (i.division || "") === d)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code} — {i.description}
                  </option>
                ))}
            </optgroup>
          ))}
          <option value={GEN}>{t("sup.general")}</option>
        </select>
        {removable && (
          <Button type="button" size="icon" variant="ghost" className="shrink-0" aria-label={t("sup.form.remove_line")} onClick={onRemove}>
            <X size={15} aria-hidden="true" />
          </Button>
        )}
      </div>
      {line.itemId && (
        <div className="flex flex-wrap items-center gap-2">
          {!gen ? (
            <select aria-label={t("sup.form.choose_mat")} className={`${SELECT} min-w-0 flex-1`} value={line.mat} onChange={(e) => onChange({ mat: e.target.value })}>
              <option value="">{t("sup.form.choose_mat")}</option>
              {own.length > 0 && (
                <optgroup label={t("sup.form.own_mats")}>
                  {own.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {!first && others.length > 0 && (
                <optgroup label={t("sup.form.other_mats")}>
                  {others.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <option value={NEW}>{first ? t("sup.form.new_mat") : t("sup.form.new_mat_chg")}</option>
            </select>
          ) : catalogue.length > 0 ? (
            <select aria-label={t("sup.form.choose_mat")} className={`${SELECT} min-w-0 flex-1`} value={line.mat} onChange={(e) => onChange({ mat: e.target.value })}>
              <option value="">{t("sup.form.choose_mat")}</option>
              <optgroup label={t("sup.form.consumables_cat")}>
                {catalogue.map((c) => (
                  <option key={c.key} value={`${CAT}${c.key}`}>
                    {c.name} ({c.unit})
                  </option>
                ))}
              </optgroup>
              <option value={NEW}>{t("sup.form.new_mat")}</option>
            </select>
          ) : null}
          <Input aria-label={t("sup.form.qty")} type="number" min={0} dir="ltr" className="h-9 w-28" placeholder={t("sup.form.qty")} value={line.q} onChange={(e) => onChange({ q: e.target.value })} />
          {picked && <span className="text-xs text-muted-foreground">{picked.unit}</span>}
        </div>
      )}
      {line.itemId && mat === NEW && (
        <div className="flex flex-wrap gap-2">
          <Input aria-label={t("sup.form.mat_name")} dir="auto" className="h-9 min-w-0 flex-1" placeholder={t("sup.form.mat_name")} value={line.name} onChange={(e) => onChange({ name: e.target.value })} />
          <select
            aria-label={t("sup.form.unit")}
            className={`${SELECT} w-32`}
            value={unitValue}
            onChange={(e) => onChange(e.target.value === OTHER_UNIT ? { unitOther: true, unit: "" } : { unitOther: false, unit: e.target.value })}
          >
            <option value="">{t("sup.form.unit")}</option>
            {units.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
            <option value={OTHER_UNIT}>{t("sup.form.unit_other")}</option>
          </select>
          {line.unitOther && <Input aria-label={t("sup.form.unit")} dir="auto" className="h-9 w-28" placeholder={t("sup.form.unit")} value={line.unit} onChange={(e) => onChange({ unit: e.target.value })} />}
        </div>
      )}
      {gen && name && (
        <p className="text-xs text-muted-foreground">
          {t("sup.form.gen_note")}
          {ovhLeft !== undefined && ` ${ovhLeft === null ? t("sup.form.ovh_none") : t("sup.form.ovh_left", { amount: pmMoney(ovhLeft) })}`}
        </p>
      )}
      {kind === "change" && (
        <div className="space-y-1.5 rounded-md border border-warning/30 bg-warning/5 p-2 text-xs">
          <p>
            <b className="text-warning">{t("sup.chg.title")}</b> — {t("sup.form.chg_note")}
          </p>
          <Input aria-label={t("sup.form.why_ph")} dir="auto" className="h-8 text-xs" placeholder={t("sup.form.why_ph")} value={line.why} onChange={(e) => onChange({ why: e.target.value })} />
        </div>
      )}
      {kind === "first" && <p className="text-xs font-bold text-warning">{t("sup.form.first_note")}</p>}
      {kind === "own" && item && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <p>
            {rate ? t("sup.rate_txt", { r: qty(rate.r ?? 0), unit, per: item.unit, w: rate.w }) : t("sup.no_rate")}
            {onHand !== null && ` · ${t("sup.form.in_store", { q: qty(onHand) })}`}
            {need !== null && ` · ${t("sup.form.still_need", { q: qty(need) })}`}
          </p>
          {need !== null && q > need * 1.05 && <p className="font-bold text-warning">{t("sup.form.over", { q: qty(r2(q - need)) })}</p>}
          {days !== null && days > 45 && <p className="font-bold text-warning">{t("sup.form.long", { days })}</p>}
        </div>
      )}
      {kind && kind !== "general" && q > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("sup.form.route_line")}
          {inMain !== null && ` · ${inMain > 0 ? t("sup.form.main_stock", { q: qty(inMain) }) : t("sup.form.main_none")}`}
        </p>
      )}
    </div>
  )
}

// ── Receiving on the project ─────────────────────────────────────────────────

export function ReceiveDialog({
  projectId,
  orgId,
  withStore = true,
  access,
  actor,
  request,
  index,
  onClose,
}: {
  projectId: string
  orgId?: string | null
  /** The project keeps a store — else the receipt is expensed to site overheads. */
  withStore?: boolean
  access: PmAccess
  actor: SupplyActor
  request: PmMaterialRequest
  index: number
  onClose: () => void
}) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const line = request.lines[index]
  const orderOf = useProjectOrderFacts(projectId, orgId)
  const by = lineLink(request, line)
  // A receipt is recorded against one portion — what the store issued, or what was
  // bought — and never above what that portion still expects.
  const open = receivablePortions(request, line, orderOf(by.poId))
  const [picked, setPicked] = useState<PortionKind | null>(null)
  const portion = open.find((p) => p.k === picked) ?? (open.length === 1 ? open[0] : null)
  const left = portion?.left ?? 0
  const [acc, setAcc] = useState("")
  const [rej, setRej] = useState("")
  const [dn, setDn] = useState("")
  const [note, setNote] = useState("")
  const [short, setShort] = useState(false)
  const [files, setFiles] = useState<PmAttachment[]>([])
  const a = Number(acc) || 0
  const r = Number(rej) || 0
  const over = Boolean(portion) && a > left + 0.005
  const bad = !portion || a < 0 || r < 0 || a + r <= 0 || over
  const sourceOf = (k: PortionKind) => (k === "stk" ? line.inv?.warehouseName || t("sup.lgd.store") : by.poNumber ? t("sup.rcv.from_po", { no: by.poNumber }) : by.mfgRequestId ? t("sup.rcv.from_mfg") : t("sup.rcv.from_proc"))

  const save = async () => {
    if (!firestore) return
    let grn = ""
    const done = await run(
      "rcv",
      async () => {
        grn = await receiveOnProject(firestore, access.ctx, projectId, actor, request.id, index, { acc: a, rej: r, dn, note, short, files, withStore, portion: portion?.k ?? null })
      },
      () => t(dn.trim() ? "sup.rcv.done" : "sup.rcv.done_no_dn", { no: grn, q: qty(a), unit: line.unit, name: line.name })
    )
    if (done) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("sup.rcv.title")}</DialogTitle>
          <DialogDescription dir="auto">
            {line.name} — {t("sup.no", { no: reqNo(request.seq ?? 0) })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {open.length > 1 && (
            <div className="space-y-1.5">
              <Label>{t("sup.rcv.source")} *</Label>
              <ChoiceChips label={t("sup.rcv.source")} options={open.map((p) => ({ id: p.k, label: `${sourceOf(p.k)} · ${qty(p.left)} ${line.unit}` }))} value={portion?.k ?? null} onChange={setPicked} />
              {!portion && <FormHint>{t("sup.block.no_source")}</FormHint>}
            </div>
          )}
          <div className="rounded-lg border bg-muted/30 p-3">
            {portion ? <KeyValueRow label={t("sup.rcv.source")} value={sourceOf(portion.k)} /> : open.length === 0 ? <KeyValueRow label={t("sup.rcv.source")} value={t("sup.block.not_receivable")} /> : null}
            <KeyValueRow label={t("sup.rcv.in_line")} value={`${qty(line.qty)} ${line.unit}`} />
            {lineGot(line) > 0 && <KeyValueRow label={t("sup.rcv.before")} value={`${qty(lineGot(line))} ${line.unit}`} />}
            <KeyValueRow label={t("sup.rcv.left")} value={`${qty(left)} ${line.unit}`} strong />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rc-acc">{t("sup.rcv.acc")} *</Label>
              <Input id="rc-acc" type="number" min={0} dir="ltr" placeholder={t("sup.rcv.acc_ph")} value={acc} onChange={(e) => setAcc(e.target.value)} />
              {over && <FormHint tone="bad">{t("sup.rcv.over", { q: qty(left) })}</FormHint>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-rej">
                {t("sup.rcv.rej")} <span className="text-xs text-muted-foreground">{t("sup.form.optional")}</span>
              </Label>
              <Input id="rc-rej" type="number" min={0} dir="ltr" placeholder="0" value={rej} onChange={(e) => setRej(e.target.value)} />
              <FormHint>{portion?.k === "stk" ? t("sup.rcv.rej_stk") : t("sup.rcv.rej_buy")}</FormHint>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-dn">
                {t("sup.rcv.dn")} <span className="text-xs text-muted-foreground">{t("sup.form.optional")}</span>
              </Label>
              <Input id="rc-dn" dir="auto" placeholder={t("sup.rcv.dn_ph")} value={dn} onChange={(e) => setDn(e.target.value)} />
              {!dn.trim() && <FormHint>{t("sup.rcv.dn_hint")}</FormHint>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rc-note">{t("sup.rcv.note")}</Label>
              <Input id="rc-note" dir="auto" placeholder={t("sup.rcv.note_ph")} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
            <Checkbox checked={short} onCheckedChange={(v) => setShort(v === true)} className="mt-0.5" />
            <span>
              <b className="block">{t("sup.rcv.short")}</b>
              <span className="text-xs text-muted-foreground">{t("sup.rcv.short_hint")}</span>
            </span>
          </label>
          <PmFilesField orgId={orgId} folder={`projects/${projectId}/receipts`} value={files} onChange={setFiles} label={t("sup.rcv.files")} hint={t("sup.rcv.files_hint")} />
          <Callout tone="info">{line.itemId && withStore ? t("sup.rcv.enters_store") : t("sup.rcv.expensed")}</Callout>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            {t("sup.back")}
          </Button>
          <Button onClick={() => void save()} disabled={bad || busy !== null}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {short && a < left ? t("sup.rcv.confirm_short") : t("sup.rcv.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Stop what has not arrived ────────────────────────────────────────────────

export function StopLineDialog({ projectId, access, actor, request, index, onClose }: { projectId: string; access: PmAccess; actor: SupplyActor; request: PmMaterialRequest; index: number; onClose: () => void }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const line = request.lines[index]
  const got = lineGot(line)
  const mode = got > 0 ? "close" : "cancel"
  const [why, setWhy] = useState<CloseWhy | null>(null)
  const [note, setNote] = useState("")
  const whyOk = why !== "oth" || note.trim().length > 0
  const transit = lineInTransit(line)
  // What stops is the line's own order — or, with none out yet, nothing anyone started on.
  const by = lineLink(request, line)
  const fate = by.poId ? t("sup.stop.fate_po", { no: by.poNumber || "—" }) : by.mfgRequestId ? t("sup.stop.fate_mfg") : t("sup.stop.fate_now")

  const save = async () => {
    if (!firestore) return
    const done = await run("stop", () => stopLine(firestore, access.ctx, projectId, actor, request.id, index, why, note), () => (mode === "cancel" ? t("sup.stop.cancelled", { name: line.name }) : t("sup.stop.stopped", { name: line.name, q: qty(got), unit: line.unit })))
    if (done) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{mode === "close" ? t("sup.stop.title") : t("sup.stop.cancel_title")}</DialogTitle>
          <DialogDescription dir="auto">
            {line.name} — {t("sup.no", { no: reqNo(request.seq ?? 0) })}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <KeyValueRow label={t("sup.stop.requested")} value={`${qty(line.qty)} ${line.unit}`} />
            <KeyValueRow label={t("sup.stop.received")} value={`${qty(got)} ${line.unit}`} />
            <KeyValueRow label={`${qty(lineOut(line))} ${line.unit}`} value={<span className="text-xs">{fate}</span>} />
          </div>
          <div className="space-y-1.5">
            <Label>
              {t("sup.stop.why")} <span className="text-xs text-muted-foreground">{t("sup.form.optional")}</span>
            </Label>
            <ChoiceChips label={t("sup.stop.why")} options={CLOSE_WHY.map((w) => ({ id: w, label: t(`sup.close_why.${w}`) }))} value={why} onChange={(v) => setWhy(v === why ? null : v)} />
            {why === "oth" && <Input aria-label={t("sup.stop.oth_ph")} dir="auto" placeholder={t("sup.stop.oth_ph")} value={note} onChange={(e) => setNote(e.target.value)} />}
          </div>
          {transit > 0 ? <Callout tone="block">{t("sup.block.in_transit", { q: qty(transit), unit: line.unit })}</Callout> : <Callout tone="info">{t("sup.stop.note")}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            {t("sup.back")}
          </Button>
          <Button variant={mode === "cancel" ? "destructive" : "default"} onClick={() => void save()} disabled={!whyOk || transit > 0 || busy !== null}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {mode === "close" ? t("sup.stop.title") : t("sup.stop.cancel_title")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── "On the client" ──────────────────────────────────────────────────────────

export function ChangeOnClientDialog({ projectId, access, actor, request, index, onClose }: { projectId: string; access: PmAccess; actor: SupplyActor; request: PmMaterialRequest; index: number; onClose: () => void }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const line = request.lines[index]
  const vq = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_VARIATIONS) : null), [firestore, projectId])
  const { data } = useCollection(vq)
  const drafts = useMemo(() => ((data ?? []) as unknown as Array<PmVariation & { itemIds?: string[] }>).filter((v) => (v.status === "draft" || v.status === "wait") && (!line.itemId || (v.itemIds ?? []).includes(line.itemId) || !(v.itemIds ?? []).length)).sort((a, b) => b.seq - a.seq), [data, line.itemId])
  const [vo, setVo] = useState<string>("new")
  const [ref, setRef] = useState("")

  const save = async () => {
    if (!firestore) return
    let seq: number | null = null
    const done = await run(
      "own",
      async () => {
        seq = (await decideChange(firestore, access.ctx, projectId, actor, request.id, index, { st: "own", voSeq: vo === "new" ? null : Number(vo), ref: ref || null })).voSeq
      },
      () => t(ref.trim() ? "sup.chg.own_done" : "sup.chg.own_done_noref", { no: voNo(seq ?? 0), code: line.code || "—" })
    )
    if (done) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("sup.chg.own_title")}</DialogTitle>
          <DialogDescription dir="auto">
            {line.name} — {line.code || "—"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("sup.chg.vo")}</Label>
            <ChoiceChips
              label={t("sup.chg.vo")}
              options={[...drafts.map((v) => ({ id: String(v.seq), label: `${t("vo.no", { no: voNo(v.seq) })} — ${v.title.slice(0, 40)}` })), { id: "new", label: t("sup.chg.vo_new") }]}
              value={vo}
              onChange={setVo}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chg-ref">
              {t("sup.chg.ref")} <span className="text-xs text-muted-foreground">{t("sup.form.optional")}</span>
            </Label>
            <Input id="chg-ref" dir="auto" placeholder={t("sup.chg.ref_ph")} value={ref} onChange={(e) => setRef(e.target.value)} />
            {!ref.trim() && <FormHint>{t("sup.chg.ref_hint")}</FormHint>}
          </div>
          <Callout tone="info">{t("sup.chg.own_note")}</Callout>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            {t("sup.back")}
          </Button>
          <Button onClick={() => void save()} disabled={busy !== null}>
            {busy && <Loader2 size={14} className="me-1.5 animate-spin" aria-hidden="true" />}
            {t("sup.chg.own")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function RejectRequestDialog({ projectId, access, actor, request, onClose }: { projectId: string; access: PmAccess; actor: SupplyActor; request: PmMaterialRequest; onClose: () => void }) {
  const t = useTranslations("Portal.PM")
  const firestore = useFirestore()
  const { busy, run } = useSupplyRun()
  const [reason, setReason] = useState("")
  const save = async () => {
    if (!firestore) return
    const done = await run("rej", () => rejectMaterialRequest(firestore, access.ctx, projectId, actor, request.id, reason), t("sup.rejected", { no: reqNo(request.seq ?? 0) }))
    if (done) onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("sup.reject_title")}</DialogTitle>
          <DialogDescription dir="auto">{request.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="mr-rej">
            {t("sup.reject_reason")} <span className="text-xs text-muted-foreground">{t("sup.form.optional")}</span>
          </Label>
          <Textarea id="mr-rej" dir="auto" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          <FormHint>{t("sup.reject_hint")}</FormHint>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            {t("sup.back")}
          </Button>
          <Button variant="destructive" onClick={() => void save()} disabled={busy !== null}>
            {t("sup.reject")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function useLocaleDir() {
  const locale = useLocale()
  return { locale, dir: locale === "ar" ? ("rtl" as const) : ("ltr" as const), side: locale === "ar" ? ("left" as const) : ("right" as const) }
}
