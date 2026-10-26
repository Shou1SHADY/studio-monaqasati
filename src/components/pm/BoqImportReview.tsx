"use client"

// The review window's body — the same for a file as received, the Mdmak template and items typed
// by hand (BOQ Import PM 1.0): what was read, the reconciliation (items → file total → award value),
// the lines with their yellow questions settled on the line, and every row that was left out.

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, Check, ChevronDown, ChevronUp, Clock, FileSpreadsheet, Pencil, Plus, Scale, Undo2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Callout } from "@/components/module-ui/Callout"
import { Chip } from "@/components/module-ui/Chip"
import { DataTable, type DataColumn } from "@/components/module-ui/DataTable"
import { IconButton } from "@/components/module-ui/IconButton"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useTableLabels } from "@/hooks/useTableLabels"
import { sarLtr } from "@/lib/riyal"
import {
  acknowledge,
  addItem,
  addSection,
  amountOf,
  chooseCalculated,
  chooseFileAmount,
  createSection,
  descriptionIn,
  descriptionOther,
  editItem,
  liveItems,
  moveToSection,
  needs,
  nextSectionKey,
  numIn,
  reconcile,
  removeItem,
  renameSection,
  restoreItem,
  sectionLabel,
  setQuantity,
  setRate,
  skippedList,
  summarize,
  unitLabel,
  type ReviewItem,
  type ReviewSection,
  type ReviewState,
  type SkippedEntry,
} from "@/lib/pm/boq-import"
import { BOQ_UNITS } from "@/lib/boq-import"
import type { AwardMatch } from "@/lib/boq-import"
import { cn } from "@/lib/utils"

export type ReviewUpdate = (fn: (s: ReviewState) => ReviewState) => void

const NS = "Portal.PmBoqImport"
const fm = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US")
const fq = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-US")
const money = (n: number) => sarLtr(fm(n))
const LATIN = /[A-Za-z]/

export function ReviewFileBar({ state, onAnother, onUpload }: { state: ReviewState; onAnother: () => void; onUpload: () => void }) {
  const t = useTranslations(NS)
  if (state.mode === "file" && state.file) {
    const f = state.file
    const size = f.size > 1048576 ? t("bar.mb", { n: (f.size / 1048576).toFixed(1) }) : t("bar.kb", { n: Math.max(1, Math.round(f.size / 1024)) })
    const bits = [size, f.sheets > 1 ? t("bar.sheets", { used: f.used, total: f.sheets }) : null, f.enc && f.enc !== "UTF-8" ? f.enc : null, f.eu ? t("bar.eu") : null].filter(Boolean)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm">
        <FileSpreadsheet size={16} className="shrink-0 text-module" aria-hidden="true" />
        <b dir="auto" className="min-w-0 break-all">
          {f.name}
        </b>
        <span className="text-xs text-muted-foreground">{bits.join(" · ")}</span>
        <Button type="button" variant="link" size="sm" className="ms-auto h-9 px-1 max-md:h-11" onClick={onAnother}>
          {t("bar.another")}
        </Button>
      </div>
    )
  }
  const editing = state.mode === "edit"
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm">
      <Pencil size={16} className="shrink-0 text-module" aria-hidden="true" />
      <b>{state.file?.name ?? t("bar.manual_name")}</b>
      <span className="text-xs text-muted-foreground">{editing ? t("bar.editing") : t("bar.none")}</span>
      {!editing && (
        <Button type="button" variant="link" size="sm" className="ms-auto h-9 px-1 max-md:h-11" onClick={onUpload}>
          {t("bar.upload_instead")}
        </Button>
      )}
    </div>
  )
}

export function ReviewNotes({ state }: { state: ReviewState }) {
  const t = useTranslations(NS)
  if (state.mode === "edit") return null
  return (
    <>
      <Callout tone="info" title={state.mode === "manual" ? t("note.manual_title") : t("note.review_title")}>
        {state.mode === "manual" ? t("note.manual_body") : t("note.review_body")}
      </Callout>
      {state.guess.length > 0 && (
        <Callout tone="warn">
          {state.guess.map((g) => (
            <span key={g.sheet} className="me-1">
              {t(g.how === "content" ? "note.guess_content" : "note.guess_swap", { sheet: g.sheet })}
            </span>
          ))}
          {t("note.guess_check")}
        </Callout>
      )}
    </>
  )
}

