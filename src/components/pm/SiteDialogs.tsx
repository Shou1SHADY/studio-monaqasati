"use client"

// The Site sub-tab's forms (WF-19, WF-20): today's report, an obstacle or RFI,
// its answer, an incident and a work permit. Each validates with the same pure
// rule the write runs again; the parent performs the write.

import { useId, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { getDownloadURL, ref, uploadBytes } from "firebase/storage"
import { Check, Loader2, Paperclip, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { SearchableSelect } from "@/components/contractor/SearchableSelect"
import { BlockingReasons } from "@/components/module-ui/BlockingReasons"
import { Callout } from "@/components/module-ui/Callout"
import { useStorage } from "@/firebase/provider"
import { pmDate, todayDay } from "@/lib/pm/format"
import {
  closeObstacleBlocks,
  dailyBlocks,
  INCIDENT_TYPES,
  incidentBlocks,
  OBSTACLE_PARTIES,
  OBSTACLE_TYPES,
  obstacleBlocks,
  permitBlocks,
  type IncidentType,
  type ObstacleParty,
  type ObstacleType,
  type SiteFile,
} from "@/lib/pm/site"
import type { ObstacleInput } from "@/lib/pm/site-writes"
import { cn } from "@/lib/utils"

export interface SiteItem {
  id: string
  code: string
  description: string
}

const intOr = (s: string, fallback: number) => (s.trim() === "" ? fallback : Number(s))

function Chips<T extends string>({ value, options, label, onChange, disabled }: { value: T; options: readonly T[]; label: (v: T) => string; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          disabled={disabled}
          onClick={() => onChange(o)}
          className={cn(
            "min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors hover:border-module/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60",
            value === o ? "border-module bg-module/10 text-module" : "bg-background text-muted-foreground"
          )}
        >
          {label(o)}
        </button>
      ))}
    </div>
  )
}

