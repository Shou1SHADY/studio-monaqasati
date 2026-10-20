"use client"

// Step 1 of the RFQ editor (PUR-02): every project / delivery site a group — its header
// the place the supplier reads, the need-by date and the incoming request's number — and
// under it one ROW per material: the material (as it arrived, the tree's material under
// it), its spec cells, the quantity, the unit. The empty row at the end of each group
// searches the tree; Enter moves to a new row. On a phone each row is a card in the same
// order.

import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { CalendarClock, Copy, MapPin, MoreHorizontal, Plus, ShieldCheck, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { IconButton } from "@/components/module-ui/IconButton"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { MaterialSearchInput } from "@/components/materials/MaterialSearchInput"
import { MaterialSpecCells } from "@/components/materials/MaterialSpecCells"
import { MaterialBrowserDialog, type BrowserResult } from "@/components/materials/MaterialBrowserDialog"
import { cn } from "@/lib/utils"
import { SAUDI_CITIES, displayCity } from "@/lib/constants"
import { label, pathLabel, pickOf, unitConversion, unitsOf, type MaterialHit, type MaterialIndex } from "@/lib/materials/tree"
import { siteLine, type DeliverySite } from "@/lib/procurement/delivery-sites"
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
}: {
  groups: EditorGroup[]
  onChange: (groups: EditorGroup[]) => void
  index: MaterialIndex | null
  sites: DeliverySite[]
  problems: EditorProblem[]
  showProblems: boolean
  /** Opened from a project's page: its group's place is fixed. */
  lockedProjectId?: string | null
}) {
  const t = useTranslations("Portal.ProcEditor")
  const tm = useTranslations("Portal.Materials")
  const locale = useLocale()
  const [browse, setBrowse] = useState<{ groupKey: string; lineKey: string | null; query: string; freeText: string | null } | null>(null)
  const numbers = new Map(numberedLines(groups).map((r) => [r.line.key, r.no]))
  const rowProblems = (lineKey: string) => (showProblems ? problems.filter((p) => p.lineKey === lineKey).map((p) => p.code) : [])

  const fillFromHit = (groupKey: string, lineKey: string | null, hit: MaterialHit) => {
    if (!index) return
    const pick = pickOf(index, hit.node.id, hit.preset.map((p) => ({ name: { ar: p.spec.ar, en: p.spec.en }, value: p.value })))
    if (!pick) return
    const units = unitsOf(index, hit.node.id)
    place(groupKey, lineKey, pick, units.length === 1 ? units[0] : units[0] || null)
  }

  const place = (groupKey: string, lineKey: string | null, pick: BrowserResult["pick"], unit: MaterialUnit | null, name?: string, repeat = false) => {
    const unitText = unit ? label(unit, locale) : ""
    if (lineKey) {
      const g = groups.find((x) => x.key === groupKey)
      const l = g?.lines.find((x) => x.key === lineKey)
      if (!l) return
      let next = updateLine(groups, groupKey, lineKey, lineFromPick(name ? { ...l, name } : l, pick, unitText, locale))
      if (repeat) next = repeatLine(next, groupKey, lineKey)
      onChange(next)
    } else {
      const fresh = lineFromPick({ ...blankLine(), name: name || "" }, pick, unitText, locale)
      let next = addLine(groups, groupKey, fresh)
      if (repeat) next = repeatLine(next, groupKey, fresh.key)
      onChange(next)
    }
  }

  const setGroupSite = (g: EditorGroup, siteId: string) => {
    const s = sites.find((x) => x.id === siteId)
    onChange(groups.map((x) => (x.key === g.key ? { ...x, siteId: s?.id || null, projectId: s?.projectId || null, label: s?.name || "", city: s?.city || x.city, district: s?.district || x.district } : x)))
  }
  const setGroup = (g: EditorGroup, patch: Partial<EditorGroup>) => onChange(groups.map((x) => (x.key === g.key ? { ...x, ...patch } : x)))

  const rowMenu = (g: EditorGroup, l: EditorLine) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t("row_menu", { no: numbers.get(l.key) || "" })} icon={MoreHorizontal} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onChange(repeatLine(groups, g.key, l.key))}>
          <Copy size={14} className="me-2" /> {t("repeat")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange(updateLine(groups, g.key, l.key, { needBy: l.needBy ? null : g.needBy || "" }))}>
          <CalendarClock size={14} className="me-2" /> {l.needBy != null ? t("same_date") : t("other_date")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onChange(updateLine(groups, g.key, l.key, { requiresWarranty: !l.requiresWarranty }))}>
          <ShieldCheck size={14} className="me-2" /> {l.requiresWarranty ? t("warranty_off") : t("warranty_on")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-destructive" onSelect={() => onChange(removeLine(groups, g.key, l.key))}>
          <Trash2 size={14} className="me-2" /> {t("remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const materialCell = (g: EditorGroup, l: EditorLine, bad: boolean) => (
    <div className="min-w-0 space-y-0.5">
      {l.material || l.legacy ? (
        <>
          <Input value={l.name} onChange={(e) => onChange(updateLine(groups, g.key, l.key, { name: e.target.value }))} aria-label={t("col_material")} className="h-8 border-transparent px-1 font-semibold shadow-none hover:border-input focus-visible:border-input" dir="auto" />
          <button type="button" onClick={() => setBrowse({ groupKey: g.key, lineKey: l.key, query: l.name, freeText: null })} className="block max-w-full truncate px-1 text-start text-[11px] text-muted-foreground hover:text-module">
            {l.material ? pathLabel(l.material.path, locale, !l.material.outside) : `${l.legacy?.category} › ${l.legacy?.subCategory}`}
            {l.material?.outside && <StatusPill tone="warn" className="ms-1.5 text-[10px]">{tm("outside_badge")}</StatusPill>}
          </button>
        </>
      ) : (
        <>
          <p className="px-1 text-sm font-semibold" dir="auto">{l.name}</p>
          <Button type="button" size="sm" variant="outline" className={cn("h-7 text-xs", bad && "border-destructive text-destructive")} onClick={() => setBrowse({ groupKey: g.key, lineKey: l.key, query: l.name, freeText: null })}>
            {t("pick_material")}
          </Button>
        </>
      )}
    </div>
  )

  const qtyCell = (g: EditorGroup, l: EditorLine, bad: boolean) => (
    <Input
      inputMode="decimal"
      value={l.quantity}
      onChange={(e) => onChange(updateLine(groups, g.key, l.key, { quantity: e.target.value }))}
      aria-label={t("col_quantity")}
      aria-invalid={bad || undefined}
      className={cn("h-9 w-24 text-end tabular-nums", bad && "border-destructive")}
      dir="ltr"
    />
  )

  const unitCell = (g: EditorGroup, l: EditorLine, bad: boolean) => {
    const units = l.material && index && !l.material.outside ? unitsOf(index, l.material.nodeId) : []
    const note = unitNote(l, index)
    const conv = note && index && l.material ? unitConversion(toAmount(l.quantity), l.unit, units[0], l.material.specs.map((s) => s.value)) : null
    return (
      <div className="space-y-0.5">
        {units.length > 1 && !l.unitFromSource ? (
          <NativeSelect value={l.unit} onChange={(e) => onChange(updateLine(groups, g.key, l.key, { unit: e.target.value }))} aria-label={t("col_unit")} className={cn("h-9 w-24", bad && "border-destructive")}>
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
          <Input value={l.unit} onChange={(e) => onChange(updateLine(groups, g.key, l.key, { unit: e.target.value }))} aria-label={t("col_unit")} className={cn("h-9 w-24", bad && "border-destructive")} dir="auto" />
        )}
        {note && (
          <p className="max-w-[10rem] text-[10.5px] leading-snug text-amber-700">
            {conv ? t("unit_conv", { qty: toAmount(l.quantity).toLocaleString("en-US"), unit: l.unit, per: conv.per, total: conv.quantity.toLocaleString("en-US"), target: label(conv.unit, locale) }) : t("unit_kept", { units: note.units.join(" · ") })}
          </p>
        )}
      </div>
    )
  }

  const problemText = (codes: string[], no: number | undefined) => (codes.length && no ? <p className="text-[11px] font-semibold text-destructive">{codes.map((c) => t(`err_${c}`, { no })).join(" · ")}</p> : null)

  return (
    <div className="space-y-5">
      {/* Desktop column heads */}
      <div className="hidden grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,1.6fr)_6.5rem_7rem_2.5rem] gap-3 px-3 text-xs font-semibold text-muted-foreground md:grid">
        <span />
        <span>{t("col_material")}</span>
        <span>{t("col_specs")}</span>
        <span className="text-end">{t("col_quantity")}</span>
        <span>{t("col_unit")}</span>
        <span />
      </div>

      {groups.map((g) => {
        const lines = g.lines
        const placeBad = showProblems && problems.some((p) => p.groupKey === g.key && p.code === "no_place")
        const site = g.siteId ? sites.find((s) => s.id === g.siteId) : null
        const locked = !!lockedProjectId && g.projectId === lockedProjectId
        return (
          <section key={g.key} className="overflow-hidden rounded-xl border bg-card" aria-label={g.label || t("group_unnamed")}>
            <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-muted/40 px-3 py-2.5">
              <MapPin size={15} className="shrink-0 text-module" aria-hidden="true" />
              {locked || g.requestRefs.length ? (
                <b className="text-sm">{g.label || site?.name}</b>
              ) : (
                <NativeSelect value={g.siteId || ""} onChange={(e) => setGroupSite(g, e.target.value)} aria-label={t("group_place")} className="h-9 min-w-[12rem] max-w-full text-sm font-semibold">
                  <option value="">{t("group_place_pick")}</option>
                  {sites.filter((s) => !s.retired).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
              {g.city ? (
                <span className="text-xs text-muted-foreground">{siteLine(g, (c) => displayCity(c, locale))}</span>
              ) : (
                <span className="flex flex-wrap items-center gap-1.5">
                  <NativeSelect value="" onChange={(e) => setGroup(g, { city: e.target.value })} aria-label={t("group_city")} className={cn("h-8 text-xs", placeBad && "border-destructive")}>
                    <option value="">{t("group_city_pick")}</option>
                    {SAUDI_CITIES.map((c) => (
                      <option key={c} value={c}>
                        {displayCity(c, locale)}
                      </option>
                    ))}
                  </NativeSelect>
                </span>
              )}
              {g.city && !g.district && (
                <Input value={g.district} onChange={(e) => setGroup(g, { district: e.target.value })} placeholder={t("group_district")} aria-label={t("group_district")} className="h-8 w-36 text-xs" dir="auto" />
              )}
              {g.requestRefs.map((r) => (
                <StatusPill key={r} tone="info" className="text-[11px]">
                  {t("from_request", { ref: r })}
                </StatusPill>
              ))}
              <label className="ms-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                {t("need_by")}
                <Input type="date" value={g.needBy || ""} onChange={(e) => setGroup(g, { needBy: e.target.value || null })} className="h-8 w-36 text-xs" dir="ltr" />
              </label>
              {groups.length > 1 && !lines.some(lineStarted) && (
                <IconButton label={t("remove_group")} icon={Trash2} iconSize={14} onClick={() => onChange(removeGroup(groups, g.key))} />
              )}
            </header>
            {placeBad && <p className="px-3 pt-2 text-[11px] font-semibold text-destructive">{t("err_no_place")}</p>}

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
                        {l.material ? <MaterialSpecCells index={index} pick={l.material} onChange={(m) => onChange(updateLine(groups, g.key, l.key, { material: m }))} /> : <span className="text-xs text-muted-foreground">—</span>}
                        {l.needBy != null && (
                          <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {t("line_need_by")}
                            <Input type="date" value={l.needBy || ""} onChange={(e) => onChange(updateLine(groups, g.key, l.key, { needBy: e.target.value }))} className="h-7 w-36 text-xs" dir="ltr" />
                          </label>
                        )}
                        {l.requiresWarranty && <StatusPill tone="info" className="mt-1.5 text-[10px]">{t("warranty")}</StatusPill>}
                      </div>
                      <div className="flex justify-end">{qtyCell(g, l, codes.includes("quantity"))}</div>
                      {unitCell(g, l, codes.includes("unit"))}
                      {rowMenu(g, l)}
                    </div>
                    {/* Phone card: the row's order, stacked */}
                    <div className="space-y-2 md:hidden">
                      <div className="flex items-start gap-2">
                        <span className="pt-2 text-xs tabular-nums text-muted-foreground">{no}</span>
                        <div className="min-w-0 flex-1">{materialCell(g, l, codes.includes("material"))}</div>
                        {rowMenu(g, l)}
                      </div>
                      {l.material && <MaterialSpecCells index={index} pick={l.material} onChange={(m) => onChange(updateLine(groups, g.key, l.key, { material: m }))} />}
                      <div className="flex items-start gap-2">
                        {qtyCell(g, l, codes.includes("quantity"))}
                        {unitCell(g, l, codes.includes("unit"))}
                      </div>
                    </div>
                    {problemText(codes, no)}
                  </li>
                )
              })}
              <li className="px-3 py-2.5">
                <MaterialSearchInput
                  index={index}
                  onPick={(hit) => fillFromHit(g.key, null, hit)}
                  onBrowse={(q) => setBrowse({ groupKey: g.key, lineKey: null, query: q, freeText: null })}
                  onFreeText={(text) => setBrowse({ groupKey: g.key, lineKey: null, query: "", freeText: text })}
                />
              </li>
            </ul>
          </section>
        )
      })}

      {!lockedProjectId && (
        <Button type="button" variant="outline" className="gap-2" onClick={() => onChange([...groups, { key: `g${Date.now().toString(36)}`, siteId: null, projectId: null, label: "", city: "", district: "", needBy: null, requestRefs: [], lines: [] }])}>
          <Plus size={15} /> {t("add_group")}
        </Button>
      )}

      <MaterialBrowserDialog
        open={!!browse}
        onOpenChange={(o) => !o && setBrowse(null)}
        index={index}
        initialQuery={browse?.query || ""}
        freeText={browse?.freeText ?? null}
        target={browse?.lineKey ? t("row_no", { no: numbers.get(browse.lineKey) || "" }) : undefined}
        onAdd={(r) => {
          if (!browse) return
          place(browse.groupKey, browse.lineKey, r.pick, r.unit, r.name, r.repeat)
          setBrowse(null)
        }}
      />
    </div>
  )
}