function MatchLine({ tone, children }: { tone: "ok" | "warn" | "none"; children: ReactNode }) {
  const Icon = tone === "ok" ? Check : tone === "warn" ? AlertTriangle : Clock
  return (
    <li className={cn("flex items-start gap-1.5 text-xs", tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : "text-muted-foreground")}>
      <Icon size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span className="text-foreground">{children}</span>
    </li>
  )
}

export function awardSentence(t: ReturnType<typeof useTranslations>, award: AwardMatch): string {
  const pct = award.pct < 0.1 ? t("match.pct_tiny") : `${award.pct.toFixed(1)}%`
  return t(award.d < 0 ? "match.award_below" : "match.award_above", { diff: money(Math.abs(award.d)), pct })
}

export function ReviewMatch({ state, awardValue }: { state: ReviewState; awardValue: number | null }) {
  const t = useTranslations(NS)
  const s = summarize(state)
  if (s.n === 0) return null
  const r = reconcile(state, awardValue)
  if (r.unpriced)
    return (
      <div role="status" className="flex gap-2.5 rounded-xl border bg-muted/40 px-3.5 py-3 text-sm">
        <Scale size={17} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <b>{t("match.unpriced_title")}</b>
          <p className="text-xs text-muted-foreground">{awardValue ? t("match.unpriced_award", { value: money(awardValue) }) : t("match.unpriced_plain")}</p>
        </div>
      </div>
    )
  const where = r.file ? (r.file.grand.sheets ? t("match.where_sheets", { count: r.file.grand.sheets }) : t("match.where_row", { sheet: r.file.grand.sheet ?? "", row: r.file.grand.row ?? 0 })) : ""
  const award = r.award
  return (
    <div role="status" className={cn("flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm", r.green ? "border-success/25 bg-success/5" : "border-warning/25 bg-warning/5")}>
      <Scale size={17} className={cn("mt-0.5 shrink-0", r.green ? "text-success" : "text-warning")} aria-hidden="true" />
      <div className="min-w-0">
        <b>
          {t("match.total")} <bdi dir="ltr">{money(r.sum)}</bdi>
        </b>
        <ul className="mt-1 space-y-0.5">
          {state.mode === "file" &&
            (r.file ? (
              <MatchLine tone={r.file.ok ? "ok" : "warn"}>
                {r.file.ok
                  ? t("match.file_ok", { where })
                  : t(r.file.yellow ? "match.file_diff_yellow" : "match.file_diff", { value: money(r.file.grand.v), where, diff: fm(r.file.diff) })}
              </MatchLine>
            ) : (
              <MatchLine tone="none">{t("match.file_none")}</MatchLine>
            ))}
          {award ? (
            <MatchLine tone={award.ok ? "ok" : "warn"}>
              {award.ok ? t("match.award_ok") : `${awardSentence(t, award)}${t("match.warn_only")}`}
            </MatchLine>
          ) : (
            <MatchLine tone="none">{t("match.award_none")}</MatchLine>
          )}
        </ul>
      </div>
    </div>
  )
}

export function ReviewSummary({ state, needsOnly, onNeedsOnly }: { state: ReviewState; needsOnly: boolean; onNeedsOnly: () => void }) {
  const t = useTranslations(NS)
  const s = summarize(state)
  const items = t("items_count", { count: s.n })
  const sections = t("sections_count", { count: s.sections })
  return (
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      <b className="text-sm">{t(state.mode === "file" ? "summary.read" : "summary.entered", { items, sections })}</b>
      <StatusPill tone="ok">
        <Check size={11} aria-hidden="true" />
        {t("summary.ready", { count: s.ready })}
      </StatusPill>
      {s.need > 0 && <StatusPill tone="warn">{t("summary.need", { count: s.need })}</StatusPill>}
      {s.unpriced > 0 && s.unpriced < s.n && <StatusPill tone="mute">{t("summary.unpriced", { count: s.unpriced })}</StatusPill>}
      {s.need > 0 && (
        <Chip selected={needsOnly} onClick={onNeedsOnly} className="ms-auto">
          {t("summary.only_need")}
        </Chip>
      )}
    </div>
  )
}

const shown = (v: number | null, decimals: number) => (v == null ? "" : String(Math.round(v * 10 ** decimals) / 10 ** decimals))

