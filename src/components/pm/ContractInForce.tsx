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
import { ADDENDUM_TERMS, addendumNo, amendedBy, draftAge, inForce, lastSignedOn, PM_ADDENDA, staleChanges, type PmAddendum } from "@/lib/pm/addenda"
import { claimNo, grantedDays, PM_CLAIMS, type PmClaim } from "@/lib/pm/claim"
import { contractEvents, type RecordKind } from "@/lib/pm/contract-record"
import { pmMoney } from "@/lib/pm/format"
import { approvedValue, PM_VARIATIONS, voNo, type PmVariation } from "@/lib/pm/variation"
import type { PillTone } from "@/components/module-ui/StatusPill"
import { FileLinks } from "./ContractBits"
import { useTermMeaning } from "./TermMeaning"
import { TermsCashPanel } from "./TermsCashPanel"
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
  orgId = "",
  durationDays = 0,
}: {
  projectId: string
  original: ContractTerms
  startedAt: string | null
  lifecycle: string
  /** The value at handover (the project's budget) — approved variations are added here. */
  contractValue: number
  retentionHeld: number
  access: PmAccess
  actor: AddendumActor
  orgId?: string
  durationDays?: number
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

  const voQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_VARIATIONS) : null), [firestore, projectId])
  const { data: voData } = useCollection(voQ)
  const claimQ = useMemoFirebase(() => (firestore ? collection(firestore, "projects", projectId, PM_CLAIMS) : null), [firestore, projectId])
  const { data: claimData } = useCollection(claimQ)
  const vos = useMemo(() => (voData ?? []) as unknown as PmVariation[], [voData])
  const claims = useMemo(() => (claimData ?? []) as unknown as PmClaim[], [claimData])
  const terms = useMemo(() => inForce(original, addenda), [original, addenda])
  const marks = useMemo(() => amendedBy(addenda), [addenda])
  const drafts = addenda.filter((a) => a.status === "draft")
  const approvedVos = vos.filter((v) => v.status === "appr")
  const liveValue = contractValue + approvedValue(vos)
  const eot = grantedDays(claims)
  const meaning = useTermMeaning({
    contractValue: liveValue,
    retentionHeld,
    money: access.has("money"),
  })
  const record = useMemo(
    () =>
      contractEvents({
        startOn: startedAt,
        originalValue: contractValue,
        durationDays,
        variations: vos,
        claims,
        addenda,
      }),
    [startedAt, contractValue, durationDays, vos, claims, addenda],
  )
  const lastSigned = lastSignedOn(addenda)
  const open = lifecycle !== "plan" && !access.ctx.archived
  const canDraft = open && access.allowed("addendum.draft")
  const canSign = open && access.allowed("addendum.sign")

  const originalOf = (key: (typeof ADDENDUM_TERMS)[number]) => original[key]

  return (
    <div className="space-y-4">
      <Callout tone="warn" title={t("terms.frozen_title")}>
        {t("terms.frozen_note", {
          date: pmDate(startedAt?.slice(0, 10), locale),
        })}
      </Callout>

      {drafts.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {drafts.map((a) => {
            const mayWithdraw = open && mayWithdrawAddendum(access.ctx, access.uid ?? "", a.by)
            const stale = staleChanges(a.changes, terms).length > 0
            return (
              <DecisionRow
                key={a.id}
                severity="amber"
                icon={FileSignature}
                title={t("amend.awaiting", { no: addendumNo(a.seq) })}
                detail={
                  <>
                    <span className="block">
                      {t("amend.drafted_by", {
                        who: a.byName || "—",
                        date: pmDate(a.day, locale),
                        reason:
                          a.reason === "other"
                            ? t("amend.other_stated", {
                                text: a.reasonText ?? "",
                              })
                            : t(`amend.reasons.${a.reason}`),
                      })}
                    </span>
                    <TermChangeList changes={a.changes} className="mt-1 text-xs" />
                    {a.note && (
                      <span className="mt-1 block text-xs" dir="auto">
                        {a.note}
                      </span>
                    )}
                    <FileLinks files={a.files} className="mt-1" />
                    {stale && (
                      <Callout tone="block" className="mt-2 py-2 text-xs">
                        {t("amend.stale_inline")}
                      </Callout>
                    )}
                  </>
                }
                age={t("days", { count: draftAge(a.day, today) })}
                action={
                  (canSign && !stale) || mayWithdraw ? (
                    <div className="flex flex-wrap gap-1.5">
                      {canSign && !stale && (
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
            {
              id: "record",
              label: t("amend.view_record"),
              count: record.length,
              tone: "mute",
            },
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
          <TermRow
            label={t("terms.contract_value")}
            value={access.has("money") ? pmMoney(liveValue) : "•••"}
            note={
              approvedVos.length
                ? t("terms.value_note_vos", {
                    orig: access.has("money") ? pmMoney(contractValue) : "•••",
                    count: approvedVos.length,
                  })
                : t("terms.value_note")
            }
          />
          <TermRow
            label={t("terms.duration")}
            value={t("days", { count: durationDays + eot })}
            note={
              eot > 0
                ? t("terms.duration_note_eot", {
                    orig: t("days", { count: durationDays }),
                    eot: t("days", { count: eot }),
                  })
                : t("terms.duration_note")
            }
          />
          {ADDENDUM_TERMS.filter((k) => terms.payer !== "none" || !["advance", "advanceRecovery", "retention", "retentionCap", "retentionRelease", "paymentDays", "consultantDays"].includes(k)).map(
            (k) => {
              const by = marks[k]
              const m = meaning(k, terms)
              return (
                <TermRow
                  key={k}
                  label={t(`terms.${k}` as "terms.save")}
                  value={text(k, terms[k])}
                  note={m.note}
                  warn={m.warn}
                  mark={
                    by
                      ? t("amend.mark", {
                          no: addendumNo(by.seq),
                          was: text(k, originalOf(k)),
                        })
                      : undefined
                  }
                />
              )
            },
          )}
          <TermRow label={t("terms.vat")} value="15%" note={t("terms.vat_note")} />
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

      {view === "record" && (
        <div>
          <p className="mb-2 text-xs text-muted-foreground">{t("amend.record_sub")}</p>
          {record.length === 0 ? (
            <EmptyState icon={FileSignature} title={t("amend.record_empty")} description={t("amend.record_starts")} />
          ) : (
            <ol className="divide-y rounded-xl border">
              {record.map((e) => (
                <li key={`${e.kind}-${e.seq ?? 0}`} className="flex items-start gap-3 px-3 py-2.5">
                  <StatusPill tone={RECORD_TONE[e.kind]} className="shrink-0">
                    {t(`amend.kind.${e.kind}`)}
                  </StatusPill>
                  <div className="min-w-0 flex-1 text-sm">
                    {e.kind === "orig" && (
                      <>
                        <b className="block">{t("amend.orig_line")}</b>
                        <span className="text-xs text-muted-foreground">
                          {t("amend.orig_sub", {
                            value: access.has("money") ? pmMoney(e.value ?? 0) : "•••",
                            days: t("days", { count: e.days ?? 0 }),
                          })}
                        </span>
                      </>
                    )}
                    {e.kind === "vo" && (
                      <>
                        <b className="block" dir="auto">
                          {t("vo.no", { no: voNo(e.seq ?? 0) })} — {e.title}
                        </b>
                        <span className="text-xs text-muted-foreground" dir="ltr">
                          + {access.has("money") ? pmMoney(e.value ?? 0) : "•••"}
                        </span>
                      </>
                    )}
                    {e.kind === "eot" && (
                      <>
                        <b className="block" dir="auto">
                          {t("claim.no", { no: claimNo(e.seq ?? 0) })} — {e.title}
                        </b>
                        <span className="text-xs text-muted-foreground">+ {t("days", { count: e.days ?? 0 })}</span>
                      </>
                    )}
                    {(e.kind === "amd" || e.kind === "void") && e.addendum && (
                      <>
                        <b className="block">{t("amend.no", { no: addendumNo(e.addendum.seq) })}</b>
                        <span className="block text-xs text-muted-foreground">
                          {e.kind === "amd"
                            ? t("amend.signed_line", {
                                date: pmDate(e.addendum.signedOn, locale),
                                who: e.addendum.signedByName || "—",
                                signatory: e.addendum.signatory || "—",
                              })
                            : t("amend.void_line", {
                                date: pmDate(e.addendum.voidOn, locale),
                                who: e.addendum.voidByName || "—",
                                reason:
                                  e.addendum.voidReason === "other"
                                    ? t("amend.other_stated", {
                                        text: e.addendum.voidText ?? "",
                                      })
                                    : e.addendum.voidReason
                                      ? t(`amend.withdraw_reasons.${e.addendum.voidReason}`)
                                      : "—",
                              })}
                        </span>
                        <TermChangeList changes={e.addendum.changes} className="mt-1 text-xs" />
                        {e.addendum.note && (
                          <span className="mt-1 block text-xs text-muted-foreground" dir="auto">
                            {e.addendum.note}
                          </span>
                        )}
                        <FileLinks files={e.addendum.files} className="mt-1" />
                      </>
                    )}
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{pmDate(e.day, locale)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {access.has("money") && <TermsCashPanel terms={terms} contractValue={liveValue} />}

      {canDraft && (
        <DraftAddendumDialog
          open={drafting}
          onOpenChange={setDrafting}
          projectId={projectId}
          orgId={orgId}
          access={access}
          actor={actor}
          terms={terms}
          lifecycle={lifecycle}
          contractValue={contractValue}
          retentionHeld={retentionHeld}
          lastSigned={lastSigned}
        />
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
          orgId={orgId}
        />
      )}
      {withdrawing && <WithdrawAddendumDialog open onOpenChange={(o) => !o && setWithdrawing(null)} projectId={projectId} access={access} actor={actor} addendum={withdrawing} />}
    </div>
  )
}

const RECORD_TONE: Record<RecordKind, PillTone> = {
  orig: "mute",
  vo: "info",
  eot: "ok",
  amd: "warn",
  void: "mute",
}

function TermRow({ label, value, note, warn, mark }: { label: string; value: string; note?: string; warn?: string; mark?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2.5 text-sm last:border-b-0">
      <div className="min-w-0 flex-1">
        <b className="block font-semibold">{label}</b>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      <div className="flex max-w-[55%] flex-col items-end gap-0.5 text-end">
        <b className="tabular-nums" dir="auto">
          {value}
        </b>
        {mark && <span className="text-[11px] font-semibold text-module">{mark}</span>}
        {warn && <span className="text-[11px] font-semibold text-warning">{warn}</span>}
      </div>
    </div>
  )
}
