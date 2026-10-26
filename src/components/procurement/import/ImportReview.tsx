"use client"

// The review (IMP 1.3, step 2): two groups — what needs you (yellow), then what is ready — with, under each
// material, what the file said («في ملفك: …»), its section and sheet. Under the list two folded lines: «ليست في قائمة
// المواد» (works, mostly) and «تجاهلنا» (headings, totals…). Nothing changes in the RFQ before «أضِف».

import { useLocale, useTranslations } from "next-intl"
import { Check, ChevronDown, ChevronUp, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { IconButton } from "@/components/module-ui/IconButton"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { cn } from "@/lib/utils"
import { label, pathLabel, pathOf, shortSpecName, unitsOf } from "@/lib/materials/tree"
import type { Matcher } from "@/lib/boq-import/materials-match"
import { ignoredLines, isReady, type ImportRow, type MaterialsRead } from "@/lib/boq-import/materials-read"
import { counts, type ReviewGroups } from "@/lib/boq-import/materials-review"

export type ReviewActions = {
  quantity: (at: number, value: string) => void
  settle: () => void
  unit: (at: number, u: number) => void
  confirmUnit: (at: number) => void
  remove: (at: number) => void
  bring: (at: number) => void
  suggestion: (at: number, nodeId: string) => void
  search: (at: number) => void
  outside: (at: number) => void
}

export function ReviewSummary({ rows, read }: { rows: ImportRow[]; read: MaterialsRead }) {
  const t = useTranslations("Portal.Procurement.import")
  const c = counts(rows)
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm" data-testid="import-summary">
      <b>
        {t("read_items", { count: c.items })}
        {read.sheetsRead.length > 1 ? ` (${t("read_sheets", { count: read.sheetsRead.length })})` : ""}
      </b>
      <StatusPill tone="ok">
        <Check size={12} aria-hidden="true" /> {t("ready_n", { count: c.ready })}
      </StatusPill>
      {c.needYou > 0 && <StatusPill tone="warn">{t("need_n", { count: c.needYou })}</StatusPill>}
      {c.notMaterials > 0 && <StatusPill tone="mute">{t("none_n", { count: c.notMaterials })}</StatusPill>}
    </div>
  )
}

function Source({ r, sheets }: { r: ImportRow; sheets: number }) {
  const t = useTranslations("Portal.Procurement.import")
  const parts = [
    t("in_file", { text: r.text }),
    r.ctx ? t("under", { text: r.ctx }) : "",
    sheets > 1 ? t("on_sheet", { sheet: r.sheet }) : "",
    r.how === "mem" ? t("remembered") : "",
  ].filter(Boolean)
  return (
    <small className="block text-[11px] leading-snug text-muted-foreground" dir="auto">
      {parts.join(" · ")}
    </small>
  )
}

function MaterialCell({ r, at, matcher, sheets, actions }: { r: ImportRow; at: number; matcher: Matcher; sheets: number; actions: ReviewActions }) {
  const t = useTranslations("Portal.Procurement.import")
  const locale = useLocale()
  const index = matcher.index
  if (r.nodeId) {
    const node = index.byId.get(r.nodeId)
    if (node) {
      const chips = [
        ...r.specs.map((s) => ({ k: `${s.spec}.${s.option}`, name: label(shortSpecName(node.specs[s.spec]), locale), value: label(node.specs[s.spec].options[s.option], locale) })),
        ...r.free.map((v, i) => ({ k: `f${i}`, name: t("other_spec"), value: v })),
        ...(r.brand != null && node.brands[r.brand] ? [{ k: "brand", name: t("brand"), value: label(node.brands[r.brand], locale) }] : []),
      ]
      return (
        <div className="min-w-0 space-y-1">
          <b className="block text-sm" dir="auto">
            {label(node, locale)}
          </b>
          <small className="block truncate text-[11px] text-muted-foreground" dir="auto">
            {pathLabel(pathOf(index, node.id).map((p) => ({ ar: p.ar, en: p.en })), locale)}
          </small>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {chips.map((c) => (
                <span key={c.k} className="rounded-md border bg-background px-1.5 py-0.5 text-[11px]">
                  {c.name}: <b dir="auto">{c.value}</b>
                </span>
              ))}
            </div>
          )}
          <Source r={r} sheets={sheets} />
        </div>
      )
    }
  }
  if (r.outside && r.sub) {
    return (
      <div className="min-w-0 space-y-1">
        <b className="flex flex-wrap items-center gap-1.5 text-sm">
          <bdi>{r.name}</bdi>
          <StatusPill tone="warn" className="text-[10px]">
            {t("outside")}
          </StatusPill>
        </b>
        <small className="block truncate text-[11px] text-muted-foreground" dir="auto">
          {pathLabel(pathOf(index, r.sub).map((p) => ({ ar: p.ar, en: p.en })), locale, true)}
        </small>
        <Source r={r} sheets={sheets} />
      </div>
    )
  }
  return (
    <div className="min-w-0 space-y-1">
      <NativeSelect
        className="h-9 w-full max-w-sm text-xs"
        value=""
        aria-label={t("pick_placeholder")}
        onChange={(e) => {
          const v = e.target.value
          if (v === "search") actions.search(at)
          else if (v === "outside") actions.outside(at)
          else if (v) actions.suggestion(at, v)
        }}
      >
        <option value="">{t("pick_placeholder")}</option>
        {r.suggestions.map((id) => (
          <option key={id} value={id}>
            {label(index.byId.get(id) ?? null, locale)}
          </option>
        ))}
        <option value="search">{t("pick_search")}</option>
        <option value="outside">{t("pick_outside")}</option>
      </NativeSelect>
      <Source r={r} sheets={sheets} />
    </div>
  )
}

