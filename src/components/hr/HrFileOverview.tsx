"use client"

// The employee file's Overview (the prototype's efAlerts + efOverview): the
// facts that block or warn first — an expired iqama (and the site he is on
// now), a passport to renew before the iqama, an arrival's iqama countdown, a
// work injury until reported, a returned transfer (to the roles that see pay,
// never the IBAN), an expired driving licence — then the cards: personal, job
// and contract (cost centre, project end, line manager — "derived" unless set),
// contact and bank, the line manager's probation view, and the end of service.

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { Callout } from "@/components/module-ui/Callout"
import { KeyValueRow } from "@/components/module-ui/KeyValueRow"
import { Panel } from "@/components/module-ui/Panel"
import { StatusPill } from "@/components/module-ui/StatusPill"
import { useScopedCollection } from "@/hooks/useScopedCollection"
import { hrPeopleScope, hrScopeAt } from "@/lib/hr/access"
import { HR_INJURIES } from "@/lib/hr/collections"
import { bankOfIban, driveDocOf, iqamaDueBy, iqamaOverdue, legalOnSite, mayDrive, passportFirst } from "@/lib/hr/documents"
import { COST_ACCOUNT, probationState } from "@/lib/hr/employee"
import { hrDate } from "@/lib/hr/format"
import type { HrInjury } from "@/lib/hr/injuries"
import { costKindOf, UNASSIGNED_SITE } from "@/lib/hr/sites"
import { daysBetween } from "@/lib/hr/statutory"
import { tradeOf } from "@/lib/hr/trades"
import { HrExitPanel } from "./HrExitPanel"
import type { FileView } from "./hr-file-view"

