"use client"

// Step 1 of the RFQ editor (PUR-02): every project / delivery site a group — its header
// the place the supplier reads, the need-by date and the incoming request's number — and
// under it one ROW per material: the material (as it arrived, the tree's material under
// it), its spec cells, the quantity, the unit. The empty row at the end of each group
// searches the tree; Enter moves to a new row. On a phone each row is a card in the same
// order.

import { displayNeedRef } from "@/lib/procurement/format"
import { useEffect, useMemo, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarClock, Copy, Layers, MapPin, MoreHorizontal, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button, buttonVariants } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { IconButton } from "@/components/module-ui/IconButton"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { Chip } from "@/components/module-ui/Chip"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { MaterialSearchInput } from "@/components/materials/MaterialSearchInput"
import { MaterialSpecCells } from "@/components/materials/MaterialSpecCells"
import type { OptionsResult } from "@/components/materials/MaterialOptionsPanel"
import { MaterialBrowserDialog, type BrowserResult } from "@/components/materials/MaterialBrowserDialog"
import { LocationChips } from "@/components/procurement/location/LocationChips"
import { NewLocationDialog } from "@/components/procurement/location/NewLocationDialog"
import { DeliveryOptionsRow } from "@/components/procurement/location/DeliveryOptionsRow"
import { useProcActor } from "@/hooks/useProcActor"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { SAUDI_CITIES, displayCity } from "@/lib/constants"
import { label, pathLabel, pathOf, pickOf, unitConversion, unitsOf, type MaterialHit, type MaterialIndex } from "@/lib/materials/tree"
import { siteLine, siteWriteRefusal, type DeliverySite } from "@/lib/procurement/delivery-sites"
import { fmtDayLong } from "@/lib/procurement/format"
import { daysBetween } from "@/lib/procurement/po"
import {
  addLine,
  blankLine,
  lineFromPick,
  lineStarted,
  numberedLines,
  removeGroup,
  removeLine,
  repeatLine,
  unitNote,
  updateLine,
  warrantyOf,
  warrantyPatch,
  DEFAULT_WARRANTY,
  WARRANTY_MONTHS,
  type EditorGroup,
  type EditorLine,
  type EditorProblem,
} from "@/lib/procurement/rfq-editor"
import { toAmount } from "@/lib/procurement/offer-pricing"
import type { MaterialUnit } from "@/lib/materials/types"

