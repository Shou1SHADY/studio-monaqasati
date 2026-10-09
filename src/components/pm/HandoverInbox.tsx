"use client"

// "New projects" (PRD §5, HO-01…05; the prototype's viewInbox): handover files
// from CRM, addressed to a manager. The manager sees the files addressed to
// them; the owner sees — and may answer — every waiting file. The answer has
// three outcomes, not two: accept, pass to another manager ("not the right
// person"), or return to CRM ("the file is incomplete"). Returned files stay
// listed until CRM sends the deal again. Nothing here creates a project until "Accept".

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, ArrowRightLeft, CalendarClock, Check, Clock, FileWarning, FolderKanban, Hand, Undo2 } from "lucide-react"
import { collection, query, where } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { ModuleHeader } from "@/components/module-ui/ModuleHeader"
import { Panel } from "@/components/module-ui/Panel"
import { SourceBadge } from "@/components/module-ui/SourceBadge"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { AcceptHandoverWizard, clientTypeKey } from "@/components/pm/AcceptHandoverWizard"
import { HandoverAttachments } from "@/components/pm/HandoverAttachments"
import { PmSeatChip } from "@/components/pm/PmSeatChip"
import { PmTodayRedCount } from "@/components/pm/PmPortfolioToday"
import { ReassignHandoverDialog } from "@/components/pm/ReassignHandoverDialog"
import { ReturnHandoverDialog } from "@/components/pm/ReturnHandoverDialog"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useHandoverPeople } from "@/hooks/useHandoverPeople"
import { usePermissions } from "@/hooks/usePermissions"
import { usePmRail } from "@/hooks/usePmRail"
import { pmDate, pmMoney, pmPct, todayDay } from "@/lib/pm/format"
import { acceptBlocks, handoverAge, handoverBoqCount, handoverFlags, inboxKpis, mayActOnHandover, openReturns, PM_HANDOVERS, type PmHandover } from "@/lib/pm/handover"
import { fileExtras } from "@/lib/pm/handover-writes"
import { displayDocNumber } from "@/lib/sales-numbering"
import { cn } from "@/lib/utils"

type Dialog = { kind: "accept" | "reassign" | "return"; handover: PmHandover } | null

const dayNum = (d: string) => Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / 86_400_000

