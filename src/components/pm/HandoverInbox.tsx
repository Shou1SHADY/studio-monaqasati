"use client"

// "New projects" (PRD §5, HO-01…05): handover files from CRM, addressed to a
// manager. The manager sees the files addressed to them; the owner sees every
// waiting file. Nothing here creates a project until "Accept".

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertTriangle, ArrowRightLeft, CalendarClock, Check, FileWarning, Inbox, Undo2 } from "lucide-react"
import { collection, query, where } from "firebase/firestore"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { ModuleHeader } from "@/components/module-ui/ModuleHeader"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { AcceptHandoverWizard } from "@/components/pm/AcceptHandoverWizard"
import { ReassignHandoverDialog } from "@/components/pm/ReassignHandoverDialog"
import { ReturnHandoverDialog } from "@/components/pm/ReturnHandoverDialog"
import { useCollection, useFirestore, useMemoFirebase, useUser } from "@/firebase"
import { useOrgMembers } from "@/hooks/useOrgMembers"
import { usePermissions } from "@/hooks/usePermissions"
import { pmDate, pmMoney, pmPct, todayDay } from "@/lib/pm/format"
import { acceptBlocks, handoverAge, handoverFlags, PM_HANDOVERS, type PmHandover } from "@/lib/pm/handover"

type Dialog = { kind: "accept" | "reassign" | "return"; handover: PmHandover } | null

export function HandoverInbox() {
  const t = useTranslations("Portal.PM")
  const tShared = useTranslations("Portal.Shared")
  const locale = useLocale()
  const firestore = useFirestore()
  const { user } = useUser()
  const { profile, isOrgOwner } = usePermissions()
  const orgId = (profile?.organizationId as string | undefined) || user?.uid
  const { orgMembers } = useOrgMembers(orgId)
  const [dialog, setDialog] = useState<Dialog>(null)

  const waitingQuery = useMemoFirebase(() => {
    if (!firestore || !orgId) return null
    return query(collection(firestore, PM_HANDOVERS), where("organizationId", "==", orgId), where("status", "==", "wait"))
  }, [firestore, orgId])
  const { data, isLoading } = useCollection(waitingQuery)

  const today = todayDay()
  const files = useMemo(
    () =>
      ((data || []) as PmHandover[])
        .filter((h) => isOrgOwner || h.to === user?.uid)
        .sort((a, b) => (a.startOn || "9999").localeCompare(b.startOn || "9999")),
    [data, isOrgOwner, user?.uid]
  )
  const mine = files.filter((h) => h.to === user?.uid)
  const rush = files.filter((h) => handoverFlags(h, today).rush).length
  const incomplete = files.filter((h) => handoverFlags(h, today).incomplete).length

  const actor = { uid: user?.uid ?? "", name: (profile?.name as string | undefined) ?? user?.displayName ?? null }
  const managers = orgMembers.map((m) => ({ id: m.id, name: (m.name as string | undefined) || (m.email as string | undefined) || m.id }))

  return (
    <div className="space-y-6">
      <ModuleHeader
        icon={Inbox}
        title={t("inbox.title")}
        description={t("inbox.desc")}
        crumbs={[{ label: tShared("pm_crumb_projects"), href: "/contractor/projects" }, { label: t("inbox.title") }]}
        kpisLabel={t("inbox.kpis")}
        kpis={[
          { id: "mine", label: t("inbox.kpi_mine"), value: String(mine.length), tone: mine.length ? "warn" : "neutral", icon: Inbox },
          { id: "rush", label: t("inbox.kpi_rush"), value: String(rush), tone: rush ? "bad" : "neutral", icon: CalendarClock },
          { id: "incomplete", label: t("inbox.kpi_incomplete"), value: String(incomplete), tone: incomplete ? "bad" : "neutral", icon: FileWarning },
        ]}
      />

      {!isLoading && files.length === 0 && <EmptyState icon={Inbox} title={t("inbox.empty_title")} description={t("inbox.empty_desc")} />}

      <div className="space-y-4">
        {files.map((h) => {
          const flags = handoverFlags(h, today)
          const blocks = acceptBlocks(h)
          const age = handoverAge(h, today)
          const isMine = h.to === user?.uid
          return (
            <Panel
              key={h.id}
              title={h.title}
              actions={
                <>
                  <StatusPill tone={flags.severity === "red" ? "bad" : "warn"}>{t("inbox.pending_for", { count: age })}</StatusPill>
                  {h.contractNumber && (
                    <span className="text-xs font-semibold text-muted-foreground" dir="ltr">
                      {h.contractNumber}
                    </span>
                  )}
                </>
              }
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">{t("field.value")}</p>
                  <p className="mt-1 text-lg font-black tabular-nums" dir="ltr">
                    {h.value > 0 ? pmMoney(h.value) : t("not_fixed")}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">{t("field.duration")}</p>
                  <p className="mt-1 text-lg font-black">{h.durationDays > 0 ? t("days", { count: h.durationDays }) : t("not_fixed")}</p>
                </div>
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground">{t("field.start_on")}</p>
                  <p className={flags.rush ? "mt-1 text-lg font-black text-destructive" : "mt-1 text-lg font-black"}>{pmDate(h.startOn, locale)}</p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border px-4">
                <KeyValueRow label={t("field.client")} value={h.clientName ?? "—"} />
                <KeyValueRow label={t("field.kind")} value={h.kind ? tShared(`pm_kind_${h.kind}`) : "—"} />
                <KeyValueRow label={t("field.signed_on")} value={h.signedOn ? pmDate(h.signedOn, locale) : t("not_signed")} />
                <KeyValueRow label={t("field.advance_retention")} value={`${pmPct(h.advance)} · ${pmPct(h.retention)}`} ltr />
                <KeyValueRow label={t("field.assigned_to")} value={h.toName ?? "—"} />
                {h.note && <KeyValueRow label={t("field.note")} value={h.note} />}
              </div>
              {blocks.length > 0 && (
                <Callout tone="block" className="mt-3" title={t("cannot_accept")}>
                  {blocks.map((b) => t(`accept_block.${b}`)).join(" · ")}
                </Callout>
              )}
              {isMine ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={() => setDialog({ kind: "accept", handover: h })} disabled={blocks.length > 0}>
                    <Check size={16} className="me-1.5" aria-hidden="true" />
                    {t("inbox.accept")}
                  </Button>
                  <Button variant="outline" onClick={() => setDialog({ kind: "reassign", handover: h })}>
                    <ArrowRightLeft size={16} className="me-1.5" aria-hidden="true" />
                    {t("inbox.reassign")}
                  </Button>
                  <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDialog({ kind: "return", handover: h })}>
                    <Undo2 size={16} className="me-1.5" aria-hidden="true" />
                    {t("inbox.return")}
                  </Button>
                </div>
              ) : (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <AlertTriangle size={13} aria-hidden="true" />
                  {t("inbox.not_yours", { name: h.toName ?? "—" })}
                </p>
              )}
            </Panel>
          )
        })}
      </div>

      {dialog?.kind === "accept" && (
        <AcceptHandoverWizard open onOpenChange={(o) => !o && setDialog(null)} handover={dialog.handover} actor={actor} groupId={(profile?.defaultGroupId as string | undefined) ?? null} />
      )}
      {dialog?.kind === "reassign" && <ReassignHandoverDialog open onOpenChange={(o) => !o && setDialog(null)} handover={dialog.handover} actor={actor} managers={managers} />}
      {dialog?.kind === "return" && <ReturnHandoverDialog open onOpenChange={(o) => !o && setDialog(null)} handover={dialog.handover} actor={actor} />}
    </div>
  )
}
