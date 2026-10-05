"use client"

// My file — Home (the prototype's meHome): what needs his attention (each row
// with its one action), my day, my requests in progress with who holds each
// by name, and the last salary — paid, with Finance, or held.

import { useLocale, useTranslations } from "next-intl"
import { BellRing, Check, FileText, Flag, IdCard, Inbox, Sun, Wallet, X, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DecisionRow, type DecisionSeverity } from "@/components/module-ui/DecisionRow"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill, type PillTone } from "@/components/module-ui/StatusPill"
import { hrDate, hrMoney } from "@/lib/hr/format"
import { monthName, myToday, whoRecordsMe, type AttnItem, type AttnKind, type MyTodayState } from "@/lib/hr/me"
import { requestNoDisplay } from "@/lib/hr/requests"
import { daysBetween } from "@/lib/hr/statutory"
import { describeRequest, REQUEST_TONE } from "./HrRequestList"
import type { MyFileCtx } from "./HrMyFile"

const ATTN_ICON: Record<AttnKind, LucideIcon> = {
  penalty: Flag,
  penalty_objected: Flag,
  doc: IdCard,
  doc_expired: IdCard,
  contract: FileText,
  iban_returned: Wallet,
  no_iban: Wallet,
  no_mobile: BellRing,
  approved: Check,
  declined: X,
}
const SEVERITY: Record<AttnItem["tone"], DecisionSeverity> = { red: "red", amber: "amber", blue: "blue", green: "blue" }
export const TODAY_TONE: Record<MyTodayState, PillTone> = { present: "ok", absent: "bad", sick: "warn", permission: "warn", leave: "info", assumed: "ok", none: "mute" }

export function HrMyHome({ ctx, attention }: { ctx: MyFileCtx; attention: AttnItem[] }) {
  const t = useTranslations("Portal.HR")
  const locale = useLocale()
  const { emp, today } = ctx
  const inProgress = ctx.requests.filter((r) => ["pending", "endorsed", "finance"].includes(r.state))
  const last = ctx.slips.find((s) => s.kind === "main") ?? null
  const state = myToday({ att: ctx.att, today, onLeave: ctx.onLeave, assumed: ctx.assumed })
  const rec = whoRecordsMe(emp.siteId, ctx.site)

  const attnText = (a: AttnItem) => {
    const p = a.params
    const code = typeof p.code === "string" ? t(`violation.${p.code}` as "violation.late15") : ""
    const doc = typeof p.doc === "string" ? t(`doc.${p.doc}`) : ""
    const date = typeof p.date === "string" ? hrDate(p.date, locale) : ""
    const until = typeof p.until === "string" ? hrDate(p.until, locale) : ""
    const kind = typeof p.kind === "string" ? t(`req.kind.${p.kind}`) : ""
    const no = typeof p.no === "string" ? requestNoDisplay(p.no, locale) : ""
    const reason = (p.note as string) || (p.by ? t("me.attn.by", { name: p.by as string }) : "")
    return { title: t(`me.attn.${a.kind}`, { code, doc, date, kind, no }), detail: t(`me.attn.${a.kind}_sub`, { until, reason }) }
  }
  const attnAction = (a: AttnItem) => {
    if (!a.action) return null
    if ("object" in a.action)
      return (
        <Button size="sm" variant="outline" onClick={() => ctx.go("requests")}>
          {t("me.attn.object")}
        </Button>
      )
    const field = a.action.data
    return (
      <Button size="sm" variant={a.tone === "red" ? "default" : "outline"} onClick={() => ctx.ask("data", field)}>
        {t(a.kind === "iban_returned" ? "me.attn.update_iban" : "me.attn.add")}
      </Button>
    )
  }

  return (
    <div className="space-y-4">
      {attention.length > 0 && (
        <Panel title={t("me.attn.title")} icon={BellRing} count={attention.length} countTone={attention.some((a) => a.tone === "red") ? "bad" : "mute"}>
          <ul className="-mx-4 divide-y">
            {attention.map((a) => {
              const x = attnText(a)
              return <DecisionRow key={a.key} severity={SEVERITY[a.tone]} icon={ATTN_ICON[a.kind]} title={x.title} detail={x.detail} action={attnAction(a)} />
            })}
          </ul>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* «يومي» — today, who records me, where, and my line manager. */}
        <Panel title={t("me.day.title")} icon={Sun}>
          <KeyValueRow label={t("me.day.today")} value={<StatusPill tone={TODAY_TONE[state]}>{t(`me.today.${state}`)}</StatusPill>} />
          <KeyValueRow
            label={t("me.day.recorder")}
            value={rec.kind === "assumed" ? t("me.day.recorder_assumed") : rec.kind === "supervisor" ? (ctx.memberName(rec.userId) ?? t("me.holder.supervisor")) : t("me.day.recorder_none")}
          />
          <KeyValueRow label={t("me.day.place")} value={ctx.siteName(emp.siteId) ?? t("sites.unassigned")} />
          <KeyValueRow label={t("me.line_manager")} value={ctx.lineManager?.name ?? t("me.holder.management")} />
          <p className="pt-2 text-[11px] text-muted-foreground">{t(ctx.access.settings.features.includes("punch") ? "me.day.punch_later" : rec.kind === "assumed" ? "me.day.assumed_note" : "me.day.sheet_note")}</p>
        </Panel>

        {/* «طلباتي الجارية» */}
        <Panel title={t("me.in_progress")} icon={Inbox} count={inProgress.length || undefined}>
          {inProgress.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{t("me.in_progress_none")}</p>
          ) : (
            <ul className="divide-y">
              {inProgress.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1 basis-48">
                    <p className="text-sm font-semibold">
                      {describeRequest(t, r, locale, { money: true })}{" "}
                      <span className="font-normal tabular-nums text-muted-foreground" dir="ltr">
                        {requestNoDisplay(r.no, locale)}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("me.ago", { n: Math.max(0, daysBetween((r.createdAt || today).slice(0, 10), today)) })}
                      {ctx.holderOf(r) && ` · ${t("me.held_by", { name: ctx.holderOf(r)! })}`}
                    </p>
                  </div>
                  <StatusPill tone={REQUEST_TONE[r.state]}>{t(`req.state.${r.state}`)}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* «آخر راتب» */}
        <Panel title={t("me.last_salary")} icon={Wallet}>
          {last ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{monthName(last.month, locale)}</p>
              <p className="text-2xl font-black tabular-nums" dir="ltr">
                {hrMoney(last.line.net)}
              </p>
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {last.state === "paid" ? t("me.paid_on", { date: hrDate(last.paidOn, locale) }) : t(`me.slip_state.${last.state}_long`)}
                {last.state === "held" && last.heldReason && <StatusPill tone="bad">{t(`me.held_reason.${last.heldReason}`)}</StatusPill>}
                {last.returned && <StatusPill tone="bad">{t("me.returned")}</StatusPill>}
              </p>
              {"gross" in last.line && (
                <KeyValueRow
                  label={t("me.gross_deductions")}
                  value={
                    <span dir="ltr">
                      {hrMoney(last.line.gross)} · {hrMoney(Math.round((last.line.gross - last.line.net) * 100) / 100)}
                    </span>
                  }
                />
              )}
              <Button size="sm" variant="outline" onClick={() => ctx.go("pay")}>
                {t("me.slip_details")}
              </Button>
            </div>
          ) : (
            <p className="py-2 text-sm text-muted-foreground">{t("me.no_salary")}</p>
          )}
        </Panel>
      </div>
    </div>
  )
}
