
"use client"

import { PortalLayout } from "@/components/layout/portal-layout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Bell, ShieldAlert, UserPlus, FileWarning } from "lucide-react"
import { useTranslations, useLocale } from 'next-intl'

export default function AdminNotificationsPage() {
  const t = useTranslations("Portal.Admin.Notifications")
  const locale = useLocale()
  const adminLogs = [
    { id: 1, event: t("event_verify_request"), user: t("event_user_strong_build"), time: "2024-05-20 14:30", status: t("event_status_pending_review"), type: "verify" },
    { id: 2, event: t("event_new_contractor"), user: t("event_user_premium_construction"), time: "2024-05-20 12:15", status: t("event_status_active"), type: "register" },
    { id: 3, event: t("event_security_alert"), user: t("event_user_security_system"), time: "2024-05-19 23:45", status: t("event_status_blocked"), type: "security" },
    { id: 4, event: t("event_content_report"), user: t("event_user_rfq_701"), time: "2024-05-19 18:20", status: t("event_status_under_investigation"), type: "report" },
  ]

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-secondary font-headline">{t("page_title")}</h1>
          <p className="text-muted-foreground mt-1">{t("page_subtitle")}</p>
        </div>

        <Card className="border-none shadow-sm">
          <CardHeader className="bg-white border-b px-6 py-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bell className="text-primary" size={20} />
              {t("events_list")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="font-semibold">{t("event")}</TableHead>
                  <TableHead className="font-semibold">{t("user_source")}</TableHead>
                  <TableHead className="font-semibold">{t("time")}</TableHead>
                  <TableHead className="font-semibold">{t("status")}</TableHead>
                  <TableHead className="font-semibold">{t("type")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adminLogs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-bold py-4">{log.event}</TableCell>
                    <TableCell className="py-4">{log.user}</TableCell>
                    <TableCell className="text-xs text-muted-foreground py-4">{log.time}</TableCell>
                    <TableCell className="py-4">
                      <Badge variant="secondary" className="font-normal">{log.status}</Badge>
                    </TableCell>
                    <TableCell className="py-4">
                      {log.type === 'verify' && <ShieldAlert size={16} className="text-amber-500" />}
                      {log.type === 'register' && <UserPlus size={16} className="text-success" />}
                      {log.type === 'security' && <ShieldAlert size={16} className="text-destructive" />}
                      {log.type === 'report' && <FileWarning size={16} className="text-primary" />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
