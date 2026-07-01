"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/routing"
import { useCollection, useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, query, where, doc } from "firebase/firestore"
import { Loader2, FolderOpen, PlusCircle, MapPin, DollarSign, FileText } from "lucide-react"

function fmtDate(val: unknown, locale: string) {
  if (!val) return "–"
  const d =
    val && typeof val === "object" && "toDate" in val && typeof (val as { toDate: () => Date }).toDate === "function"
      ? (val as { toDate: () => Date }).toDate()
      : new Date(val as string | number)
  return d.toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

type StatusFilter = "all" | "active" | "paused" | "completed"

export default function ProjectsListPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const firestore = useFirestore()
  const { user, isUserLoading } = useUser()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  const projectsQuery = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return query(
      collection(firestore, "projects"),
      where("organizationId", "==", (profile as { organizationId?: string } | null)?.organizationId || user.uid)
    )
  }, [firestore, user, isUserLoading, (profile as { organizationId?: string } | null)?.organizationId])

  const { data: allProjects, isLoading } = useCollection(projectsQuery)

  const projects = (allProjects || []).filter((p: unknown) => {
    const proj = p as { status?: string }
    if (statusFilter === "all") return true
    return proj.status === statusFilter
  })

  const statusTabs: { value: StatusFilter; label: string }[] = [
    { value: "all", label: t("rfq_all") },
    { value: "active", label: t("proj_status_active") },
    { value: "paused", label: t("proj_status_paused") },
    { value: "completed", label: t("proj_status_completed") },
  ]

  function getStatusBadge(status: string) {
    if (status === "active")
      return <Badge className="bg-accent/10 text-accent border-accent/20 font-semibold">{t("proj_status_active")}</Badge>
    if (status === "paused")
      return <Badge className="bg-amber-100 text-amber-700 border-amber-200 font-semibold">{t("proj_status_paused")}</Badge>
    if (status === "completed")
      return <Badge className="bg-success/10 text-success border-success/20 font-semibold">{t("proj_status_completed")}</Badge>
    return <Badge variant="secondary">{status}</Badge>
  }

  const pageLoading = isUserLoading || (isLoading && !allProjects)

  return (
    <PortalLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-foreground font-headline">{t("proj_title")}</h1>
            <p className="text-muted-foreground mt-1">{t("proj_desc")}</p>
          </div>
          <Link href="/contractor/projects/new">
            <Button className="gap-2 font-bold">
              <PlusCircle size={18} />
              {t("proj_new")}
            </Button>
          </Link>
        </div>

        {/* Status filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          {statusTabs.map((tab) => (
            <Button
              key={tab.value}
              variant={statusFilter === tab.value ? "default" : "outline"}
              size="sm"
              className="rounded-lg cursor-pointer"
              onClick={() => setStatusFilter(tab.value)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {/* Loading */}
        {pageLoading && (
          <div className="flex flex-col items-center justify-center p-20 text-muted-foreground">
            <Loader2 className="animate-spin mb-4" size={32} />
          </div>
        )}

        {/* Empty state */}
        {!pageLoading && projects.length === 0 && (
          <div
            className={cn(
              "flex flex-col items-center justify-center p-20 bg-slate-50 rounded-xl border border-dashed text-center gap-4"
            )}
          >
            <FolderOpen size={48} className="text-muted-foreground/40" />
            <div>
              <p className="font-bold text-lg text-foreground">{t("proj_empty")}</p>
              <p className="text-muted-foreground text-sm mt-1">{t("proj_empty_desc")}</p>
            </div>
            <Link href="/contractor/projects/new">
              <Button variant="outline" className="gap-2">
                <PlusCircle size={16} />
                {t("proj_new")}
              </Button>
            </Link>
          </div>
        )}

        {/* Project cards */}
        {!pageLoading && projects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map((proj: unknown) => {
              const p = proj as {
                id: string
                name?: string
                status?: string
                rfqIds?: string[]
                location?: string
                budget?: number
                createdAt?: unknown
              }
              return (
                <Link key={p.id} href={`/contractor/projects/${p.id}`}>
                  <Card className="group hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 border-slate-200/60 bg-white/60 backdrop-blur-xl h-full">
                    <CardContent className="p-5 flex flex-col gap-3">
                      {/* Top row: name + badge */}
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-lg text-slate-800 group-hover:text-primary transition-colors leading-snug line-clamp-2 flex-1">
                          {p.name || "—"}
                        </h3>
                        {p.status && getStatusBadge(p.status)}
                      </div>

                      {/* RFQ count */}
                      <div
                        className={cn(
                          "flex items-center gap-1.5 text-sm text-slate-600 bg-slate-50 px-2 py-1 rounded-md w-fit",
                          isRtl ? "flex-row-reverse" : ""
                        )}
                      >
                        <FileText size={14} className="text-primary" />
                        {t("proj_linked_rfqs", { count: p.rfqIds?.length || 0 })}
                      </div>

                      {/* Location */}
                      {p.location && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <MapPin size={13} className="text-accent shrink-0" />
                          <span className="truncate">{p.location}</span>
                        </div>
                      )}

                      {/* Budget */}
                      {p.budget != null && (
                        <div className="flex items-center gap-1.5 text-xs text-slate-500">
                          <DollarSign size={13} className="text-success shrink-0" />
                          <span>
                            {t("proj_budget_label")}: {p.budget.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")}
                          </span>
                        </div>
                      )}

                      {/* Created date */}
                      <p className="text-[11px] text-muted-foreground mt-auto pt-2 border-t border-slate-100">
                        {t("proj_created_at")}: {fmtDate(p.createdAt, locale)}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </PortalLayout>
  )
}