function NumberField({ value, onValue, label, placeholder, need, decimals }: { value: number | null; onValue: (text: string) => void; label: string; placeholder: string; need?: boolean; decimals: number }) {
  const [text, setText] = useState(shown(value, decimals))
  useEffect(() => {
    setText((cur) => (numIn(cur) === value ? cur : shown(value, decimals)))
  }, [value, decimals])
  return (
    <Input
      dir="ltr"
      inputMode="decimal"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      aria-invalid={need || undefined}
      className={cn("h-10 w-24 px-2 text-end tabular-nums max-md:h-11", need && "border-warning ring-1 ring-warning")}
      onChange={(e) => {
        setText(e.target.value)
        onValue(e.target.value)
      }}
    />
  )
}

function YellowNotes({ R, update }: { R: ReviewItem; update: ReviewUpdate }) {
  const t = useTranslations(NS)
  const locale = useLocale()
  const need = needs(R)
  if (!need.length) return null
  const note = (key: string, vars?: Record<string, string | number>) => <span className="text-xs font-semibold text-warning">{t(key, vars)}</span>
  const act = (label: string, fn: () => void) => (
    <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs max-md:h-11" onClick={fn}>
      {label}
    </Button>
  )
  const peers = (R.dupOf ?? []).filter((r): r is number => r != null)
  return (
    <div className="mt-1.5 space-y-1.5">
      {need.includes("nodesc") && <div>{note("yellow.nodesc")}</div>}
      {need.includes("noqty") && <div>{R.manual ? note("yellow.noqty_manual") : R.qText ? note("yellow.noqty_text", { text: R.qText }) : note("yellow.noqty_file")}</div>}
      {need.includes("mismatch") && (
        <div className="flex flex-wrap items-center gap-1.5">
          {note("yellow.mismatch", { file: fm(R.amtW ?? 0), calc: fm((R.qty ?? 0) * (R.rate ?? 0)) })}
          {act(t("yellow.use_calc"), () => update((s) => chooseCalculated(s, R.id)))}
          {R.amtW != null && R.qty ? act(t("yellow.use_file", { rate: fm(R.amtW / R.qty) }), () => update((s) => chooseFileAmount(s, R.id))) : null}
        </div>
      )}
      {need.includes("dup") && (
        <div className="flex flex-wrap items-center gap-1.5">
          {peers.length ? note("yellow.dup_rows", { code: R.code, rows: peers.join(locale === "ar" ? "، " : ", ") }) : note("yellow.dup_lines", { code: R.code })}
          {act(t("yellow.dup_ack"), () => update((s) => acknowledge(s, R.id, "dup")))}
        </div>
      )}
      {need.includes("neg") && (
        <div className="flex flex-wrap items-center gap-1.5">
          {note("yellow.neg")}
          {act(t("yellow.neg_ack"), () => update((s) => acknowledge(s, R.id, "neg")))}
        </div>
      )}
      {need.includes("comma") && (
        <div className="flex flex-wrap items-center gap-1.5">
          {note("yellow.comma", { qty: fq(R.qty ?? 0) })}
          {act(t("yellow.comma_ack"), () => update((s) => acknowledge(s, R.id, "comma")))}
        </div>
      )}
    </div>
  )
}

function Tags({ R, state, anyRate }: { R: ReviewItem; state: ReviewState; anyRate: boolean }) {
  const t = useTranslations(NS)
  const sec = state.sections.find((s) => s.key === R.sec)
  const tags = [
    R.rate == null && anyRate ? t("tag.unpriced") : null,
    R.incl ? t("tag.included") : null,
    R.sumOnly ? t("tag.sum_only") : null,
    R.prov ? t("tag.prov") : null,
    R.pct ? t("tag.pct") : null,
    R.rateFromAmt ? t("tag.rate_from_amount") : null,
    R.cont ? t("tag.cont") : null,
    R.edited && !R.manual && state.mode !== "edit" ? t("tag.edited") : null,
    sec?.renamed && !sec.user ? t("tag.sec_renamed") : null,
    R.choice === "file" ? t("tag.choice_file") : null,
    R.choice === "calc" ? t("tag.choice_calc") : null,
  ].filter((x): x is string => !!x)
  if (!tags.length) return null
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {tags.map((x) => (
        <i key={x} className="rounded-full bg-muted px-2 py-0.5 text-[11px] not-italic text-muted-foreground">
          {x}
        </i>
      ))}
    </span>
  )
}

