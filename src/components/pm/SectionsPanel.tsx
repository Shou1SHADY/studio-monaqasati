"use client"

// Settings › Project sections on a PM 1.0 project (WF-23, SEC-01…05, SC-04).
// Replaces the page's "manage sections" dialog for PM projects. Switching on is
// immediate, with its dependencies. Switching off opens a confirmation: what
// goes with it, what it holds now (count and riyals), what the system will stop
// telling you, the blockers (money and custody) or the open paperwork (warns),
// and a reason recorded in your name. Below, the section log; then the sections
// not built yet, in one place instead of empty tabs. Beside it, why sections
// are switched off at all.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Check, Clock, Grid3x3, Link2, Loader2, Lock, ShieldCheck, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Callout } from "@/components/module-ui/Callout"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import type { PmAccess } from "@/hooks/usePmAccess"
import { PmAccessError } from "@/lib/pm/access"
import { pmDate, pmMoney } from "@/lib/pm/format"
import {
  blockerDetails,
  builtSections,
  LEGACY_OFF_REASONS,
  NO_FACTS,
  PmSectionsError,
  readSectionFacts,
  SECTION_LOSS,
  SECTION_OFF_REASONS,
  SECTION_OWNER,
  sectionCensus,
  sectionLogRows,
  switchSections,
  unbuiltSections,
  type SectionActor,
  type SectionFacts,
  type SectionLogEntry,
  type SectionOffReason,
} from "@/lib/pm/sections-governance"
import { notBuiltYet } from "@/lib/pm/sections"
import { cascadeDisable, cascadeEnable, SECTION_GROUPS, SECTION_REGISTRY, sectionDescKey, sectionLabelKey, type SectionId } from "@/lib/project-sections"
import { cn } from "@/lib/utils"