function UnitCell({ r, at, matcher, actions }: { r: ImportRow; at: number; matcher: Matcher; actions: ReviewActions }) {
  const t = useTranslations("Portal.Procurement.import")
  const locale = useLocale()
  const units = r.nodeId ? unitsOf(matcher.index, r.nodeId) : []
  const bad = r.why.includes("unit")
  const target = units[r.u] ? label(units[r.u], locale) : ""
  const file = [r.qFile, r.unitRaw].filter(Boolean).join(" ")
  const hint = r.conv
    ? { tone: "info", node: t("unit_converted", { file: `${r.conv.q} ${r.conv.u}` }) }
    : bad && r.ask
      ? { tone: "warn", node: t("unit_ask", { file, unit: target }) }
      : bad
        ? {
            tone: "warn",
            node: (
              <>
                {t("unit_unknown", { unit: r.unitRaw })} ·{" "}
                <button type="button" onClick={() => actions.confirmUnit(at)} className="font-semibold text-module underline underline-offset-2">
                  {Number(r.qty) > 0 ? t("unit_yes", { quantity: r.qty, unit: target }) : t("unit_right")}
                </button>
              </>
            ),
          }
        : r.ask && r.qFile
          ? { tone: "info", node: t("unit_in_file", { file }) }
          : null
  return (
    <div className="space-y-1">
      {r.nodeId ? (
        units.length > 1 ? (
          <NativeSelect value={String(r.u)} onChange={(e) => actions.unit(at, Number(e.target.value))} aria-label={t("col_unit")} className={cn("h-9 w-full text-xs", bad && "border-warning")}>
            {units.map((u, i) => (
              <option key={u.key + i} value={i}>
                {label(u, locale)}
              </option>
            ))}
          </NativeSelect>
        ) : (
          <span className={cn("block pt-2 text-sm", bad && "text-warning")}>{target}</span>
        )
      ) : (
        <span className="block pt-2 text-sm" dir="auto">
          {r.unitRaw || "—"}
        </span>
      )}
      {hint && (
        <small className={cn("block text-[11px] leading-snug", hint.tone === "warn" ? "text-warning" : "text-muted-foreground")} dir="auto">
          {hint.node}
        </small>
      )}
    </div>
  )
}

function Row({ r, at, matcher, sheets, actions }: { r: ImportRow; at: number; matcher: Matcher; sheets: number; actions: ReviewActions }) {
  const t = useTranslations("Portal.Procurement.import")
  const locale = useLocale()
  const units = r.nodeId ? unitsOf(matcher.index, r.nodeId) : []
  const ask = r.ask && units[r.u] ? label(units[r.u], locale) : ""
  return (
    <li className={cn("grid items-start gap-x-3 gap-y-2 px-3 py-2.5 md:grid-cols-[2.5rem_minmax(0,1.7fr)_7rem_9.5rem_2.5rem]", !isReady(r) && "bg-warning/5")} data-testid="import-row" data-row={r.row}>
      <span className="pt-2 text-xs tabular-nums text-muted-foreground" aria-label={t("col_row")}>
        {r.row}
      </span>
      <MaterialCell r={r} at={at} matcher={matcher} sheets={sheets} actions={actions} />
      <Input
        inputMode="decimal"
        dir="ltr"
        value={r.qty}
        onChange={(e) => actions.quantity(at, e.target.value)}
        onBlur={actions.settle}
        onKeyDown={(e) => e.key === "Enter" && actions.settle()}
        placeholder={r.ask && ask ? t("qty_ask", { unit: ask }) : t("qty_placeholder")}
        aria-label={t("col_qty")}
        aria-invalid={!(Number(r.qty) > 0) || undefined}
        className={cn("h-9 w-full text-end tabular-nums", !(Number(r.qty) > 0) && "border-warning")}
      />
      <UnitCell r={r} at={at} matcher={matcher} actions={actions} />
      <IconButton label={t("remove")} icon={X} iconSize={14} onClick={() => actions.remove(at)} />
    </li>
  )
}