function EditForm({ R, state, update, onDone, onNewSection }: { R: ReviewItem; state: ReviewState; update: ReviewUpdate; onDone: () => void; onNewSection: (key: string) => void }) {
  const t = useTranslations(NS)
  const locale = useLocale()
  const multi = new Set(state.items.map((x) => x.sheet)).size > 1
  const showAlt = !!R.alt || !LATIN.test(R.desc)
  const origin =
    R.row == null && state.mode !== "edit"
      ? t("edit.origin_hand")
      : state.mode === "file"
        ? R.src0
          ? t("edit.origin_file_was", { sheet: R.sheet, row: R.row ?? 0, was: R.src0 })
          : t("edit.origin_file", { sheet: R.sheet, row: R.row ?? 0 })
        : R.src0
          ? t("edit.origin_current_was", { was: R.src0 })
          : t("edit.origin_current")
  const id = `bi-${R.id}`
  const label = (s: ReviewSection) => `${sectionLabel(s)}${multi && s.sheet ? ` — ${s.sheet}` : ""}`
  return (
    <div className="mt-2 grid grid-cols-1 gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor={`${id}-code`}>{t("edit.code")}</Label>
        <Input id={`${id}-code`} dir="ltr" value={R.code} onChange={(e) => update((s) => editItem(s, R.id, { code: e.target.value }))} />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${id}-unit`}>{t("edit.unit")}</Label>
        <Input id={`${id}-unit`} dir="auto" list="boq-import-units" value={R.unit} onChange={(e) => update((s) => editItem(s, R.id, { unit: e.target.value }))} />
      </div>
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${id}-desc`}>{t("edit.desc")}</Label>
        <Textarea id={`${id}-desc`} dir="auto" rows={2} value={R.desc} onChange={(e) => update((s) => editItem(s, R.id, { desc: e.target.value }))} />
      </div>
      {showAlt && (
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`${id}-alt`}>
            {t("edit.alt")} <small className="text-muted-foreground">({t("edit.optional")})</small>
          </Label>
          <Textarea id={`${id}-alt`} dir="auto" rows={2} value={R.alt} onChange={(e) => update((s) => editItem(s, R.id, { alt: e.target.value }))} />
        </div>
      )}
      <div className="space-y-1 sm:col-span-2">
        <Label htmlFor={`${id}-sec`}>{t("edit.section")}</Label>
        <NativeSelect
          id={`${id}-sec`}
          className="w-full max-md:h-11"
          value={R.sec ?? ""}
          onChange={(e) => {
            const v = e.target.value
            if (v === "__new") {
              onNewSection(nextSectionKey(state))
              update((s) => {
                const c = createSection(s, t("table.new_section"))
                return moveToSection(c.state, R.id, c.section)
              })
            } else update((s) => moveToSection(s, R.id, v || null))
          }}
        >
          <option value="">{t("table.no_section")}</option>
          {state.sections.map((s) => (
            <option key={s.key} value={s.key}>
              {label(s)}
            </option>
          ))}
          <option value="__new">{t("edit.new_section")}</option>
        </NativeSelect>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
        <span className="text-xs text-muted-foreground" dir={locale === "ar" ? "rtl" : "ltr"}>
          {origin}
        </span>
        <Button type="button" size="sm" className="max-md:h-11" onClick={onDone}>
          {t("edit.done")}
        </Button>
      </div>
    </div>
  )
}

function SectionHead({ section, multi, editing, update, onEdit, onDone }: { section: ReviewSection; multi: boolean; editing: boolean; update: ReviewUpdate; onEdit: () => void; onDone: () => void }) {
  const t = useTranslations(NS)
  if (editing)
    return (
      <span className="flex flex-wrap items-center gap-2 font-normal">
        <Input aria-label={t("table.sec_code")} dir="ltr" className="h-10 w-24 max-md:h-11" placeholder={t("table.sec_code")} value={section.code} onChange={(e) => update((s) => renameSection(s, section.key, { code: e.target.value }))} />
        <Input aria-label={t("table.sec_name")} dir="auto" className="h-10 min-w-48 flex-1 max-md:h-11" placeholder={t("table.sec_name")} value={section.text} onChange={(e) => update((s) => renameSection(s, section.key, { text: e.target.value }))} />
        <Button type="button" size="sm" variant="outline" className="max-md:h-11" onClick={onDone}>
          {t("table.rename_done")}
        </Button>
      </span>
    )
  return (
    <span className="flex flex-wrap items-center gap-2 font-normal">
      <b dir="auto" className="text-foreground">
        {sectionLabel(section)}
      </b>
      {multi && section.sheet && (
        <span className="text-xs text-muted-foreground">
          {t("table.sheet")} «{section.sheet}»
        </span>
      )}
      <Button type="button" variant="link" size="sm" className="h-9 gap-1 px-1 text-xs max-md:h-11" onClick={onEdit}>
        <Pencil size={12} aria-hidden="true" />
        {t("table.rename")}
      </Button>
    </span>
  )
}