export function HrFileOverview({ v }: { v: FileView }) {
  const t = useTranslations("Portal.HR")
  const { emp, today, locale, access, pay, site } = v
  const docs = emp.docs ?? {}
  const { data: injData } = useScopedCollection<HrInjury>(HR_INJURIES, access.orgId, hrScopeAt(hrPeopleScope(access.ctx), emp.siteId), access.ctx.roles.size > 0, [["employeeId", emp.id]])
  const openInjury = useMemo(() => ((injData ?? []) as unknown as HrInjury[]).filter((i) => !i.report).sort((a, b) => b.on.localeCompare(a.on))[0] ?? null, [injData])
  const legal = legalOnSite({ ...emp, docs }, today)
  const overdue = iqamaOverdue({ ...emp, docs }, today)
  const drives = driveDocOf(emp.trade)
  const onSite = Boolean(emp.siteId && emp.siteId !== UNASSIGNED_SITE)
  const pendingIqama = emp.nationality !== "sa" && emp.source === "visa" && !docs.iqama && emp.join && !overdue
  const trade = tradeOf(emp.trade)
  const kind = costKindOf(site?.type ?? UNASSIGNED_SITE)
  const bank = pay?.bank || bankOfIban(pay?.iban)
  const view = emp.probationView
  const pState = emp.probation ? probationState(emp, today) : null
  const years = Math.floor(v.service)
  const months = Math.floor((v.service - years) * 12)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {!legal && (
          <Callout tone="block" title={t("file.alert.iqama_title")}>
            {overdue ? t("file.iqama_overdue", { date: hrDate(iqamaDueBy(emp.join), locale) }) : t("file.iqama_expired")}
            {onSite && <span className="block font-semibold">{t("file.alert.on_site_now", { site: v.siteName(emp.siteId) ?? "—" })}</span>}
          </Callout>
        )}
        {passportFirst(docs, today) && <Callout tone="warn" title={t("file.alert.passport_first_title")}>{t("file.alert.passport_first", { date: hrDate(docs.passport, locale) })}</Callout>}
        {pendingIqama && (
          <Callout tone="info" title={t("file.alert.no_iqama_title")}>
            {t("file.alert.no_iqama", { join: hrDate(emp.join, locale), due: hrDate(iqamaDueBy(emp.join), locale), n: Math.max(0, daysBetween(today, iqamaDueBy(emp.join))) })}
          </Callout>
        )}
        {openInjury && (
          <Callout tone="block" title={t("file.alert.injury_title", { date: hrDate(openInjury.on, locale) })}>
            {t("file.alert.injury", { due: hrDate(openInjury.due, locale) })}
          </Callout>
        )}
        {v.money && pay?.ibanState === "returned" && <Callout tone="block" title={t("file.alert.returned_title")}>{t("file.alert.returned")}</Callout>}
        {drives && !mayDrive({ docs, drives }, today) && <Callout tone="block" title={t("file.alert.licence_title")}>{t("file.alert.licence")}</Callout>}
      </div>

      <HrExitPanel access={access} actor={v.actor} emp={emp} pay={pay} sites={v.sites} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("file.personal")}>
          <KeyValueRow label={t("file.name_ar")} value={emp.names.ar || t("file.not_recorded")} />
          <KeyValueRow label={t("file.name_en")} value={emp.names.en || t("file.not_recorded")} ltr={Boolean(emp.names.en)} />
          <KeyValueRow label={t("file.nationality")} value={t(`nat.${emp.nationality}` as "nat.sa")} />
          <KeyValueRow label={t("new.gender")} value={t(`gender.${emp.gender}`)} />
          <KeyValueRow label={t(emp.nationality === "sa" ? "new.national_id" : "new.iqama_no")} value={emp.idNo || t("file.not_recorded")} ltr={Boolean(emp.idNo)} />
          {emp.nationality !== "sa" && <KeyValueRow label={t("file.passport_no")} value={docs.no?.passport || t("file.not_recorded")} ltr={Boolean(docs.no?.passport)} />}
          <KeyValueRow label={t("file.education")} value={emp.education || t("file.not_recorded")} />
          <KeyValueRow label={t("new.source")} value={emp.since ? t("file.imported", { month: emp.since }) : t(`source.${emp.source}`)} />
        </Panel>
        <Panel title={t("file.job")}>
          <KeyValueRow label={t("file.no")} value={String(emp.no)} ltr />
          <KeyValueRow label={t("new.trade")} value={t(`trade.${emp.trade}` as "trade.mason")} />
          <KeyValueRow label={t("file.category")} value={t(`category.${trade?.category ?? emp.category}`)} />
          <KeyValueRow
            label={t("new.site")}
            value={
              <span>
                {v.siteName(emp.siteId) ?? t("sites.unassigned")}
                {site?.type === "project" && site.endDate && <span className="ms-1.5 text-xs text-muted-foreground">{t("file.site_ends", { date: hrDate(site.endDate, locale) })}</span>}
              </span>
            }
          />
          <KeyValueRow
            label={t("file.cost_centre")}
            value={
              <span>
                <span dir="ltr" className="tabular-nums">
                  {COST_ACCOUNT[kind]}
                </span>
                <span className="ms-1.5 text-xs text-muted-foreground">{t(`cost_kind.${kind}`)}</span>
              </span>
            }
          />
          <KeyValueRow
            label={t("file.line_manager")}
            value={
              <span>
                {v.manager.name ?? t("file.line_manager_mgmt")}
                {v.manager.derived && <span className="ms-1.5 text-xs text-muted-foreground">{t("file.derived")}</span>}
              </span>
            }
          />
          <KeyValueRow label={t("new.join")} value={`${hrDate(emp.join, locale)} · ${t("file.service_ym", { y: years, m: months })}`} />
          <KeyValueRow
            label={t("new.contract")}
            value={
              emp.contract?.type === "fixed" ? (
                <span>
                  {t("file.fixed_until", { date: hrDate(emp.contract.end, locale) })}
                  <span className="ms-1.5 text-xs text-muted-foreground">{t("file.renews_unless")}</span>
                </span>
              ) : (
                t("contract.open")
              )
            }
          />
          <KeyValueRow
            label={t("file.probation")}
            value={
              emp.probation?.decision
                ? t(`file.probation_${emp.probation.decision}`)
                : pState === "lapsed"
                  ? t("file.probation_lapsed", { date: hrDate(emp.probation?.end, locale) })
                  : t("file.probation_until", { date: hrDate(emp.probation?.end, locale) })
            }
          />
        </Panel>
        <Panel title={t("file.contact_bank")}>
          {(["mobile", "address", "emergency"] as const).map((f) => (
            <KeyValueRow key={f} label={t(`data_field.${f}`)} value={emp.contact?.[f] || t("file.not_recorded")} />
          ))}
          {v.money && (
            <>
              <KeyValueRow label={t("file.bank")} value={bank ? t(`bank.${bank}` as "bank.80") : t("file.not_recorded")} />
              <KeyValueRow
                label={t("file.iban")}
                value={
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span dir="ltr">{pay?.iban || t("file.not_recorded")}</span>
                    {pay?.ibanState === "returned" && <StatusPill tone="bad">{t("file.iban_returned")}</StatusPill>}
                    {pay?.ibanState === "fixed" && <StatusPill tone="warn">{t("file.iban_awaiting")}</StatusPill>}
                  </span>
                }
              />
            </>
          )}
          <KeyValueRow label={t("file.my_file")} value={emp.userId ? t("file.linked_yes") : t("file.linked_no")} />
          <p className="pt-2 text-[11px] text-muted-foreground">{t("file.contact_note")}</p>
        </Panel>
        {(view || (pState === "on" && (access.allowed("request.decide") || v.manager.id))) && (
          <Panel title={t("file.probation_view")}>
            {view ? (
              <>
                <KeyValueRow label={t("pview.rating")} value={t(`pview.ratings.${view.rating}`)} />
                <KeyValueRow label={t("pview.recommend")} value={t(`pview.recs.${view.recommend}`)} />
                {view.note && <KeyValueRow label={t("pview.note")} value={<span dir="auto">{view.note}</span>} />}
                <KeyValueRow label={t("pview.by")} value={`${view.byName || "—"} · ${hrDate(view.at.slice(0, 10), locale)}`} />
              </>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">{t("pview.none")}</p>
            )}
            <p className="pt-2 text-[11px] text-muted-foreground">{t("pview.never_blocks")}</p>
          </Panel>
        )}
      </div>
    </div>
  )
}