/** Supporting documents — photos or PDFs, always optional (ATT-01). */
export function SiteFilesField({
  orgId,
  projectId,
  folder,
  value,
  onChange,
  label,
  hint,
  disabled,
}: {
  orgId: string
  projectId: string
  folder: string
  value: SiteFile[]
  onChange: (files: SiteFile[]) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  const t = useTranslations("Portal.PM.site.files")
  const storage = useStorage()
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (!files.length || !storage || !orgId) return
    if (files.some((f) => f.size > 15 * 1024 * 1024)) {
      setError(t("too_big"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const added: SiteFile[] = []
      for (const file of files) {
        const safe = file.name.replace(/[^\w.\-؀-ۿ]+/g, "_")
        const fileRef = ref(storage, `organizations/${orgId}/projects/${projectId}/site/${folder}/${Date.now()}_${safe}`)
        await uploadBytes(fileRef, file, { contentType: file.type })
        added.push({ url: await getDownloadURL(fileRef), name: file.name })
      }
      onChange([...value, ...added])
    } catch (err) {
      console.error(err)
      setError(t("error"))
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {value.length > 0 && (
        <ul className="space-y-1.5">
          {value.map((f, i) => (
            <li key={`${f.url}-${i}`} className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 px-3 py-1.5 text-xs">
              <Check size={13} className="shrink-0 text-success" aria-hidden="true" />
              <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-semibold text-success underline-offset-2 hover:underline" dir="auto">
                {f.name}
              </a>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label={t("remove", { name: f.name })}
                className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        id={id}
        disabled={busy || disabled}
        onClick={() => inputRef.current?.click()}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed bg-background px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-module/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Paperclip size={14} aria-hidden="true" />}
        {busy ? t("uploading") : t("attach")}
      </button>
      <input ref={inputRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => void pick(e.target.files)} />
      {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function Footer({ busy, disabled, onCancel, onSave, label }: { busy: boolean; disabled: boolean; onCancel: () => void; onSave: () => void; label: string }) {
  const t = useTranslations("Portal.PM")
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel} disabled={busy}>
        {t("cancel")}
      </Button>
      <Button disabled={busy || disabled} onClick={onSave}>
        {busy && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
        {label}
      </Button>
    </DialogFooter>
  )
}

type Submit<T> = (values: T) => Promise<boolean>

export function DailyReportDialog({
  open,
  onOpenChange,
  orgId,
  projectId,
  filedToday,
  archived,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  orgId: string
  projectId: string
  filedToday: boolean
  archived: boolean
  onSubmit: Submit<{ labour: number; plant: number; done: string; obstacle: string; files: SiteFile[] }>
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const [labour, setLabour] = useState("")
  const [plant, setPlant] = useState("")
  const [done, setDone] = useState("")
  const [obstacle, setObstacle] = useState("")
  const [files, setFiles] = useState<SiteFile[]>([])
  const [busy, setBusy] = useState(false)
  const values = { labour: intOr(labour, 0), plant: intOr(plant, 0), done, obstacle, files }
  const blocks = dailyBlocks({ archived, done, labour: values.labour, plant: values.plant, filed: filedToday })

  const save = async () => {
    setBusy(true)
    const ok = await onSubmit(values)
    setBusy(false)
    if (ok) {
      setLabour("")
      setPlant("")
      setDone("")
      setObstacle("")
      setFiles([])
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("site.daily.title")}</DialogTitle>
          <DialogDescription>{pmDate(todayDay(), locale)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="day-lab">{t("site.daily.labour")}</Label>
              <Input id="day-lab" type="number" min={0} dir="ltr" inputMode="numeric" placeholder="0" value={labour} onChange={(e) => setLabour(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="day-eq">{t("site.daily.plant")}</Label>
              <Input id="day-eq" type="number" min={0} dir="ltr" inputMode="numeric" placeholder="0" value={plant} onChange={(e) => setPlant(e.target.value)} disabled={busy} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="day-done">
              {t("site.daily.done")} <span className="text-destructive">*</span>
            </Label>
            <Textarea id="day-done" dir="auto" placeholder={t("site.daily.done_ph")} value={done} onChange={(e) => setDone(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="day-obs">{t("site.daily.obstacle")}</Label>
            <Textarea id="day-obs" dir="auto" placeholder={t("site.daily.obstacle_ph")} value={obstacle} onChange={(e) => setObstacle(e.target.value)} disabled={busy} />
            <p className="text-xs leading-relaxed text-muted-foreground">{t("site.daily.obstacle_hint")}</p>
          </div>
          <SiteFilesField orgId={orgId} projectId={projectId} folder="daily" value={files} onChange={setFiles} label={t("site.daily.files")} hint={t("site.daily.files_hint")} disabled={busy} />
          <BlockingReasons title={t("cannot_save")} reasons={blocks.filter((b) => b !== "no_done").map((b) => t(`site.block.${b}`))} />
        </div>
        <Footer busy={busy} disabled={blocks.length > 0} onCancel={() => onOpenChange(false)} onSave={() => void save()} label={t("site.daily.save")} />
      </DialogContent>
    </Dialog>
  )
}

export function ObstacleDialog({
  open,
  onOpenChange,
  items,
  archived,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  items: SiteItem[]
  archived: boolean
  onSubmit: Submit<ObstacleInput>
}) {
  const t = useTranslations("Portal.PM")
  const today = todayDay()
  const [type, setType] = useState<ObstacleType>("rfi")
  const [title, setTitle] = useState("")
  const [party, setParty] = useState<ObstacleParty>("consultant")
  const [partyName, setPartyName] = useState("")
  const [itemIds, setItemIds] = useState<string[]>([])
  const [impact, setImpact] = useState("")
  const [openOn, setOpenOn] = useState(today)
  const [busy, setBusy] = useState(false)
  const known = new Set(items.map((i) => i.id))
  const blocks = obstacleBlocks({ archived, type, title, party, partyName, impact, openOn, itemIds, knownItems: known, today })
  const itemName = (id: string) => {
    const i = items.find((x) => x.id === id)
    return i ? [i.code, i.description].filter(Boolean).join(" · ") : id
  }

  const save = async () => {
    setBusy(true)
    const ok = await onSubmit({ type, title, party, partyName, itemIds, impact, openOn })
    setBusy(false)
    if (ok) {
      setTitle("")
      setPartyName("")
      setItemIds([])
      setImpact("")
      setOpenOn(todayDay())
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("site.obs.new")}</DialogTitle>
          <DialogDescription>{t("site.obs.new_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("site.obs.type_label")}</Label>
            <Chips value={type} options={OBSTACLE_TYPES} label={(v) => t(`site.obs.type.${v}`)} onChange={setType} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="obs-title">
              {t("site.obs.what")} <span className="text-destructive">*</span>
            </Label>
            <Input id="obs-title" dir="auto" placeholder={t("site.obs.what_ph")} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("site.obs.party_label")}</Label>
            <Chips value={party} options={OBSTACLE_PARTIES} label={(v) => t(`site.obs.party.${v}`)} onChange={setParty} disabled={busy} />
            {party !== "none" && (
              <Input dir="auto" aria-label={t("site.obs.party_name")} placeholder={t("site.obs.party_name_ph")} value={partyName} onChange={(e) => setPartyName(e.target.value)} disabled={busy} />
            )}
            {party === "none" && <p className="text-xs text-muted-foreground">{t("site.obs.party_none_hint")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>{t("site.obs.blocks_label")}</Label>
            <SearchableSelect
              value=""
              onChange={(v) => v && !itemIds.includes(v) && setItemIds([...itemIds, v])}
              options={items.filter((i) => !itemIds.includes(i.id)).map((i) => ({ value: i.id, label: itemName(i.id), keywords: i.code }))}
              placeholder={t("site.obs.pick_item")}
              searchPlaceholder={t("site.obs.search_item")}
              noResultsText={t("site.obs.no_item")}
              ariaLabel={t("site.obs.blocks_label")}
              disabled={busy}
            />
            {itemIds.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {itemIds.map((id) => (
                  <li key={id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-module/10 py-0.5 pe-1 ps-2.5 text-xs font-semibold text-module">
                    <span className="truncate" dir="auto">
                      {itemName(id)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setItemIds(itemIds.filter((x) => x !== id))}
                      aria-label={t("site.obs.remove_item", { item: itemName(id) })}
                      className="grid h-6 w-6 place-items-center rounded-full hover:bg-module/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t("site.obs.blocks_hint")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="obs-imp">
              {t("site.obs.impact")} <span className="text-destructive">*</span>
            </Label>
            <Input id="obs-imp" dir="auto" placeholder={t("site.obs.impact_ph")} value={impact} onChange={(e) => setImpact(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="obs-open">{t("site.obs.open_on")}</Label>
            <Input id="obs-open" type="date" dir="ltr" max={today} value={openOn} onChange={(e) => setOpenOn(e.target.value)} disabled={busy} />
            <p className="text-xs text-muted-foreground">{t("site.obs.open_on_hint")}</p>
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.filter((b) => b !== "no_title" && b !== "no_impact").map((b) => t(`site.block.${b}`))} />
        </div>
        <Footer busy={busy} disabled={blocks.length > 0} onCancel={() => onOpenChange(false)} onSave={() => void save()} label={t("site.obs.save")} />
      </DialogContent>
    </Dialog>
  )
}

export function CloseObstacleDialog({
  target,
  onClose,
  archived,
  onSubmit,
}: {
  target: { no: string; title: string; openOn: string } | null
  onClose: () => void
  archived: boolean
  onSubmit: Submit<{ on: string; answer: string }>
}) {
  const t = useTranslations("Portal.PM")
  const today = todayDay()
  const [on, setOn] = useState(today)
  const [answer, setAnswer] = useState("")
  const [busy, setBusy] = useState(false)
  const blocks = target ? closeObstacleBlocks({ archived, openOn: target.openOn, on, today }) : []

  const save = async () => {
    setBusy(true)
    const ok = await onSubmit({ on, answer })
    setBusy(false)
    if (ok) {
      setOn(todayDay())
      setAnswer("")
      onClose()
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("site.obs.close")}</DialogTitle>
          <DialogDescription dir="auto">{target ? `${target.no}: ${target.title}` : ""}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="obs-close-on">{t("site.obs.close_on")}</Label>
            <Input id="obs-close-on" type="date" dir="ltr" min={target?.openOn} max={today} value={on} onChange={(e) => setOn(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="obs-answer">{t("site.obs.answer")}</Label>
            <Textarea id="obs-answer" dir="auto" placeholder={t("site.obs.answer_ph")} value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={busy} />
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.map((b) => t(`site.block.${b}`))} />
        </div>
        <Footer busy={busy} disabled={blocks.length > 0} onCancel={onClose} onSave={() => void save()} label={t("site.obs.close_save")} />
      </DialogContent>
    </Dialog>
  )
}

export function IncidentDialog({
  open,
  onOpenChange,
  orgId,
  projectId,
  archived,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  orgId: string
  projectId: string
  archived: boolean
  onSubmit: Submit<{ type: IncidentType; what: string; action: string; day: string; lostDays: number; files: SiteFile[] }>
}) {
  const t = useTranslations("Portal.PM")
  const today = todayDay()
  const [type, setType] = useState<IncidentType>("near")
  const [what, setWhat] = useState("")
  const [action, setAction] = useState("")
  const [day, setDay] = useState(today)
  const [lost, setLost] = useState("")
  const [files, setFiles] = useState<SiteFile[]>([])
  const [busy, setBusy] = useState(false)
  const lostDays = type === "lti" ? intOr(lost, 0) : 0
  const blocks = incidentBlocks({ archived, type, what, action, day, lostDays, today })

  const save = async () => {
    setBusy(true)
    const ok = await onSubmit({ type, what, action, day, lostDays, files })
    setBusy(false)
    if (ok) {
      setType("near")
      setWhat("")
      setAction("")
      setDay(todayDay())
      setLost("")
      setFiles([])
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("site.hse.inc_title")}</DialogTitle>
          <DialogDescription className="sr-only">{t("site.hse.inc_title")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Callout tone="warn">{t("site.hse.inc_note")}</Callout>
          <div className="space-y-1.5">
            <Label>{t("site.hse.type_label")}</Label>
            <Chips value={type} options={INCIDENT_TYPES} label={(v) => t(`site.hse.type.${v}`)} onChange={setType} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-what">
              {t("site.hse.what")} <span className="text-destructive">*</span>
            </Label>
            <Input id="inc-what" dir="auto" placeholder={t("site.hse.what_ph")} value={what} onChange={(e) => setWhat(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inc-act">
              {t("site.hse.action")} <span className="text-destructive">*</span>
            </Label>
            <Input id="inc-act" dir="auto" placeholder={t("site.hse.action_ph")} value={action} onChange={(e) => setAction(e.target.value)} disabled={busy} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inc-day">{t("site.hse.date")}</Label>
              <Input id="inc-day" type="date" dir="ltr" max={today} value={day} onChange={(e) => setDay(e.target.value)} disabled={busy} />
            </div>
            {type === "lti" && (
              <div className="space-y-1.5">
                <Label htmlFor="inc-lost">{t("site.hse.lost_days")}</Label>
                <Input id="inc-lost" type="number" min={0} dir="ltr" inputMode="numeric" placeholder="0" value={lost} onChange={(e) => setLost(e.target.value)} disabled={busy} />
                <p className="text-xs text-muted-foreground">{t("site.hse.lost_hint")}</p>
              </div>
            )}
          </div>
          <SiteFilesField orgId={orgId} projectId={projectId} folder="incidents" value={files} onChange={setFiles} label={t("site.hse.files")} disabled={busy} />
          <BlockingReasons title={t("cannot_save")} reasons={blocks.filter((b) => b !== "no_what" && b !== "no_action").map((b) => t(`site.block.${b}`))} />
        </div>
        <Footer busy={busy} disabled={blocks.length > 0} onCancel={() => onOpenChange(false)} onSave={() => void save()} label={t("site.hse.inc_save")} />
      </DialogContent>
    </Dialog>
  )
}

export function PermitDialog({
  open,
  onOpenChange,
  archived,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  archived: boolean
  onSubmit: Submit<{ title: string; who: string; from: string; to: string }>
}) {
  const t = useTranslations("Portal.PM")
  const today = todayDay()
  const [title, setTitle] = useState("")
  const [who, setWho] = useState("")
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [busy, setBusy] = useState(false)
  const blocks = permitBlocks({ archived, title, who, from, to })

  const save = async () => {
    setBusy(true)
    const ok = await onSubmit({ title, who, from, to })
    setBusy(false)
    if (ok) {
      setTitle("")
      setWho("")
      setFrom(todayDay())
      setTo(todayDay())
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("site.hse.pmt_title")}</DialogTitle>
          <DialogDescription>{t("site.hse.pmt_desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="pmt-t">
              {t("site.hse.pmt_work")} <span className="text-destructive">*</span>
            </Label>
            <Input id="pmt-t" dir="auto" placeholder={t("site.hse.pmt_work_ph")} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pmt-who">
              {t("site.hse.pmt_who")} <span className="text-destructive">*</span>
            </Label>
            <Input id="pmt-who" dir="auto" placeholder={t("site.hse.pmt_who_ph")} value={who} onChange={(e) => setWho(e.target.value)} disabled={busy} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pmt-from">{t("site.hse.pmt_from")}</Label>
              <Input id="pmt-from" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pmt-to">{t("site.hse.pmt_to")}</Label>
              <Input id="pmt-to" type="date" dir="ltr" min={from} value={to} onChange={(e) => setTo(e.target.value)} disabled={busy} />
            </div>
          </div>
          <BlockingReasons title={t("cannot_save")} reasons={blocks.filter((b) => b !== "no_work" && b !== "no_who").map((b) => t(`site.block.${b}`))} />
        </div>
        <Footer busy={busy} disabled={blocks.length > 0} onCancel={() => onOpenChange(false)} onSave={() => void save()} label={t("site.hse.pmt_save")} />
      </DialogContent>
    </Dialog>
  )
}