function SkippedPanel({ state, multi, open, onToggle, update }: { state: ReviewState; multi: boolean; open: boolean; onToggle: () => void; update: ReviewUpdate }) {
  const t = useTranslations(NS)
  const locale = useLocale()
  const list = skippedList(state)
  if (!list.length) return null
  const sheets = list.filter((x) => x.row == null && x.kind !== "removed").length
  const rows = list.length - sheets
  const parts = { rows: rows ? t("skip.rows_n", { count: rows }) : "", sheets: sheets ? t("skip.sheets_n", { count: sheets }) : "" }
  const head = rows && sheets ? t("skip.head_both", parts) : rows ? t("skip.head_rows", parts) : t("skip.head_sheets", parts)
  const reasons = Array.from(new Set(list.map((x) => t(`skip.${x.kind}`)))).slice(0, 5)
  const text = (x: SkippedEntry) => (x.kind === "hdr2" ? t("skip.header_row") : (x.text ?? "—"))
  return (
    <div className="space-y-2 rounded-xl border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="link" size="sm" className="h-9 gap-1 px-1 max-md:h-11" aria-expanded={open} onClick={onToggle}>
          {open ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
          {head}
        </Button>
        <span className="text-xs text-muted-foreground">{reasons.join(locale === "ar" ? "، " : ", ")}</span>
      </div>
      {open && (
        <ul className="space-y-1 text-xs">
          {list.map((x, i) => (
            <li key={`${x.kind}-${x.sheet}-${x.row ?? "s"}-${i}`} className="flex flex-wrap items-center gap-1.5">
              <span className="min-w-8 rounded bg-muted px-1.5 text-center tabular-nums text-muted-foreground">{x.row == null ? (x.kind === "removed" ? "+" : t("skip.sheet")) : x.row}</span>
              <bdi dir="auto">«{x.row == null && x.kind !== "removed" ? x.sheet : text(x)}»</bdi>
              {x.row != null && multi && <span className="text-muted-foreground">· {x.sheet}</span>}
              <span className="text-muted-foreground">
                — {t(`skip.${x.kind}`)}
                {x.amt != null && x.kind !== "vat" ? ` (${fm(x.amt)})` : ""}
              </span>
              {x.kind === "removed" && x.id && (
                <Button type="button" variant="link" size="sm" className="h-8 gap-1 px-1 text-xs max-md:h-11" onClick={() => update((s) => restoreItem(s, x.id as string))}>
                  <Undo2 size={12} aria-hidden="true" />
                  {t("skip.back")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ReviewBody({ state, update, awardValue, onAnother, onUpload }: { state: ReviewState; update: ReviewUpdate; awardValue: number | null; onAnother: () => void; onUpload: () => void }) {
  const t = useTranslations(NS)
  const locale = useLocale()
  const labels = useTableLabels()
  const [editId, setEditId] = useState<string | null>(null)
  const [secEdit, setSecEdit] = useState<string | null>(null)
  const [showSkipped, setShowSkipped] = useState(false)
  const [needsOnly, setNeedsOnly] = useState(false)

  const live = useMemo(() => liveItems(state), [state])
  const anyRate = live.some((R) => R.rate != null)
  const multi = new Set(state.items.map((R) => R.sheet)).size > 1
  const rows = needsOnly ? live.filter((R) => needs(R).length > 0) : live
  const sectionsShown = live.some((R) => R.sec != null)
  const sectionOf = (key: string | null) => state.sections.find((s) => s.key === key) ?? null
  const anyNeed = live.some((R) => needs(R).length > 0)
  useEffect(() => {
    if (needsOnly && !anyNeed) setNeedsOnly(false)
  }, [needsOnly, anyNeed])

  const columns: DataColumn<ReviewItem>[] = [
    { key: "row", header: t("table.row"), cardHidden: true, className: "w-10 text-muted-foreground", cell: (R) => <span className="tabular-nums">{R.row == null ? "+" : R.row}</span> },
    { key: "code", header: t("table.code"), className: "whitespace-nowrap", cell: (R) => <bdi dir="ltr">{R.code || "—"}</bdi> },
    {
      key: "item",
      header: t("table.item"),
      className: "min-w-64",
      cell: (R) => {
        const main = descriptionIn(R, locale)
        const other = descriptionOther(R, locale)
        return (
          <div className="min-w-0">
            <b dir="auto" className="block break-words">
              {main || <span className="text-xs font-normal text-muted-foreground">{t("table.new_item")}</span>}
            </b>
            {other && (
              <small dir="auto" className="block break-words text-xs font-normal text-muted-foreground">
                {other}
              </small>
            )}
            <Tags R={R} state={state} anyRate={anyRate} />
            <YellowNotes R={R} update={update} />
            {editId === R.id && <EditForm R={R} state={state} update={update} onDone={() => setEditId(null)} onNewSection={setSecEdit} />}
          </div>
        )
      },
    },
    { key: "unit", header: t("table.unit"), cell: (R) => <span dir="auto">{R.unit ? unitLabel(R.unit, locale) : "—"}</span> },
    {
      key: "qty",
      header: t("table.qty"),
      numeric: true,
      cell: (R) => <NumberField value={R.qty} label={`${t("table.qty")} — ${descriptionIn(R, locale) || t("table.new_item")}`} placeholder={t("table.qty_ph")} need={needs(R).includes("noqty")} decimals={3} onValue={(v) => update((s) => setQuantity(s, R.id, v))} />,
    },
    {
      key: "rate",
      header: t("table.rate"),
      numeric: true,
      cell: (R) => <NumberField value={R.rate} label={`${t("table.rate")} — ${descriptionIn(R, locale) || t("table.new_item")}`} placeholder={t("table.rate_ph")} decimals={2} onValue={(v) => update((s) => setRate(s, R.id, v))} />,
    },
    { key: "amount", header: t("table.amount"), numeric: true, cell: (R) => (R.qty != null && R.rate != null ? fm(amountOf(R)) : "—") },
    {
      key: "actions",
      header: <span className="sr-only">{t("table.actions")}</span>,
      label: t("table.actions"),
      cell: (R) => (
        <span className="flex items-center justify-end gap-1">
          <IconButton label={t("table.edit_item")} icon={Pencil} iconSize={14} onClick={() => setEditId(editId === R.id ? null : R.id)} />
          <IconButton label={t("table.remove_item")} icon={X} iconSize={14} onClick={() => update((s) => removeItem(s, R.id))} />
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-3">
      <ReviewFileBar state={state} onAnother={onAnother} onUpload={onUpload} />
      <ReviewNotes state={state} />
      <ReviewMatch state={state} awardValue={awardValue} />
      <ReviewSummary state={state} needsOnly={needsOnly} onNeedsOnly={() => setNeedsOnly((v) => !v)} />
      <DataTable<ReviewItem>
        caption={t("table.caption")}
        columns={columns}
        rows={rows}
        rowKey={(R) => R.id}
        labels={labels}
        cardTitleKey="item"
        dense
        pageSize={100}
        rowTone={(R) => (needs(R).length ? "warn" : undefined)}
        rowGroup={
          sectionsShown && !needsOnly
            ? (R) => {
                const section = sectionOf(R.sec)
                return {
                  key: R.sec ?? "__none",
                  label: section ? (
                    <SectionHead section={section} multi={multi} editing={secEdit === section.key} update={update} onEdit={() => setSecEdit(section.key)} onDone={() => setSecEdit(null)} />
                  ) : (
                    <span>{t("table.no_section")}</span>
                  ),
                }
              }
            : undefined
        }
        empty={<p className="rounded-xl border bg-card px-4 py-6 text-center text-sm text-muted-foreground">{t("table.empty")}</p>}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-md:h-11"
          onClick={() => {
            const created = addSection(state, t("table.new_section"))
            update(() => created.state)
            setSecEdit(created.section)
            setEditId(created.id)
          }}
        >
          <Plus size={14} aria-hidden="true" />
          {t("table.add_section")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="max-md:h-11"
          onClick={() => {
            const created = addItem(state)
            update(() => created.state)
            setEditId(created.id)
          }}
        >
          <Plus size={14} aria-hidden="true" />
          {t("table.add_item")}
        </Button>
      </div>
      <datalist id="boq-import-units">
        {BOQ_UNITS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <SkippedPanel state={state} multi={multi} open={showSkipped} onToggle={() => setShowSkipped((v) => !v)} update={update} />
    </div>
  )
}