export function HandoverInbox() {
  const t = useTranslations("Portal.PM")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile, isOrgOwner } = usePermissions()
  const orgId = (profile?.organizationId as string | undefined) || user?.uid
  const people = useHandoverPeople(orgId)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [todayRed, setTodayRed] = useState<number | undefined>(undefined)
  const rail = usePmRail(todayRed)
  const uid = user?.uid ?? ""

  const filesQuery = useMemoFirebase(() => (firestore && orgId ? query(collection(firestore, PM_HANDOVERS), where("organizationId", "==", orgId)) : null), [firestore, orgId])
  const { data, isLoading } = useCollection(filesQuery)

  const today = todayDay()
  const all = useMemo(() => (data || []) as PmHandover[], [data])
  const files = useMemo(
    () =>
      all
        .filter((h) => h.status === "wait" && mayActOnHandover({ uid, owner: isOrgOwner }, h))
        .sort((a, b) => (a.startOn || "9999").localeCompare(b.startOn || "9999")),
    [all, uid, isOrgOwner]
  )
  const returned = useMemo(() => openReturns(all).filter((h) => isOrgOwner || h.to === uid || h.returned?.by === uid), [all, isOrgOwner, uid])
  const k = inboxKpis(files, today)

  const actor = { uid, name: (profile?.name as string | undefined) ?? user?.displayName ?? null, owner: isOrgOwner }
  const crmTag = <SourceBadge module="crm" label={t("wizard.from_crm")} />
  const rel = (day: string | null) => {
    if (!day) return ""
    const n = Math.round(dayNum(day) - dayNum(today))
    return n === 0 ? t("inbox.rel_today") : n > 0 ? t("inbox.rel_in", { count: n }) : t("inbox.rel_ago", { count: -n })
  }

  return (
    <div className="space-y-6">
      <PmTodayRedCount onCount={setTodayRed} />
      <ModuleHeader
        status={<PmSeatChip />}
        icon={Hand}
        title={t("inbox.title")}
        description={t("inbox.desc")}
        crumbs={[{ label: tShared("pm_crumb_projects"), href: "/contractor/projects" }, { label: t("rail.inbox") }]}
        kpisLabel={t("inbox.kpis")}
        kpis={[
          {
            id: "waiting",
            label: t("inbox.kpi_waiting"),
            value: String(k.waiting),
            note: k.waiting ? t("inbox.kpi_waiting_note", { count: k.oldest }) : t("inbox.kpi_waiting_none"),
            tone: k.waiting ? "warn" : "good",
            icon: Hand,
          },
          { id: "rush", label: t("inbox.kpi_rush"), value: String(k.rush), note: t("inbox.kpi_rush_note"), tone: k.rush ? "bad" : "neutral", icon: CalendarClock },
          { id: "incomplete", label: t("inbox.kpi_incomplete"), value: String(k.incomplete), note: t("inbox.kpi_incomplete_note"), tone: k.incomplete ? "bad" : "good", icon: FileWarning },
        ]}
        tabs={rail.tabs}
        activeTab="inbox"
        tabsLabel={t("inbox.title")}
      />

      <Callout tone="info">
        <span className="me-1.5">{t("inbox.intro")}</span>
        {crmTag}
      </Callout>

      {!isLoading && files.length === 0 && returned.length === 0 && <EmptyState icon={Hand} title={t("inbox.empty_title")} description={t("inbox.empty_desc")} />}

      <div className="space-y-4">
        {files.map((h) => {
          const flags = handoverFlags(h, today)
          const blocks = acceptBlocks(h)
          const age = handoverAge(h, today)
          const boqN = handoverBoqCount(h)
          const ct = clientTypeKey(h.clientType)
          const dealNo = fileExtras(h).dealNo
          return (
            <Panel
              key={h.id}
              icon={FolderKanban}
              title={h.title}
              actions={
                <>
                  <StatusPill tone={age > 7 ? "bad" : "warn"}>
                    <Clock size={11} aria-hidden="true" />
                    {t("inbox.pending_for", { count: age })}
                  </StatusPill>
                  {h.contractNumber && (
                    <span className="text-xs font-semibold text-muted-foreground" dir="ltr">
                      {h.contractNumber}
                    </span>
                  )}
                  {dealNo ? <SourceBadge module="crm" label={t("dec.ho.deal", { no: displayDocNumber(dealNo, locale) })} /> : crmTag}
                </>
              }
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">{t("inbox.stat_value")}</p>
                  <p className="mt-1 text-lg font-black tabular-nums" dir="ltr">
                    {h.value > 0 ? pmMoney(h.value) : "—"}
                  </p>
                  {!(h.value > 0) && <p className="text-xs text-muted-foreground">{t("not_fixed")}</p>}
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">{t("field.duration")}</p>
                  <p className="mt-1 text-lg font-black">{h.durationDays > 0 ? t("days", { count: h.durationDays }) : "—"}</p>
                  {!(h.durationDays > 0) && <p className="text-xs text-muted-foreground">{t("not_fixed")}</p>}
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">{t("field.start_on")}</p>
                  <p className="mt-1 text-sm font-black">{pmDate(h.startOn, locale)}</p>
                  <p className={cn("text-xs", flags.rush ? "font-bold text-destructive" : "text-muted-foreground")}>{rel(h.startOn)}</p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border px-4">
                <KeyValueRow
                  label={t("field.client")}
                  value={
                    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <span dir="auto">{[h.clientName ?? "—", ct ? tShared(ct.key) : null].filter(Boolean).join(" · ")}</span>
                      {crmTag}
                    </span>
                  }
                />
                <KeyValueRow label={t("inbox.row_kind_location")} value={[h.kind ? tShared(`pm_kind_${h.kind}`) : "—", h.location || "—"].join(" · ")} />
                <KeyValueRow label={t("field.signed_on")} value={h.signedOn ? pmDate(h.signedOn, locale) : <span className="font-bold text-destructive">{t("not_signed")}</span>} />
                <KeyValueRow label={t("wizard.row_terms")} value={t("wizard.terms_line", { advance: pmPct(h.advance), retention: pmPct(h.retention) })} />
                <KeyValueRow label={t("wizard.row_boq")} value={boqN ? t("inbox.boq_from_bid", { count: boqN }) : <span className="font-bold text-destructive">{t("wizard.boq_not_attached")}</span>} />
                <KeyValueRow label={tShared("crm_handover_attachments")} value={<HandoverAttachments extras={fileExtras(h)} />} />
                <KeyValueRow label={t("field.assigned_to")} value={h.toName ?? "—"} />
                {h.note && <KeyValueRow label={t("field.note")} value={<span dir="auto">{h.note}</span>} />}
              </div>
              {blocks.length > 0 && (
                <Callout tone="block" className="mt-3" title={t("inbox.cannot_accept_as_is")}>
                  {blocks.map((b) => t(`accept_block.${b}`)).join(" · ")}. {t("inbox.invented_number")}
                </Callout>
              )}
              {h.to !== uid && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle size={13} aria-hidden="true" />
                  {t("inbox.owner_acting", { name: h.toName ?? "—" })}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button onClick={() => setDialog({ kind: "accept", handover: h })} disabled={blocks.length > 0} className={cn(!blocks.length && "bg-success text-white hover:bg-success/90")} variant={blocks.length ? "outline" : "default"}>
                  <Check size={16} className="me-1.5" aria-hidden="true" />
                  {t("inbox.accept")}
                </Button>
                <Button variant="outline" onClick={() => setDialog({ kind: "reassign", handover: h })}>
                  <ArrowRightLeft size={16} className="me-1.5" aria-hidden="true" />
                  {t("inbox.reassign")}
                </Button>
                <Button variant="outline" className="border-destructive/40 text-destructive hover:text-destructive" onClick={() => setDialog({ kind: "return", handover: h })}>
                  <Undo2 size={16} className="me-1.5" aria-hidden="true" />
                  {t("inbox.return")}
                </Button>
              </div>
            </Panel>
          )
        })}
      </div>

      {returned.length > 0 && (
        <Panel icon={AlertTriangle} title={t("inbox.returned_title")} actions={<span className="text-xs text-muted-foreground">{t("inbox.returned_sub")}</span>}>
          <ul className="divide-y">
            {returned.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-bold" dir="auto">
                    {h.title}
                  </p>
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {[h.contractNumber, h.clientName, `${t("inbox.missing")}: ${(h.returned?.missing ?? []).map((m) => t(`missing.${m}`)).join(" · ") || "—"}`].filter(Boolean).join(" · ")}
                  </p>
                  {h.returned?.note && (
                    <p className="text-xs text-muted-foreground" dir="auto">
                      {h.returned.note}
                    </p>
                  )}
                </div>
                <StatusPill tone="bad">{t("inbox.awaiting_completion")}</StatusPill>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {dialog?.kind === "accept" && <AcceptHandoverWizard open onOpenChange={(o) => !o && setDialog(null)} handover={dialog.handover} actor={actor} />}
      {dialog?.kind === "reassign" && (
        <ReassignHandoverDialog
          open
          onOpenChange={(o) => !o && setDialog(null)}
          handover={dialog.handover}
          actor={actor}
          candidates={people.candidates(dialog.handover.to)}
          myLive={people.liveOf(dialog.handover.to)}
        />
      )}
      {dialog?.kind === "return" && <ReturnHandoverDialog open onOpenChange={(o) => !o && setDialog(null)} handover={dialog.handover} actor={actor} />}
    </div>
  )
}