export function ImportReview({ read, rows, groups, matcher, open, onToggle, actions }: { read: MaterialsRead; rows: ImportRow[]; groups: ReviewGroups; matcher: Matcher; open: Record<string, boolean>; onToggle: (k: string) => void; actions: ReviewActions }) {
  const t = useTranslations("Portal.Procurement.import")
  const g = groups
  const sheets = read.sheetsRead.length
  const ign = ignoredLines(read, rows)
  const byKind = ign.reduce<Record<string, number>>((m, x) => ({ ...m, [x.kind]: (m[x.kind] || 0) + 1 }), {})
  const head = (tone: "warn" | "ok", text: string) => (
    <li className={cn("px-3 py-1.5 text-xs font-bold", tone === "warn" ? "bg-warning/10 text-warning" : "bg-success/10 text-success")}>{text}</li>
  )
  return (
    <div className="space-y-3">
      <ul className="divide-y overflow-hidden rounded-xl border bg-card" data-testid="import-rows">
        <li className="hidden grid-cols-[2.5rem_minmax(0,1.7fr)_7rem_9.5rem_2.5rem] gap-3 bg-muted/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground md:grid">
          <span>{t("col_row")}</span>
          <span>{t("col_material")}</span>
          <span className="text-end">{t("col_qty")}</span>
          <span>{t("col_unit")}</span>
          <span />
        </li>
        {g.need.length > 0 && head("warn", t("group_need", { count: g.need.length }))}
        {g.need.map((at) => (
          <Row key={at} r={rows[at]} at={at} matcher={matcher} sheets={sheets} actions={actions} />
        ))}
        {g.ready.length > 0 && head("ok", t("group_ready", { count: g.ready.length }))}
        {g.ready.map((at) => (
          <Row key={at} r={rows[at]} at={at} matcher={matcher} sheets={sheets} actions={actions} />
        ))}
        {!g.need.length && !g.ready.length && <li className="px-3 py-6 text-center text-sm text-muted-foreground">{t("empty_rows")}</li>}
      </ul>

      {g.none.length > 0 && (
        <div className="rounded-lg border px-3 py-2 text-xs">
          <button type="button" aria-expanded={!!open.none} onClick={() => onToggle("none")} className="flex items-center gap-1 font-semibold text-module">
            {open.none ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
            {t("none_summary", { count: g.none.length })}
          </button>
          <span className="ms-2 text-muted-foreground">
            {g.none
              .slice(0, 3)
              .map((at) => rows[at].text)
              .join("، ")}
            {g.none.length > 3 ? "…" : ""}
          </span>
          {open.none && (
            <ul className="mt-2 space-y-1.5">
              {g.none.map((at) => (
                <li key={at} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="tabular-nums text-muted-foreground">{rows[at].row}</span>
                  <bdi>{rows[at].text}</bdi>
                  <span className="text-muted-foreground">{[rows[at].qty, rows[at].unitRaw].filter(Boolean).join(" ")}</span>
                  <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => actions.search(at)}>
                    {t("none_search")}
                  </Button>
                  ·
                  <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => actions.outside(at)}>
                    {t("none_outside")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {ign.length > 0 && (
        <div className="rounded-lg border px-3 py-2 text-xs">
          <button type="button" aria-expanded={!!open.ign} onClick={() => onToggle("ign")} className="flex items-center gap-1 font-semibold text-module">
            {open.ign ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />}
            {t("skipped", { count: ign.length })}
          </button>
          <span className="ms-2 text-muted-foreground">
            {Object.entries(byKind)
              .map(([k, n]) => `${t(`ign_${k}`)} ${n}`)
              .join(" · ")}
          </span>
          {open.ign && (
            <ul className="mt-2 space-y-1.5">
              {ign.map((x, i) => (
                <li key={`${x.kind}-${x.sheet}-${x.row}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="tabular-nums text-muted-foreground">{x.row ?? ""}</span>
                  <bdi>{x.kind === "hdr2" ? t("header_row") : x.text || x.sheet || "—"}</bdi>
                  <span className="text-muted-foreground">
                    — {t(`ign_${x.kind}`)}
                    {x.sheet && sheets > 1 ? ` · ${x.sheet}` : ""}
                  </span>
                  {x.at != null && (
                    <Button type="button" variant="link" className="h-auto p-0 text-xs" onClick={() => actions.bring(x.at as number)}>
                      {t("bring_back")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
