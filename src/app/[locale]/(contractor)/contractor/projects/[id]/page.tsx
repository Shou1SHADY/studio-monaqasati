"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { useRouter } from "@/i18n/routing"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Link } from "@/i18n/routing"
import { useDoc, useCollection, useFirestore, useUser, useMemoFirebase } from "@/firebase"
import { doc, collection, query, where, updateDoc, deleteDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import {
  Loader2,
  MapPin,
  DollarSign,
  Calendar,
  FileText,
  Pencil,
  Trash2,
  Save,
  X,
  FolderOpen,
} from "lucide-react"

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

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  if (status === "active")
    return <Badge className="bg-accent/10 text-accent border-accent/20 font-semibold">{t("proj_status_active")}</Badge>
  if (status === "paused")
    return <Badge className="bg-amber-100 text-amber-700 border-amber-200 font-semibold">{t("proj_status_paused")}</Badge>
  if (status === "completed")
    return <Badge className="bg-success/10 text-success border-success/20 font-semibold">{t("proj_status_completed")}</Badge>
  return <Badge variant="secondary">{status}</Badge>
}

export default function ProjectDetailPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const router = useRouter()
  const params = useParams()
  const projectId = params.id as string
  const firestore = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()

  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editLocation, setEditLocation] = useState("")
  const [editBudget, setEditBudget] = useState("")
  const [editStatus, setEditStatus] = useState<"active" | "paused" | "completed">("active")
  const [isSaving, setIsSaving] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const projectDocRef = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return doc(firestore, "projects", projectId)
  }, [firestore, projectId])

  const { data: project, isLoading: projectLoading } = useDoc(projectDocRef)

  const linkedRfqsQuery = useMemoFirebase(() => {
    if (!firestore || !projectId) return null
    return query(collection(firestore, "rfqs"), where("projectId", "==", projectId))
  }, [firestore, projectId])

  const { data: linkedRfqs, isLoading: rfqsLoading } = useCollection(linkedRfqsQuery)

  const typedProject = project as {
    name?: string
    description?: string
    location?: string
    budget?: number
    status?: string
    rfqIds?: string[]
    createdAt?: unknown
  } | null

  const startEdit = () => {
    if (!typedProject) return
    setEditName(typedProject.name || "")
    setEditDescription(typedProject.description || "")
    setEditLocation(typedProject.location || "")
    setEditBudget(typedProject.budget != null ? String(typedProject.budget) : "")
    setEditStatus((typedProject.status as "active" | "paused" | "completed") || "active")
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (!firestore || !projectDocRef) return
    setIsSaving(true)
    try {
      await updateDoc(projectDocRef, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        location: editLocation.trim() || null,
        budget: editBudget ? Number(editBudget) : null,
        status: editStatus,
        updatedAt: serverTimestamp(),
      })
      toast({ title: t("proj_toast_updated") })
      setIsEditing(false)
    } catch (err) {
      console.error(err)
      toast({
        title: t("generic_error_title"),
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!firestore || !projectDocRef) return
    setIsDeleting(true)
    try {
      await deleteDoc(projectDocRef)
      toast({ title: t("proj_toast_deleted") })
      router.push("/contractor/projects")
    } catch (err) {
      console.error(err)
      toast({
        title: t("generic_error_title"),
        variant: "destructive",
      })
      setIsDeleting(false)
    }
  }

  function getRfqStatusBadge(status: string) {
    if (status === "New")
      return <Badge className="bg-blue-50 text-blue-600 border-none text-xs">{t("rfq_status_active")}</Badge>
    if (status === "Draft")
      return <Badge className="bg-slate-100 text-slate-600 text-xs">{t("rfq_status_draft")}</Badge>
    if (status === "Awarded")
      return <Badge className="bg-success/10 text-success border-success/20 text-xs">{t("proj_rfq_status_awarded")}</Badge>
    return <Badge variant="secondary" className="text-xs">{status}</Badge>
  }

  if (projectLoading) {
    return (
      <PortalLayout>
        <div className="flex items-center justify-center p-20">
          <Loader2 className="animate-spin text-muted-foreground" size={40} />
        </div>
      </PortalLayout>
    )
  }

  if (!typedProject) {
    return (
      <PortalLayout>
        <div className="text-center p-20 text-muted-foreground">
          <FolderOpen size={48} className="mx-auto mb-4 opacity-20" />
          <p>{t("proj_not_found")}</p>
        </div>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Project info card */}
        <Card className="border-slate-200/60">
          <CardHeader className="border-b pb-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="text-2xl font-black h-12 rounded-xl"
                    disabled={isSaving}
                  />
                ) : (
                  <h1 className="text-2xl font-black text-foreground font-headline leading-snug">
                    {typedProject.name}
                  </h1>
                )}
                {typedProject.status && !isEditing && (
                  <div className="mt-2">
                    <StatusBadge status={typedProject.status} t={t} />
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {isEditing ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditing(false)}
                      disabled={isSaving}
                      className="gap-1"
                    >
                      <X size={14} />
                      {t("cancel")}
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={isSaving} className="gap-1">
                      {isSaving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                      {t("proj_update")}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="outline" size="sm" onClick={startEdit} className="gap-1">
                      <Pencil size={14} />
                      {t("proj_edit")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowDeleteDialog(true)}
                      className="gap-1 text-destructive border-destructive/30 hover:bg-destructive hover:text-white hover:border-destructive"
                    >
                      <Trash2 size={14} />
                      {t("proj_delete")}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-6" dir={isRtl ? "rtl" : "ltr"}>
            {isEditing ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="font-semibold">{t("proj_description")}</Label>
                  <Textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    rows={3}
                    className="rounded-xl resize-none"
                    disabled={isSaving}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="font-semibold">{t("proj_location")}</Label>
                    <Input
                      value={editLocation}
                      onChange={(e) => setEditLocation(e.target.value)}
                      className="h-10 rounded-xl"
                      disabled={isSaving}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-semibold">{t("proj_budget")}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={editBudget}
                      onChange={(e) => setEditBudget(e.target.value)}
                      className="h-10 rounded-xl"
                      disabled={isSaving}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="font-semibold">{t("proj_status")}</Label>
                  <Select
                    value={editStatus}
                    onValueChange={(v) => setEditStatus(v as "active" | "paused" | "completed")}
                    disabled={isSaving}
                  >
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">{t("proj_status_active")}</SelectItem>
                      <SelectItem value="paused">{t("proj_status_paused")}</SelectItem>
                      <SelectItem value="completed">{t("proj_status_completed")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {typedProject.description && (
                  <div className="sm:col-span-2 text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
                    {typedProject.description}
                  </div>
                )}
                {typedProject.location && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <MapPin size={16} className="text-accent shrink-0" />
                    <span>
                      <span className="font-semibold text-slate-500 text-xs block">{t("proj_location_label")}</span>
                      {typedProject.location}
                    </span>
                  </div>
                )}
                {typedProject.budget != null && (
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <DollarSign size={16} className="text-success shrink-0" />
                    <span>
                      <span className="font-semibold text-slate-500 text-xs block">{t("proj_budget_label")}</span>
                      {typedProject.budget.toLocaleString(locale === "ar" ? "ar-SA" : "en-US")}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Calendar size={16} className="text-primary shrink-0" />
                  <span>
                    <span className="font-semibold text-slate-500 text-xs block">{t("proj_created_at")}</span>
                    {fmtDate(typedProject.createdAt, locale)}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Linked RFQs */}
        <Card className="border-slate-200/60">
          <CardHeader className="border-b pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText size={20} className="text-primary" />
              {t("proj_rfqs")}
              {linkedRfqs && linkedRfqs.length > 0 && (
                <Badge variant="secondary" className="ms-2">
                  {linkedRfqs.length}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {rfqsLoading ? (
              <div className="flex items-center justify-center p-10">
                <Loader2 className="animate-spin text-muted-foreground" size={24} />
              </div>
            ) : !linkedRfqs || linkedRfqs.length === 0 ? (
              <div className="text-center p-10 bg-slate-50 rounded-lg border border-dashed text-muted-foreground">
                <FileText size={36} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm">{t("proj_rfqs_empty")}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {(linkedRfqs as unknown[]).map((rfq) => {
                  const r = rfq as {
                    id: string
                    title?: string
                    category?: string
                    status?: string
                    offersCount?: number
                    deadline?: string
                  }
                  return (
                    <Link key={r.id} href={`/contractor/rfqs/${r.id}/offers`}>
                      <div className="flex items-center justify-between gap-3 p-4 bg-white border border-slate-100 rounded-xl hover:border-primary/30 hover:bg-primary/5 transition-all group">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 truncate group-hover:text-primary">
                            {r.title || r.id}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">{r.category}</p>
                        </div>
                        <div className={cn("flex items-center gap-2 shrink-0", isRtl ? "flex-row-reverse" : "")}>
                          {r.status && getRfqStatusBadge(r.status)}
                          <span className="text-xs text-slate-500">
                            {r.offersCount || 0} {t("proj_offers_count_label")}
                          </span>
                          {r.deadline && (
                            <span className="text-xs text-muted-foreground hidden sm:block">
                              {new Date(r.deadline).toLocaleDateString(locale === "ar" ? "ar-SA" : "en-US")}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={(open) => !open && setShowDeleteDialog(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("proj_delete")}</AlertDialogTitle>
            <AlertDialogDescription>{t("proj_delete_confirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
              {t("proj_delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalLayout>
  )
}
