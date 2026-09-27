"use client"

// Contract › Terms & amendments after start (AMD-01…10, WF-08). "In force" is
// the original + signed addenda, each amended term marked with the addendum
// and what it was; "Original as signed" is the frozen original, read-only;
// "Record" lists signed and withdrawn addenda, newest first. A draft awaiting
// signature is an amber decision with its age for whoever signs or drafted it.

import { useMemo, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { collection } from "firebase/firestore"
import { FilePen, FileSignature, Lock, PenLine, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { DecisionRow } from "@/components/module-ui/DecisionRow"
import { EmptyState } from "@/components/module-ui/EmptyState"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { SegmentedNav } from "@/components/module-ui/SegmentedNav"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useCollection, useFirestore, useMemoFirebase } from "@/firebase"
import type { PmAccess } from "@/hooks/usePmAccess"
import { usePmTermText } from "@/hooks/usePmTermText"
import { mayWithdrawAddendum } from "@/lib/pm/access"
import { ADDENDUM_TERMS, addendumNo, amendedBy, contractRecord, draftAge, inForce, lastSignedOn, PM_ADDENDA, type PmAddendum } from "@/lib/pm/addenda"
import type { AddendumActor } from "@/lib/pm/addendum-writes"
import { pmDate, todayDay } from "@/lib/pm/format"
import type { ContractTerms } from "@/lib/pm/terms"
import { DraftAddendumDialog } from "./DraftAddendumDialog"
import { SignAddendumDialog } from "./SignAddendumDialog"
import { TermChangeList } from "./TermChangeList"
import { WithdrawAddendumDialog } from "./WithdrawAddendumDialog"

type View = "force" | "original" | "record"

export function ContractInForce({
  projectId,
  original,
  startedAt,
  lifecycle,
  contractValue,
  retentionHeld,
  access,
  actor,
}: {
  projectId: string
  original: ContractTerms
  startedAt: string | null
  lifecycle: string
  contractValue: number
  retentionHeld: number
  access: PmAccess
  actor: AddendumActor
}) {
  const t = useTranslations("Portal.PM")
  const locale = useLocale()
  const text = usePmTermText()
  const firestore = useFirestore()
  const today = todayDay()
  const [view, setView] = useState<View>("force")
  const [drafting, setDrafting] = useState(false)
  const [signing, setSigning] = useState<PmAddendum | null>(null)
  const [withdrawing, setWithdrawing] = useState<PmAddendum | null>(null)

  const addendaQuery = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_ADDENDA) : null), [firestore, projectId])
  const { data } = useCollection(addendaQuery)
  const addenda = useMemo(() => ((data ?? []) as unknown as PmAddendum[]).slice().sort((a, b) => a.seq - b.seq), [data])

  const terms = useMemo(() => inForce(original, addenda), [original, addenda])
  const marks = useMemo(() => amendedBy(addenda), [addenda])
  const drafts = addenda.filter((a) => a.status === "draft")
  const record = contractRecord(addenda)
  const lastSigned = lastSignedOn(addenda)
  const open = lifecycle !== "plan" && !access.ctx.archived
  const canDraft = open && access.allowed("addendum.draft")
  const canSign = open && access.allowed("addendum.sign")

  const originalOf = (key: (typeof ADDENDUM_TERMS)[number]) => original[key]

  return (
    <div className="space-y-4">
      <Callout tone="warn" title={t("terms.frozen_title")}>
        {t("terms.frozen_note", { date: pmDate(startedAt?.slice(0, 10), locale) })}
      </Callout>

      {drafts.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {drafts.map((a) => {
            const mayWithdraw = open && mayWithdrawAddendum(access.ctx, access.uid ?? "", a.by)
            return (
              <DecisionRow
                key={a.id}
                severity="amber"
                icon={FileSignature}
                title={t("amend.awaiting", { no: addendumNo(a.seq) })}
                detail={
                  <>
                    <span className="block">{t("amend.drafted_by", { who: a.byName || "—", date: pmDate(a.day, locale), reason: a.reason === "other" ? t("amend.other_stated", { text: a.reasonText ?? "" }) : t(`amend.reasons.${a.reason}`) })}</span>
                    <TermChangeList changes={a.changes} className="mt-1 text-xs" />
                  </>
                }
                age={t("days", { count: draftAge(a.day, today) })}
                action={
                  canSign || mayWithdraw ? (
                    <div className="flex flex-wrap gap-1.5">
                      {canSign && (
                        <Button size="sm" onClick={() => setSigning(a)}>
                          <PenLine size={14} className="me-1.5" aria-hidden="true" />
                          {t("amend.sign")}
                        </Button>
                      )}
                      {mayWithdraw && (
                        <Button size="sm" variant="outline" onClick={() => setWithdrawing(a)}>
                          <Undo2 size={14} className="me-1.5" aria-hidden="true" />
                          {t("amend.withdraw")}
                        </Button>
                      )}
                    </div>
                  ) : undefined
                }
              />
            )
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedNav
          ariaLabel={t("amend.views")}
          active={view}
          onSelect={(id) => setView(id as View)}
          segments={[
            { id: "force", label: t("amend.view_force") },
            { id: "original", label: t("amend.view_original") },
            { id: "record", label: t("amend.view_record"), count: record.length, tone: "mute" },
          ]}
        />
        {canDraft && (
          <Button size="sm" onClick={() => setDrafting(true)}>
            <FilePen size={15} className="me-1.5" aria-hidden="true" />
            {t("amend.new")}
          </Button>
        )}
      </div>

      {view === "force" && (
        <div>
          {ADDENDUM_TERMS.map((k) => {
            const by = marks[k]
            return (
              <KeyValueRow
                key={k}
                label={t(`terms.${k}` as "terms.save")}
                value={
                  <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                    {text(k, terms[k])}
                    {by && (
                      <StatusPill tone="warn" className="text-[10px]">
                        {t("amend.mark", { no: addendumNo(by.seq), was: text(k, originalOf(k)) })}
                      </StatusPill>
                    )}
                  </span>
                }
              />
            )
          })}
        </div>
      )}

      {view === "original" && (
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock size={13} aria-hidden="true" />
            {t("amend.original_note")}
          </p>
          {ADDENDUM_TERMS.map((k) => (
            <KeyValueRow key={k} label={t(`terms.${k}` as "terms.save")} value={text(k, original[k])} />
          ))}
        </div>
      )}

      {view === "record" &&
        (record.length === 0 ? (
          <EmptyState icon={FileSignature} title={t("amend.record_empty")} description={t("amend.record_empty_desc")} />
        ) : (
          <ol className="space-y-2">
            {record.map((a) => (
              <li key={a.id} className="rounded-xl border p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  {t("amend.no", { no: addendumNo(a.seq) })}
                  <StatusPill tone={a.status === "signed" ? "ok" : "mute"}>{t(`amend.status.${a.status}`)}</StatusPill>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {a.status === "signed"
                    ? t("amend.signed_line", { date: pmDate(a.signedOn, locale), who: a.signedByName || "—", signatory: a.signatory || "—" })
                    : t("amend.void_line", {
                        date: pmDate(a.voidOn, locale),
                        who: a.voidByName || "—",
                        reason: a.voidReason === "other" ? t("amend.other_stated", { text: a.voidText ?? "" }) : a.voidReason ? t(`amend.withdraw_reasons.${a.voidReason}`) : "—",
                      })}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("amend.drafted_by", { who: a.byName || "—", date: pmDate(a.day, locale), reason: a.reason === "other" ? t("amend.other_stated", { text: a.reasonText ?? "" }) : t(`amend.reasons.${a.reason}`) })}
                </p>
                <TermChangeList changes={a.changes} className="mt-2" />
                {a.note && <p className="mt-1.5 text-xs text-muted-foreground" dir="auto">{a.note}</p>}
              </li>
            ))}
          </ol>
        ))}

      {canDraft && (
        <DraftAddendumDialog open={drafting} onOpenChange={setDrafting} projectId={projectId} access={access} actor={actor} terms={terms} lifecycle={lifecycle} contractValue={contractValue} retentionHeld={retentionHeld} />
      )}
      {signing && (
        <SignAddendumDialog
          open
          onOpenChange={(o) => !o && setSigning(null)}
          projectId={projectId}
          access={access}
          actor={actor}
          addendum={signing}
          terms={terms}
          lifecycle={lifecycle}
          lastSigned={lastSigned}
          contractValue={contractValue}
          retentionHeld={retentionHeld}
        />
      )}
      {withdrawing && <WithdrawAddendumDialog open onOpenChange={(o) => !o && setWithdrawing(null)} projectId={projectId} access={access} actor={actor} addendum={withdrawing} />}
    </div>
  )
}
