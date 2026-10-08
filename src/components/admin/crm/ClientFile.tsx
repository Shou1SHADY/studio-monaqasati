"use client"

import { useMemo } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, ArrowRight, Building2, CalendarDays, ClipboardList, Clock, FileText, Loader2, MapPin, Tag, Mail, Phone, UserRound } from "lucide-react"
import { PortalLayout } from "@/components/layout/portal-layout"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/module-ui/NativeSelect"
import { Link } from "@/i18n/routing"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { staffName, useAdminCrm } from "@/hooks/useAdminCrm"
import { CLIENT_STAGES, activityState, companySizeRange, effectiveContacts, formatCrmDate, toDateKey, type ClientRecord } from "@/lib/admin-crm"
import { saveRecord } from "@/lib/admin-crm-writes"
import { ActivitiesSection } from "./ActivitiesSection"
import { ContactsSection } from "./ContactsSection"
import { CrmKpi, InfoItem, LtrValue, StageBadge } from "./parts"
import { QuotesSection } from "./QuotesSection"
import { useStageChange } from "./useStageChange"

/** ADM-10: a client's file — same skeleton as a lead's (ADM-05). A client that was a lead brings its activities, contacts and quotes along. */
export function ClientFile({ clientId }: { clientId: string }) {
  const t = useTranslations("Portal.Admin.Crm")
  const locale = useLocale()
  const firestore = useFirestore()
  const { toast } = useToast()
  const crm = useAdminCrm()
  const row = crm.clientRows.find((r) => r.id === clientId) ?? null
  const rec: ClientRecord = crm.records[clientId] ?? {}
  const from = rec.convertedFromLead ?? ""
  const leadRec: ClientRecord = crm.records[from] ?? {}
  const leadRow = crm.leadRows.find((r) => r.crmId === from) ?? null
  const Back = locale === "ar" ? ArrowRight : ArrowLeft

  const actorName = staffName(crm.staff.find((s) => s.id === crm.user?.uid) ?? { id: crm.user?.uid ?? "", email: crm.user?.email ?? "" })
  const actor = { uid: crm.user?.uid ?? "", name: actorName }
  const stage = useStageChange(actor)
  const own = (rec.contacts?.length ? rec.contacts : leadRec.contacts) ?? undefined
  const contacts = useMemo(() => effectiveContacts(own, { name: row?.name ?? "", phone: row?.phone ?? "", email: row?.email ?? "" }), [own, row?.name, row?.phone, row?.email])
  const quoteTotal = (crm.quoteCount[clientId] ?? 0) + (from ? crm.quoteCount[from] ?? 0 : 0)
  const mine = useMemo(() => crm.activities.filter((a) => a.clientId === clientId || (from && a.clientId === from)), [crm.activities, clientId, from])
  const today = toDateKey(new Date())

  const save = async (patch: Partial<ClientRecord>) => {
    if (!firestore) return
    try {
      // The first edit on a converted client copies what came from the lead, so the file is its own from then on.
      await saveRecord(firestore, clientId, { ...(own && !rec.contacts?.length ? { contacts: own } : {}), ...patch })
    } catch {
      toast({ variant: "destructive", title: t("save_failed") })
    }
  }
  const setOwner = (uid: string) => {
    const s = crm.staff.find((x) => x.id === uid)
    return save(uid ? { ownerUid: uid, ownerName: s ? staffName(s) : "" } : { ownerUid: "", ownerName: "" })
  }
  const parties = row ? [{ id: clientId, label: row.name, contacts }] : []
  const openActivities = mine.filter((a) => activityState(a, today) !== "done").length
  const convertedAt = rec.convertedAt?.seconds ? rec.convertedAt.seconds * 1000 : leadRow?.convertedMs ?? 0

  return (
    <PortalLayout>
      <div className="space-y-6" dir={locale === "ar" ? "rtl" : "ltr"}>
        <Button variant="ghost" size="sm" asChild className="-ms-2 gap-1.5">
          <Link href="/admin/crm?tab=clients">
            <Back size={15} aria-hidden="true" />
            {t("back_to_crm")}
          </Link>
        </Button>

        {crm.loading.clients && !row ? (
          <div className="flex justify-center p-16">
            <Loader2 className="animate-spin text-primary" size={28} />
          </div>
        ) : !row ? (
          <p className="rounded-xl border p-12 text-center text-sm text-muted-foreground">{t("client_not_found")}</p>
        ) : (
          <>
            <header className="space-y-2">
              <h1 className="flex items-center gap-2 text-2xl font-black md:text-3xl">
                <Building2 size={24} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate">{row.name}</span>
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-success/30 bg-success/10 text-success">{t("client_badge")}</Badge>
                <StageBadge stage={row.stage} label={t(`stage_${row.stage}`)} />
                <Badge variant="outline">{t(row.role === "Contractor" ? "role_contractor" : "role_supplier")}</Badge>
              </div>
            </header>

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <CrmKpi icon={ClipboardList} label={t("kpi_open_activities")} value={openActivities} />
              <CrmKpi icon={FileText} label={t("quotes_title")} value={quoteTotal} />
              <CrmKpi icon={Clock} label={t("last_contact")} value={row.daysSinceContact === null ? t("never_contacted") : t("days_ago", { n: row.daysSinceContact })} tone={row.stale ? "warning" : undefined} />
              <CrmKpi icon={CalendarDays} label={t("client_since")} value={<span className="text-base">{formatCrmDate(row.sinceMs, locale)}</span>} />
            </div>

            <section className="grid gap-5 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3">
              <InfoItem icon={UserRound} label={t("owner_label")}>
                <NativeSelect aria-label={t("owner_label")} className="h-9 w-full max-w-56" value={row.ownerUid} onChange={(e) => void setOwner(e.target.value)}>
                  <option value="">{t("unassigned")}</option>
                  {crm.staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {staffName(s)}
                    </option>
                  ))}
                </NativeSelect>
              </InfoItem>
              <InfoItem icon={Tag} label={t("col_status")}>
                <NativeSelect aria-label={t("col_status")} className="h-9 w-full max-w-56" value={row.stage} onChange={(e) => stage.ask(clientId, row.name, row.stage, e.target.value)}>
                  {CLIENT_STAGES.map((s) => (
                    <option key={s} value={s}>
                      {t(`stage_${s}`)}
                    </option>
                  ))}
                </NativeSelect>
              </InfoItem>
              <InfoItem icon={Building2} label={t("col_type")}>
                {t(row.role === "Contractor" ? "role_contractor" : "role_supplier")}
              </InfoItem>
              <InfoItem icon={MapPin} label={t("city_label")}>
                {row.city || "—"}
              </InfoItem>
              <InfoItem icon={Building2} label={t("size_label")}>
                {companySizeRange(row.size) ? <bdi dir="ltr">{t("size_value", { range: companySizeRange(row.size) })}</bdi> : "—"}
              </InfoItem>
              {leadRow && (
                <InfoItem icon={Tag} label={t("first_source")}>
                  {t(`channel_${leadRow.channel}`)}
                </InfoItem>
              )}
              <InfoItem icon={Phone} label={t("phone")}>
                <LtrValue value={row.phone} />
              </InfoItem>
              <InfoItem icon={Mail} label={t("email")}>
                <LtrValue value={row.email} />
              </InfoItem>
            </section>

            <ContactsSection recordId={clientId} contacts={contacts} />
            <ActivitiesSection recordId={clientId} activities={mine} parties={parties} staff={crm.staff} actor={actor} />
            <QuotesSection recordId={clientId} alsoIds={from ? [from] : []} author={actor} />
            {stage.dialog}
            {convertedAt > 0 && <p className="text-xs text-muted-foreground">{t("converted_on", { date: formatCrmDate(convertedAt, locale) })}</p>}
          </>
        )}
      </div>
    </PortalLayout>
  )
}