export function EditorMaterials({
  groups,
  onChange,
  index,
  sites,
  problems,
  showProblems,
  lockedProjectId,
  fixed,
  boq,
  pmOn,
}: {
  groups: EditorGroup[]
  onChange: (groups: EditorGroup[]) => void
  index: MaterialIndex | null
  sites: DeliverySite[]
  problems: EditorProblem[]
  showProblems: boolean
  /** Opened from a project's page: its group's place is fixed. */
  lockedProjectId?: string | null
  /** The incoming request's panel (PUR-01 step 1): what was asked, as it was asked — only a missing
   * material is picked here; editing, removing or adding is «جهّزه»'s, in the editor. */
  fixed?: boolean
  /** The BOQ item of each incoming row, by `projectId/itemId` («04-01-01 · بناء بلوك 20 سم»). */
  boq?: Record<string, string>
  pmOn?: boolean
}) {
  const t = useTranslations("Portal.ProcEditor")
  const tm = useTranslations("Portal.Materials")
  const ti = useTranslations("Portal.Procurement.import")
  const locale = useLocale()
  const { toast } = useToast()
  const { orgId } = useProcActor()
  // ED-22: «+ موقع جديد» is open to whoever builds the request (the server adds and never lets him change a stored site).
  const { can, isOrgOwner } = usePermissions()
  const maySetSites = isOrgOwner || siteWriteRefusal(can, false, false) === null
  const [browse, setBrowse] = useState<{ groupKey: string; lineKey: string | null; query: string; freeText: string | null; startAt?: string | null } | null>(null)
  // The groups whose city and district are open for change (a place typed by hand stays open while it is typed).
  const [placeOpen, setPlaceOpen] = useState<Set<string>>(() => new Set())
  const setPlace = (key: string, open: boolean) =>
    setPlaceOpen((prev) => {
      const next = new Set(prev)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const numbers = new Map(numberedLines(groups).map((r) => [r.line.key, r.no]))
  const rowProblems = (lineKey: string) => (showProblems ? problems.filter((p) => p.lineKey === lineKey).map((p) => p.code) : [])

  const fillFromHit = (groupKey: string, lineKey: string | null, hit: MaterialHit) => {
    if (!index) return
    const pick = pickOf(
      index,
      hit.node.id,
      hit.preset.map((p) => ({ name: { ar: p.spec.ar, en: p.spec.en }, value: p.value })),
    )
    if (!pick) return
    const units = unitsOf(index, hit.node.id)
    return place(groupKey, lineKey, pick, units.length === 1 ? units[0] : units[0] || null)
  }

  // ED-03: a row added from the search box, a «الأكثر طلباً» chip or «خيارات» takes the focus to ITS quantity;
  // Enter in a quantity brings it back to the group's search box — what the bar's «Enter: صف جديد» promises.
  const rootRef = useRef<HTMLDivElement>(null)
  const pendingFocus = useRef<string | null>(null)
  const searchRefs = useRef(new Map<string, HTMLInputElement>())
  const focusQuantity = (lineKey: string | null | undefined) => {
    if (lineKey) pendingFocus.current = lineKey
  }
  useEffect(() => {
    const key = pendingFocus.current
    if (!key || !rootRef.current) return
    const inputs = [...rootRef.current.querySelectorAll<HTMLInputElement>("input[data-qty]")].filter((x) => x.dataset.qty === key)
    // The desktop row and the phone card both carry one; the visible one is the one with a layout box.
    const el = inputs.find((x) => x.offsetParent !== null) || inputs[0]
    if (!el) return
    pendingFocus.current = null
    el.focus()
    el.select()
  })

  // ED-12: a group with rows can be removed too, after a confirm that counts what goes with it.
  const [dropGroup, setDropGroup] = useState<EditorGroup | null>(null)

  const place = (groupKey: string, lineKey: string | null, pick: BrowserResult["pick"], unit: MaterialUnit | null, name?: string, repeat = false, quantity = ""): string | null => {
    const unitText = unit ? label(unit, locale) : ""
    if (lineKey) {
      const g = groups.find((x) => x.key === groupKey)
      const l = g?.lines.find((x) => x.key === lineKey)
      if (!l) return null
      let next = updateLine(groups, groupKey, lineKey, lineFromPick(name ? { ...l, name } : l, pick, unitText, locale))
      if (repeat) next = repeatLine(next, groupKey, lineKey)
      onChange(next)
      return lineKey
    } else {
      const fresh = lineFromPick({ ...blankLine(), name: name || "", quantity }, pick, unitText, locale)
      let next = addLine(groups, groupKey, fresh)
      if (repeat) next = repeatLine(next, groupKey, fresh.key)
      onChange(next)
      return fresh.key
    }
  }

  // A place added from «+ موقع جديد» is pickable at once, before the settings document reaches this screen.
  const [added, setAdded] = useState<DeliverySite[]>([])
  const [newFor, setNewFor] = useState<string | null>(null)
  const latest = useRef(groups)
  latest.current = groups
  const allSites = useMemo(() => [...sites, ...added.filter((a) => !sites.some((s) => s.id === a.id))], [sites, added])
  const pickSite = (groupKey: string, s: DeliverySite) =>
    onChange(
      latest.current.map((x) =>
        x.key === groupKey ? { ...x, siteId: s.id, projectId: s.projectId || null, label: s.name, city: s.city || x.city, district: s.city ? s.district : x.district } : x,
      ),
    )
  const setGroup = (g: EditorGroup, patch: Partial<EditorGroup>) => onChange(groups.map((x) => (x.key === g.key ? { ...x, ...patch } : x)))

  const changeFromTree = (g: EditorGroup, l: EditorLine) => {
    const path = index && l.material && !l.material.outside ? pathOf(index, l.material.nodeId) : []
    setBrowse({ groupKey: g.key, lineKey: l.key, query: "", freeText: null, startAt: path.length > 1 ? path[path.length - 2].id : null })
  }

  const rowMenu = (g: EditorGroup, l: EditorLine) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t("row_menu", { no: numbers.get(l.key) || "" })} title={t("row_menu_hint")} icon={MoreHorizontal} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            onChange(repeatLine(groups, g.key, l.key))
            toast({ title: t("toast_repeated") })
          }}
        >
          <Copy size={14} className="me-2" /> {t("row_repeat")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange(updateLine(groups, g.key, l.key, { needBy: l.needBy ? null : g.needBy || "" }))}>
          <CalendarClock size={14} className="me-2" /> {l.needBy != null ? t("same_date") : t("row_other_date")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => changeFromTree(g, l)}>
          <Layers size={14} className="me-2" /> {t("row_change_material")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onSelect={() => onChange(removeLine(groups, g.key, l.key))}>
          <Trash2 size={14} className="me-2" /> {t("row_delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const boqOf = (g: EditorGroup, l: EditorLine) => (g.projectId && l.boqItemId ? boq?.[`${g.projectId}/${l.boqItemId}`] || "" : "")

  const materialCell = (g: EditorGroup, l: EditorLine, bad: boolean) => (
    <div className="min-w-0 space-y-0.5">
      {(l.material || l.legacy) && fixed ? (
        <>
          <p className="px-1 text-sm font-semibold" dir="auto">
            {l.name}
          </p>
          <p className="truncate px-1 text-[11px] text-muted-foreground">{l.material ? pathLabel(l.material.path, locale, !l.material.outside) : `${l.legacy?.category} › ${l.legacy?.subCategory}`}</p>
          {boqOf(g, l) && (
            <p className="truncate px-1 text-[11px] text-muted-foreground" dir="auto">
              {t("col_boq")}: {boqOf(g, l)}
            </p>
          )}
        </>
      ) : l.material || l.legacy ? (
        <>
          <Input
            value={l.name}
            onChange={(e) => onChange(updateLine(groups, g.key, l.key, { name: e.target.value }))}
            aria-label={t("col_material")}
            className="h-8 border-transparent px-1 font-semibold shadow-none hover:border-input focus-visible:border-input"
            dir="auto"
          />
          <button
            type="button"
            onClick={() => setBrowse({ groupKey: g.key, lineKey: l.key, query: l.name, freeText: null })}
            className="block max-w-full truncate px-1 text-start text-[11px] text-muted-foreground hover:text-module"
          >
            {l.material ? pathLabel(l.material.path, locale, !l.material.outside) : `${l.legacy?.category} › ${l.legacy?.subCategory}`}
            {l.material?.outside && (
              <StatusPill tone="warn" className="ms-1.5 text-[10px]">
                {tm("outside_badge")}
              </StatusPill>
            )}
          </button>
        </>
      ) : (
        <>
          <p className="px-1 text-sm font-semibold" dir="auto">
            {l.name}
          </p>
          {fixed && boqOf(g, l) && (
            <p className="truncate px-1 text-[11px] text-muted-foreground" dir="auto">
              {t("col_boq")}: {boqOf(g, l)}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn("h-7 text-xs", bad && "border-destructive text-destructive")}
            onClick={() => setBrowse({ groupKey: g.key, lineKey: l.key, query: l.name, freeText: null })}
          >
            {t("pick_material")}
          </Button>
        </>
      )}
      {l.imported && (
        <p className="truncate px-1 text-[11px] text-muted-foreground" dir="auto" title={l.imported.text ? ti("in_file", { text: l.imported.text }) : undefined}>
          {ti(l.imported.sheet ? "source_sheet" : "source", { sheet: l.imported.sheet ?? "", row: l.imported.row })}
        </p>
      )}
    </div>
  )

  const qtyCell = (g: EditorGroup, l: EditorLine, bad: boolean) =>
    fixed ? (
      <b className="block w-24 pt-2 text-end tabular-nums" dir="ltr">
        {toAmount(l.quantity).toLocaleString("en-US")}
      </b>
    ) : (
      <Input
        inputMode="decimal"
        value={l.quantity}
        onChange={(e) => onChange(updateLine(groups, g.key, l.key, { quantity: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return
          e.preventDefault()
          searchRefs.current.get(g.key)?.focus()
        }}
        data-qty={l.key}
        aria-label={t("col_quantity")}
        aria-invalid={bad || undefined}
        className={cn("h-9 w-24 text-end tabular-nums", bad && "border-destructive")}
        dir="ltr"
      />
    )

  const unitCell = (g: EditorGroup, l: EditorLine, bad: boolean) => {
    const units = l.material && index && !l.material.outside ? unitsOf(index, l.material.nodeId) : []
    const note = unitNote(l, index)
    const conv =
      note && index && l.material
        ? unitConversion(
            toAmount(l.quantity),
            l.unit,
            units[0],
            l.material.specs.map((s) => s.value),
          )
        : null
    return (
      <div className="space-y-0.5">
        {fixed ? (
          <span className="block px-1 pt-2 text-sm">{l.unit}</span>
        ) : units.length > 1 && !l.unitFromSource ? (
          <NativeSelect
            value={l.unit}
            onChange={(e) => onChange(updateLine(groups, g.key, l.key, { unit: e.target.value }))}
            aria-label={t("col_unit")}
            className={cn("h-9 w-24", bad && "border-destructive")}
          >
            <option value="">—</option>
            {units.map((u) => (
              <option key={u.key} value={label(u, locale)}>
                {label(u, locale)}
              </option>
            ))}
          </NativeSelect>
        ) : units.length >= 1 && !l.unitFromSource ? (
          <span className="block px-1 text-sm">{l.unit || label(units[0], locale)}</span>
        ) : (
          <Input
            value={l.unit}
            onChange={(e) => onChange(updateLine(groups, g.key, l.key, { unit: e.target.value }))}
            aria-label={t("col_unit")}
            className={cn("h-9 w-24", bad && "border-destructive")}
            dir="auto"
          />
        )}
        {l.imported?.hint && (
          <p className={cn("max-w-[10rem] text-[10.5px] leading-snug", l.imported.hint.converted ? "text-muted-foreground" : "text-amber-700")}>
            {ti(l.imported.hint.quantity ? "file_hint" : "file_hint_unit", { quantity: l.imported.hint.quantity ?? "", unit: l.imported.hint.unit })}
          </p>
        )}
        {note && (
          <p className="max-w-[10rem] text-[10.5px] leading-snug text-amber-700">
            {conv
              ? t("unit_conv", { qty: toAmount(l.quantity).toLocaleString("en-US"), unit: l.unit, per: conv.per, total: conv.quantity.toLocaleString("en-US"), target: label(conv.unit, locale) })
              : t("unit_kept", { units: note.units.join(" · ") })}
          </p>
        )}
      </div>
    )
  }

  const warrantyCell = (g: EditorGroup, l: EditorLine) => {
    const months = warrantyOf(l)
    if (fixed) {
      return months ? (
        <StatusPill tone="ok" className="mt-1.5 gap-1 text-[10px]">
          <ShieldCheck size={11} aria-hidden="true" /> {t("warranty")} · {t(`warranty_${months}`)}
        </StatusPill>
      ) : null
    }
    return (
      <div className="mt-1.5 flex items-center gap-2">
        <Chip
          selected={months != null}
          icon={ShieldCheck}
          onClick={() => onChange(updateLine(groups, g.key, l.key, warrantyPatch(months != null ? null : DEFAULT_WARRANTY)))}
          title={t("warranty_switch")}
          aria-label={t("warranty_switch")}
        >
          {t("warranty")}
        </Chip>
        {months != null && (
          <NativeSelect
            value={String(months)}
            onChange={(e) => onChange(updateLine(groups, g.key, l.key, warrantyPatch(Number(e.target.value) as (typeof WARRANTY_MONTHS)[number])))}
            aria-label={t("warranty_duration")}
            className="h-8 w-28 text-xs"
          >
            {WARRANTY_MONTHS.map((m) => (
              <option key={m} value={m}>
                {t(`warranty_${m}`)}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
    )
  }

  const problemText = (codes: string[], no: number | undefined) =>
    codes.length && no ? <p className="text-[11px] font-semibold text-destructive">{codes.map((c) => (fixed && c === "material" ? t("row_err_step2") : t(`row_err_${c}`))).join(" · ")}</p> : null

  return (
    <div ref={rootRef} className="space-y-5">
      {groups.map((g) => {
        const lines = g.lines
        const placeBad = showProblems && problems.some((p) => p.groupKey === g.key && p.code === "no_place")
        const site = g.siteId ? allSites.find((s) => s.id === g.siteId) : null
        const locked = !!lockedProjectId && g.projectId === lockedProjectId
        return (
          <section key={g.key} className="overflow-hidden rounded-xl border bg-card" aria-label={g.label || t("group_unnamed")}>
            <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/40 px-3 py-2.5">
              <MapPin size={15} className="shrink-0 text-module" aria-hidden="true" />
              {locked || fixed || g.requestRefs.length ? (
                <b className="text-sm">{g.label || site?.name}</b>
              ) : (
                <LocationChips
                  sites={allSites}
                  selectedId={g.siteId}
                  usedByOtherGroups={groups.filter((x) => x.key !== g.key && x.siteId).map((x) => x.siteId as string)}
                  onPick={(s) => pickSite(g.key, s)}
                  onNew={maySetSites ? () => setNewFor(g.key) : undefined}
                  label={t("group_place")}
                  className="min-w-0 flex-1 basis-64"
                />
              )}
              {g.city && !placeOpen.has(g.key) ? (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  {siteLine(g, (c) => displayCity(c, locale))}
                  <IconButton label={t("edit_place")} icon={Pencil} iconSize={12} className="h-7 w-7 md:h-7 md:w-7" onClick={() => setPlace(g.key, true)} />
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-1.5">
                  <NativeSelect
                    value={g.city}
                    onChange={(e) => {
                      setGroup(g, { city: e.target.value })
                      if (e.target.value) setPlace(g.key, true)
                    }}
                    aria-label={t("group_city")}
                    className={cn("h-8 text-xs", placeBad && "border-destructive")}
                  >
                    <option value="">{t("group_city_pick")}</option>
                    {(g.city && !SAUDI_CITIES.includes(g.city) ? [g.city, ...SAUDI_CITIES] : SAUDI_CITIES).map((c) => (
                      <option key={c} value={c}>
                        {displayCity(c, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                  {g.city && (
                    <>
                      <Input value={g.district} onChange={(e) => setGroup(g, { district: e.target.value })} placeholder={t("group_district")} aria-label={t("group_district")} className="h-8 w-36 text-xs" dir="auto" />
                      <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPlace(g.key, false)}>
                        {t("place_done")}
                      </Button>
                    </>
                  )}
                </span>
              )}
              {g.requestRefs.map((r) => (
                <StatusPill key={r} tone="info" className="text-[11px]">
                  {t("from_request", { ref: displayNeedRef(r, locale) })}
                </StatusPill>
              ))}
              {fixed && g.requestRefs.length ? (
                <span className="ms-auto text-xs text-muted-foreground">
                  {t("need_by")} <b className="text-foreground">{g.needBy ? fmtDayLong(g.needBy, locale) : "—"}</b>
                </span>
              ) : (
                <label className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                  {t("need_by")}
                  <Input type="date" lang={locale} value={g.needBy || ""} onChange={(e) => setGroup(g, { needBy: e.target.value || null })} className="h-8 w-36 text-xs" dir="ltr" />
                </label>
              )}
              {groups.length > 1 && !lines.some(lineStarted) && <IconButton label={t("remove_group")} icon={Trash2} iconSize={14} onClick={() => onChange(removeGroup(groups, g.key))} />}
              {groups.length > 1 && lines.some(lineStarted) && !locked && !fixed && !g.requestRefs.length && (
                <IconButton label={t("remove_group")} icon={Trash2} iconSize={14} onClick={() => setDropGroup(g)} />
              )}
            </header>
            {!fixed && <DeliveryOptionsRow value={g.delivery} onChange={(delivery) => setGroup(g, { delivery })} />}
            {fixed &&
              (g.facts || []).map((f) => {
                const left = f.lastOrderDay ? daysBetween(today, f.lastOrderDay) : null
                return (
                  <p key={f.ref} className="flex flex-wrap gap-x-4 gap-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
                    {f.requestedBy && <span>{t("panel_requested_by", { name: f.requestedBy })}</span>}
                    {(f.approvedBy || f.approvedOn) && (
                      <span>{f.approvedBy ? t("panel_approved_by", { name: f.approvedBy, date: f.approvedOn ? fmtDayLong(f.approvedOn, locale, false) : "—" }) : t("panel_approved_on", { date: fmtDayLong(f.approvedOn, locale, false) })}</span>
                    )}
                    <span className={cn("font-semibold", left != null && left < 0 && "text-destructive")}>
                      {f.lastOrderDay
                        ? left != null && left < 0
                          ? t("panel_last_day_passed", { date: fmtDayLong(f.lastOrderDay, locale, false), days: -left })
                          : t("panel_last_day", { date: fmtDayLong(f.lastOrderDay, locale, false), days: left ?? 0 })
                        : t("panel_last_day_none")}
                    </span>
                  </p>
                )
              })}
            {placeBad && <p className="px-3 pt-2 text-[11px] font-semibold text-destructive">{t("err_no_place")}</p>}

            {/* Desktop column heads — inside the card, right above the lines they name (the prototype's place). */}
            {lines.some(lineStarted) && (
              <div className="hidden grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,1.6fr)_6.5rem_7rem_2.5rem] gap-3 border-b px-3 py-1.5 text-xs font-semibold text-muted-foreground md:grid" data-testid="editor-col-heads">
                <span />
                <span>{t("col_material")}</span>
                <span>{t("col_specs")}</span>
                <span className="text-end">{t("col_quantity")}</span>
                <span>{t("col_unit")}</span>
                <span />
              </div>
            )}
            <ul className="divide-y">
              {lines.filter(lineStarted).map((l) => {
                const no = numbers.get(l.key)
                const codes = rowProblems(l.key)
                return (
                  <li key={l.key} className={cn("px-3 py-2.5", codes.length && "bg-destructive/5")}>
                    {/* Desktop row */}
                    <div className="hidden grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,1.6fr)_6.5rem_7rem_2.5rem] items-start gap-3 md:grid">
                      <span className="pt-2 text-xs tabular-nums text-muted-foreground">{no}</span>
                      {materialCell(g, l, codes.includes("material"))}
                      <div className="pt-1">
                        {l.material ? (
                          <MaterialSpecCells index={index} pick={l.material} onChange={(m) => onChange(updateLine(groups, g.key, l.key, { material: m }))} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        {l.needBy != null && (
                          <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {t("line_need_by")}
                            <Input type="date" lang={locale} value={l.needBy || ""} onChange={(e) => onChange(updateLine(groups, g.key, l.key, { needBy: e.target.value }))} className="h-7 w-36 text-xs" dir="ltr" />
                          </label>
                        )}
                        {warrantyCell(g, l)}
                      </div>
                      <div className="flex justify-end">{qtyCell(g, l, codes.includes("quantity"))}</div>
                      {unitCell(g, l, codes.includes("unit"))}
                      {fixed ? <span /> : rowMenu(g, l)}
                    </div>
                    {/* Phone card: the row's order, stacked */}
                    <div className="space-y-2 md:hidden">
                      <div className="flex items-start gap-2">
                        <span className="pt-2 text-xs tabular-nums text-muted-foreground">{no}</span>
                        <div className="min-w-0 flex-1">{materialCell(g, l, codes.includes("material"))}</div>
                        {!fixed && rowMenu(g, l)}
                      </div>
                      {l.material && <MaterialSpecCells index={index} pick={l.material} onChange={(m) => onChange(updateLine(groups, g.key, l.key, { material: m }))} />}
                      {warrantyCell(g, l)}
                      <div className="flex items-start gap-2">
                        {qtyCell(g, l, codes.includes("quantity"))}
                        {unitCell(g, l, codes.includes("unit"))}
                      </div>
                    </div>
                    {problemText(codes, no)}
                  </li>
                )
              })}
              {!fixed && (
                <li className="px-3 py-2.5">
                  <MaterialSearchInput
                    pmOn={pmOn}
                    index={index}
                    inputRef={(el) => {
                      if (el) searchRefs.current.set(g.key, el)
                      else searchRefs.current.delete(g.key)
                    }}
                    onPick={(hit) => focusQuantity(fillFromHit(g.key, null, hit))}
                    onQuick={(hit) => focusQuantity(fillFromHit(g.key, null, hit))}
                    onPickOptions={(r: OptionsResult) => focusQuantity(place(g.key, null, r.pick, r.unit, undefined, false, r.quantity))}
                    onBrowse={(q) => setBrowse({ groupKey: g.key, lineKey: null, query: q, freeText: null })}
                    onFreeText={(text) => setBrowse({ groupKey: g.key, lineKey: null, query: "", freeText: text })}
                  />
                </li>
              )}
            </ul>
          </section>
        )
      })}

      {!lockedProjectId && !fixed && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={() => onChange([...groups, { key: `g${Date.now().toString(36)}`, siteId: null, projectId: null, label: "", city: "", district: "", needBy: null, requestRefs: [], lines: [] }])}
          >
            <Plus size={15} /> {pmOn ? t("add_group") : t("add_group_nopm")}
          </Button>
          <span className="text-xs text-muted-foreground">{t("add_group_hint")}</span>
        </div>
      )}

      <NewLocationDialog
        open={!!newFor}
        onOpenChange={(o) => !o && setNewFor(null)}
        orgId={orgId}
        onAdded={(site) => {
          setAdded((prev) => [...prev.filter((p) => p.id !== site.id), site])
          if (newFor) pickSite(newFor, site)
          setNewFor(null)
        }}
      />

      <AlertDialog open={!!dropGroup} onOpenChange={(o) => !o && setDropGroup(null)}>
        <AlertDialogContent dir={locale === "ar" ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("remove_group_title", { name: dropGroup?.label || t("group_unnamed") })}</AlertDialogTitle>
            <AlertDialogDescription>{t("remove_group_desc", { count: dropGroup ? dropGroup.lines.filter(lineStarted).length : 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              onClick={() => {
                if (dropGroup) onChange(removeGroup(groups, dropGroup.key))
                setDropGroup(null)
              }}
            >
              {t("remove_group")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MaterialBrowserDialog
        open={!!browse}
        onOpenChange={(o) => {
          if (o) return
          // ED-07: words kept «كما هو» are not lost when the window is dismissed — they stay as a row with
          // «اختر المادة», which the step's checks already hold back until a material is picked.
          if (browse?.freeText && !browse.lineKey) onChange(addLine(groups, browse.groupKey, { ...blankLine(), name: browse.freeText }))
          setBrowse(null)
        }}
        index={index}
        initialQuery={browse?.query || ""}
        freeText={browse?.freeText ?? null}
        startAt={browse?.startAt ?? null}
        target={browse?.lineKey ? t("row_no", { no: numbers.get(browse.lineKey) || "" }) : undefined}
        onAdd={(r) => {
          if (!browse) return
          place(browse.groupKey, browse.lineKey, r.pick, r.unit, r.name)
          if (r.repeat) {
            setBrowse({ ...browse, lineKey: null })
            toast({ title: tm("added_again") })
          } else setBrowse(null)
        }}
      />
    </div>
  )
}