export function SectionsPanel({
  projectId,
  project,
  access,
  actor,
}: {
  projectId: string
  project: { enabledSections?: string[]; warehouseId?: string | null; pm?: { secLog?: SectionLogEntry[] | null } | null }
  access: PmAccess
  actor: SectionActor
}) {
  const t = useTranslations("Portal.PM")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const [facts, setFacts] = useState<SectionFacts>(NO_FACTS)
  const [busy, setBusy] = useState<SectionId | null>(null)
  const [offId, setOffId] = useState<SectionId | null>(null)
  const money = access.has("money")
  const canSwitch = access.allowed("sections.manage")
  const enabled = useMemo(() => new Set((project.enabledSections ?? []) as SectionId[]), [project.enabledSections])
  const built = builtSections()
  const onCount = built.filter((id) => enabled.has(id) || SECTION_REGISTRY[id].required).length
  const name = (id: string) => (id in SECTION_REGISTRY ? tShared(sectionLabelKey(id as SectionId)) : id)

  const refresh = useCallback(() => {
    if (firestore) void readSectionFacts(firestore, projectId, project.warehouseId).then(setFacts)
  }, [firestore, projectId, project.warehouseId])
  useEffect(refresh, [refresh])

  const fail = (err: unknown) => {
    console.error(err)
    const key = err instanceof PmAccessError ? `refused.${err.code}` : err instanceof PmSectionsError && err.blocks[0] ? `sec.block.${err.blocks[0]}` : "error.save"
    toast({ title: t(key), variant: "destructive" })
  }

  const switchOn = async (id: SectionId) => {
    if (!firestore) return
    const next = cascadeEnable(enabled, id)
    setBusy(id)
    try {
      await switchSections(firestore, access.ctx, projectId, actor, { next: Array.from(next), reason: null })
      const added = [...next].filter((x) => !enabled.has(x) && x !== id)
      toast({ title: added.length ? t("sec.on_with", { name: name(id), list: added.map(name).join(" · ") }) : t("sec.on_done", { name: name(id) }) })
      refresh()
    } catch (err) {
      fail(err)
    } finally {
      setBusy(null)
    }
  }

  const log = sectionLogRows(project.pm?.secLog)
  const soon = notBuiltYet(unbuiltSections())
  const soonOurs = soon.filter((id) => !SECTION_OWNER[id])
  const soonElsewhere = soon.filter((id) => SECTION_OWNER[id])
  const censusText = (id: SectionId) =>
    sectionCensus(id, facts)
      .filter((r) => money || !r.money)
      .slice(0, 2)
      .map((r) => `${t(`sec.census.${r.key}`)}: ${r.money ? pmMoney(r.value) : r.value}`)
      .join(" · ")

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Panel title={t("sec.panel_title")} icon={Grid3x3}>
          <p className="mb-4 text-xs text-muted-foreground">{t("sec.panel_sub", { on: onCount, total: built.length })}</p>
          <div className="space-y-5">
            {SECTION_GROUPS.map((group) => {
              const ids = built.filter((id) => SECTION_REGISTRY[id].group === group)
              if (!ids.length) return null
              return (
                <div key={group}>
                  <p className="mb-2 text-xs font-bold text-muted-foreground">{tShared(`sec_group_${group}`)}</p>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {ids.map((id) => {
                      const def = SECTION_REGISTRY[id]
                      const on = enabled.has(id)
                      const missing = def.dependsOn.filter((d) => !enabled.has(d as SectionId))
                      const blocked = on && !def.required && blockerDetails([id], facts).length > 0
                      const census = on && !def.required && !blocked ? sectionCensus(id, facts) : []
                      const warn = census.some((r) => r.level === "w")
                      const owner = SECTION_OWNER[id]
                      const disabled = def.required || !canSwitch || access.ctx.archived || busy !== null
                      return (
                        <button
                          key={id}
                          type="button"
                          disabled={disabled}
                          onClick={() => (on ? setOffId(id) : void switchOn(id))}
                          aria-pressed={on}
                          className={cn(
                            "flex min-h-11 flex-col items-start gap-1 rounded-xl border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                            on ? "border-module/40 bg-module/5" : "bg-card hover:border-muted-foreground/40",
                            disabled && !def.required && "cursor-not-allowed",
                            def.required && "cursor-default"
                          )}
                        >
                          <span className="flex w-full items-start justify-between gap-2">
                            <span className="text-sm font-bold">{tShared(sectionLabelKey(id))}</span>
                            {busy === id ? (
                              <Loader2 size={14} className="animate-spin text-muted-foreground" aria-hidden="true" />
                            ) : def.required ? (
                              <StatusPill tone="mute">
                                <Lock size={10} aria-hidden="true" />
                                {t("sec.core")}
                              </StatusPill>
                            ) : on ? (
                              <StatusPill tone="ok">
                                <Check size={11} aria-hidden="true" />
                                <span className="sr-only">{t("sec.on")}</span>
                              </StatusPill>
                            ) : null}
                          </span>
                          <span className="text-xs text-muted-foreground">{tShared(sectionDescKey(id))}</span>
                          {blocked && (
                            <span className="flex items-center gap-1 text-xs font-bold text-destructive">
                              <Lock size={10} aria-hidden="true" />
                              {t("sec.locked_card")}
                            </span>
                          )}
                          {census.length > 0 && <span className={cn("text-xs", warn ? "text-warning" : "text-muted-foreground")}>{censusText(id)}</span>}
                          {owner && <StatusPill tone="info">{t("sec.reads_from", { module: t(`sec.owner.${owner}`) })}</StatusPill>}
                          {!on && missing.length > 0 && <span className="text-xs font-bold text-warning">{t("sec.needs", { list: missing.map(name).join(" · ") })}</span>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          <Callout tone="info" className="mt-4">
            {t("sec.never_deletes")}
          </Callout>
          {!canSwitch && !access.ctx.archived && <p className="mt-2 text-xs text-muted-foreground">{t("sec.read_only")}</p>}
        </Panel>

        {log.length > 0 && (
          <Panel title={t("sec.log_title")} icon={Clock} bodyClassName="p-0">
            <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("sec.log_sub")}</p>
            <ul className="divide-y">
              {log.map((r, i) => {
                const reason = r.reason === "other" ? r.reasonText || t("sec.why.other") : r.reason && (LEGACY_OFF_REASONS as readonly string[]).includes(r.reason) ? t(`sec.reason.${r.reason}`) : r.reason ? t(`sec.why.${r.reason}`) : null
                return (
                  <li key={`${r.at}-${r.id}-${i}`} className="flex items-start gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">{name(r.id)}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.on ? t("sec.log_on") : t("sec.log_off")} {pmDate(r.at?.slice(0, 10), locale)} · <span dir="auto">{r.byName || "—"}</span>
                        {reason && (
                          <>
                            {" · "}
                            <span dir="auto">{reason}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <StatusPill tone={r.on ? "ok" : "mute"}>{r.on ? t("sec.state_on") : t("sec.state_off")}</StatusPill>
                  </li>
                )
              })}
            </ul>
          </Panel>
        )}

        {soon.length > 0 && (
          <details className="overflow-hidden rounded-xl border bg-card">
            <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm font-bold">
              <Clock size={16} className="text-module" aria-hidden="true" />
              {t("sec.soon_title")}
              <span className="text-xs font-normal text-muted-foreground">{t("sec.soon_sub", { count: soon.length })}</span>
            </summary>
            <div className="space-y-3 border-t p-4">
              <Callout tone="warn">{t("sec.soon_note")}</Callout>
              {soonOurs.length > 0 && (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {soonOurs.map((id) => (
                    <div key={id} className="rounded-xl border border-dashed p-3">
                      <p className="text-sm font-bold">{tShared(sectionLabelKey(id))}</p>
                      <p className="text-xs text-muted-foreground">{tShared(sectionDescKey(id))}</p>
                      {enabled.has(id) && <p className="mt-1 text-xs text-warning">{t("sec.soon_enabled")}</p>}
                    </div>
                  ))}
                </div>
              )}
              {soonElsewhere.length > 0 && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("sec.elsewhere_lead")}{" "}
                  {soonElsewhere.map((id, i) => (
                    <span key={id}>
                      {i > 0 && " · "}
                      <b className="text-foreground">{tShared(sectionLabelKey(id))}</b> <StatusPill tone="info">{t(`sec.owner.${SECTION_OWNER[id]}`)}</StatusPill>
                    </span>
                  ))}{" "}
                  {t("sec.elsewhere_tail")}
                </p>
              )}
            </div>
          </details>
        )}
      </div>

      <SectionsHelp on={onCount} total={built.length} />

      {offId && (
        <SwitchOffDialog
          id={offId}
          enabled={enabled}
          facts={facts}
          money={money}
          name={name}
          onClose={() => setOffId(null)}
          onConfirm={async (reason, reasonText) => {
            if (!firestore) return false
            try {
              await switchSections(firestore, access.ctx, projectId, actor, { next: Array.from(cascadeDisable(enabled, offId)), reason, reasonText })
              toast({ title: t("sec.off_done", { name: name(offId) }) })
              refresh()
              return true
            } catch (err) {
              fail(err)
              return false
            }
          }}
        />
      )}
    </div>
  )
}

function SwitchOffDialog({
  id,
  enabled,
  facts,
  money,
  name,
  onClose,
  onConfirm,
}: {
  id: SectionId
  enabled: Set<SectionId>
  facts: SectionFacts
  money: boolean
  name: (id: string) => string
  onClose: () => void
  onConfirm: (reason: SectionOffReason, reasonText: string) => Promise<boolean>
}) {
  const t = useTranslations("Portal.PM")
  const [reason, setReason] = useState<SectionOffReason | null>(null)
  const [reasonText, setReasonText] = useState("")
  const [busy, setBusy] = useState(false)
  const after = cascadeDisable(enabled, id)
  const gone = [id, ...[...enabled].filter((x) => !after.has(x) && x !== id)]
  const blocks = blockerDetails(gone, facts)
  const census = gone.map((k) => ({ k, rows: sectionCensus(k, facts).filter((r) => money || !r.money) })).filter((x) => x.rows.length)
  const warn = census.flatMap((x) => x.rows.filter((r) => r.level === "w"))
  const ok = !blocks.length && reason !== null && (reason !== "other" || reasonText.trim().length > 0)
  const value = (r: { money: boolean; value: number }) => (r.money ? pmMoney(r.value) : String(r.value))

  const blockLine = (b: (typeof blocks)[number]) => {
    if (b.key === "store_stock") return t("sec.blocker.store_stock", { count: b.n })
    if (b.key === "plant_on_site") return t("sec.blocker.plant_on_site", { count: b.n })
    if (b.key === "uncollected") return money && b.amount ? t("sec.blocker.uncollected", { amount: pmMoney(b.amount) }) : t("sec.blocker.uncollected_hidden", { count: b.n })
    const parts: string[] = []
    if ((b.amount ?? 0) > 0.5) parts.push(money ? t("sec.blocker.sub_dues", { amount: pmMoney(b.amount ?? 0) }) : t("sec.blocker.sub_dues_hidden"))
    if (b.n > 0) parts.push(t("sec.blocker.sub_pending", { count: b.n }))
    return parts.join(" · ")
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("sec.off_dialog_title")}</DialogTitle>
          <DialogDescription>{name(id)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Callout tone={blocks.length ? "warn" : "info"}>{t("sec.off_dialog_note")}</Callout>
          {gone.length > 1 && (
            <div className="flex gap-2.5 rounded-xl border border-warning/25 bg-warning/5 px-3.5 py-3 text-sm">
              <Link2 size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              <span>
                <b>{t("sec.not_alone")}</b> {t("sec.not_alone_note", { list: gone.slice(1).map(name).join(" · ") })}
              </span>
            </div>
          )}
          {census.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">{t("sec.holds_now")}</p>
              <div className="divide-y rounded-xl border bg-muted/30">
                {census.flatMap((x) =>
                  x.rows.map((r) => (
                    <div key={`${x.k}-${r.key}`} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">
                        {t(`sec.census.${r.key}`)}
                        {gone.length > 1 && <span className="text-xs"> — {name(x.k)}</span>}
                      </span>
                      <span dir="ltr" className={cn("font-bold tabular-nums", r.level === "r" && "text-destructive", r.level === "w" && "text-warning")}>
                        {value(r)}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t("sec.holds_hint")}</p>
            </div>
          )}
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">{t("sec.goes_silent")}</p>
            {gone.map((k) => (
              <div key={k} className="flex gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm">
                <X size={15} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
                <span>{SECTION_LOSS.has(k) ? t(`sec.loss.${k}`) : t("sec.loss_generic", { name: name(k) })}</span>
              </div>
            ))}
          </div>
          {blocks.length > 0 ? (
            <Callout tone="block" title={t("sec.cannot_now")}>
              <ul className="space-y-0.5">
                {blocks.map((b) => (
                  <li key={b.key}>{blockLine(b)}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs">{t("sec.money_blocks")}</p>
            </Callout>
          ) : (
            warn.length > 0 && <Callout tone="warn">{t("sec.paper_open", { list: warn.map((r) => `${t(`sec.census.${r.key}`)} (${value(r)})`).join(" · ") })}</Callout>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">
              {t("sec.why_label")} <span className="text-destructive">*</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {SECTION_OFF_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  aria-pressed={reason === r}
                  className={cn(
                    "min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    reason === r ? "border-module bg-module/10 text-module" : "hover:bg-muted"
                  )}
                >
                  {t(`sec.why.${r}`)}
                </button>
              ))}
            </div>
            {reason === "other" && (
              <div className="space-y-1">
                <Label htmlFor="sec-off-text" className="sr-only">
                  {t("sec.reason_text")}
                </Label>
                <Input id="sec-off-text" dir="auto" value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder={t("sec.why_placeholder")} />
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("sec.why_hint")}</p>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t("back")}
          </Button>
          <Button
            variant="destructive"
            disabled={!ok || busy}
            onClick={async () => {
              if (!reason) return
              setBusy(true)
              const done = await onConfirm(reason, reasonText)
              setBusy(false)
              if (done) onClose()
            }}
          >
            {busy ? <Loader2 size={15} className="me-1.5 animate-spin" aria-hidden="true" /> : <X size={15} className="me-1.5" aria-hidden="true" />}
            {gone.length > 1 ? t("sec.off_button_n", { count: gone.length }) : t("sec.off_button")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SectionsHelp({ on, total }: { on: number; total: number }) {
  const t = useTranslations("Portal.PM")
  const step = (title: string, body: string) => (
    <li className="flex gap-2.5">
      <Check size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
    </li>
  )
  return (
    <Panel title={t("sec.help.title")} icon={ShieldCheck} className="self-start">
      <Callout tone="info">{t("sec.help.intro")}</Callout>
      <ul className="mt-3 space-y-3">
        {step(t("sec.help.confirm"), t("sec.help.confirm_note"))}
        {step(t("sec.help.money"), t("sec.help.money_note"))}
        {step(t("sec.help.paper"), t("sec.help.paper_note"))}
        {step(t("sec.help.nothing"), t("sec.help.nothing_note"))}
      </ul>
      <div className="mt-3 flex items-baseline justify-between rounded-xl border bg-muted/30 px-3 py-2 text-sm">
        <span className="text-muted-foreground">{t("sec.help.on_now")}</span>
        <b dir="ltr" className="tabular-nums">
          {on} / {total}
        </b>
      </div>
    </Panel>
  )
}
