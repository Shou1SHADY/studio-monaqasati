"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Bookmark, Check, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Chip } from "@/components/module-ui/Chip"
import { staffName, type StaffUser } from "@/hooks/useAdminCrm"
import { LEAD_CHANNELS, NO_LEAD_FILTERS, countLeadFilters, type LeadChannel, type LeadFilters } from "@/lib/admin-crm"
import { cn } from "@/lib/utils"

const trigger = "inline-flex h-10 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-semibold transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

/** ADM-02: every "which ones do I want to see" control in one panel — source, owner, type, last contact, duplicates only. */
export function LeadFiltersButton({ value, onApply, staff }: { value: LeadFilters; onApply: (f: LeadFilters) => void; staff: StaffUser[] }) {
  const t = useTranslations("Portal.Admin.Crm")
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<LeadFilters>(value)
  const n = countLeadFilters(value)
  const set = <K extends keyof LeadFilters>(k: K, v: LeadFilters[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const pick = <K extends "owner" | "kind" | "contact">(k: K, v: LeadFilters[K]) => setDraft((d) => ({ ...d, [k]: d[k] === v ? ("" as LeadFilters[K]) : v }))

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(value)
        setOpen(o)
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" className={cn(trigger, n > 0 && "border-primary text-primary")}>
          <SlidersHorizontal size={15} aria-hidden="true" />
          {t("filters")}
          {n > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] text-primary-foreground tabular-nums">{n}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,92vw)] space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-black">{t("filters")}</p>
          <button type="button" className="text-xs font-semibold text-cta hover:underline" onClick={() => setDraft(NO_LEAD_FILTERS)}>
            {t("filters_clear")}
          </button>
        </div>
        <Group label={t("col_source")}>
          {LEAD_CHANNELS.map((c: LeadChannel) => {
            const on = draft.channels.includes(c)
            return (
              <Chip key={c} selected={on} icon={on ? Check : undefined} onClick={() => set("channels", on ? draft.channels.filter((x) => x !== c) : [...draft.channels, c])}>
                {t(`channel_${c}`)}
              </Chip>
            )
          })}
        </Group>
        <Group label={t("owner_label")}>
          <Chip selected={draft.owner === "me"} onClick={() => pick("owner", "me")}>{t("filter_me")}</Chip>
          <Chip selected={draft.owner === "none"} onClick={() => pick("owner", "none")}>{t("filter_unowned")}</Chip>
          {staff.map((s) => (
            <Chip key={s.id} selected={draft.owner === s.id} onClick={() => pick("owner", s.id)}>
              {staffName(s)}
            </Chip>
          ))}
        </Group>
        <Group label={t("col_type")}>
          <Chip selected={draft.kind === "contractor"} onClick={() => pick("kind", "contractor")}>{t("kind_contractor")}</Chip>
          <Chip selected={draft.kind === "supplier"} onClick={() => pick("kind", "supplier")}>{t("kind_supplier")}</Chip>
        </Group>
        <Group label={t("last_contact")}>
          <Chip selected={draft.contact === "never"} onClick={() => pick("contact", "never")}>{t("contact_never")}</Chip>
          <Chip selected={draft.contact === "over7"} onClick={() => pick("contact", "over7")}>{t("contact_over7")}</Chip>
          <Chip selected={draft.contact === "within7"} onClick={() => pick("contact", "within7")}>{t("contact_within7")}</Chip>
        </Group>
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-muted-foreground">{t("data_quality")}</p>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={draft.dupesOnly} onChange={(e) => set("dupesOnly", e.target.checked)} />
            {t("filter_dupes")}
          </label>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              onApply(draft)
              setOpen(false)
            }}
          >
            {t("apply")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            {t("cancel")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Ready-made filter sets — the "Views" button of the toolbar. */
export function LeadViewsButton({ onPick }: { onPick: (f: LeadFilters) => void }) {
  const t = useTranslations("Portal.Admin.Crm")
  const [open, setOpen] = useState(false)
  const views: Array<{ key: string; f: LeadFilters }> = [
    { key: "view_mine", f: { ...NO_LEAD_FILTERS, owner: "me" } },
    { key: "view_unowned", f: { ...NO_LEAD_FILTERS, owner: "none" } },
    { key: "view_silent", f: { ...NO_LEAD_FILTERS, contact: "over7" } },
    { key: "view_never", f: { ...NO_LEAD_FILTERS, contact: "never" } },
    { key: "view_dupes", f: { ...NO_LEAD_FILTERS, dupesOnly: true } },
  ]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className={trigger}>
          <Bookmark size={15} aria-hidden="true" />
          {t("views")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            className="block w-full rounded-md px-3 py-2 text-start text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              onPick(v.f)
              setOpen(false)
            }}
          >
            {t(v.key)}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/** The applied filters, one removable chip each, under the toolbar. */
export function ActiveFilterChips({ value, onChange, staff }: { value: LeadFilters; onChange: (f: LeadFilters) => void; staff: StaffUser[] }) {
  const t = useTranslations("Portal.Admin.Crm")
  const chips: Array<{ key: string; label: string; clear: () => void }> = []
  for (const c of value.channels) chips.push({ key: `c-${c}`, label: `${t("col_source")}: ${t(`channel_${c}`)}`, clear: () => onChange({ ...value, channels: value.channels.filter((x) => x !== c) }) })
  if (value.owner) {
    const label = value.owner === "me" ? t("filter_me") : value.owner === "none" ? t("filter_unowned") : staff.find((s) => s.id === value.owner) ? staffName(staff.find((s) => s.id === value.owner) as StaffUser) : value.owner
    chips.push({ key: "owner", label: `${t("owner_label")}: ${label}`, clear: () => onChange({ ...value, owner: "" }) })
  }
  if (value.kind) chips.push({ key: "kind", label: `${t("col_type")}: ${t(`kind_${value.kind}`)}`, clear: () => onChange({ ...value, kind: "" }) })
  if (value.contact) chips.push({ key: "contact", label: `${t("last_contact")}: ${t(`contact_${value.contact}`)}`, clear: () => onChange({ ...value, contact: "" }) })
  if (value.dupesOnly) chips.push({ key: "dupes", label: t("filter_dupes"), clear: () => onChange({ ...value, dupesOnly: false }) })
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
      {chips.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1 rounded-full border bg-primary/5 py-1 ps-3 pe-1 text-xs font-semibold">
          {c.label}
          <button type="button" aria-label={t("remove_filter")} onClick={c.clear} className="grid h-5 w-5 place-items-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X size={12} aria-hidden="true" />
          </button>
        </span>
      ))}
      <button type="button" className="text-xs font-semibold text-cta hover:underline" onClick={() => onChange(NO_LEAD_FILTERS)}>
        {t("filters_clear_all")}
      </button>
    </div>
  )
}
