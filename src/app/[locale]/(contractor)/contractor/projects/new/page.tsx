"use client"

import { useState, useRef } from "react"
import { useTranslations, useLocale } from "next-intl"
import { useRouter } from "@/i18n/routing"
import { PortalLayout } from "@/components/layout/portal-layout"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { useFirestore, useStorage, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, doc, addDoc, serverTimestamp } from "firebase/firestore"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import { useToast } from "@/hooks/use-toast"
import { Loader2, FolderPlus, Upload, FileText, X } from "lucide-react"

const PROJECT_TYPES = [
  "proj_type_infrastructure",
  "proj_type_buildings",
  "proj_type_roads",
  "proj_type_industrial",
  "proj_type_energy",
  "proj_type_other",
] as const

const SAUDI_REGIONS = [
  "الرياض",
  "مكة المكرمة",
  "المدينة المنورة",
  "القصيم",
  "المنطقة الشرقية",
  "عسير",
  "تبوك",
  "حائل",
  "الحدود الشمالية",
  "جازان",
  "نجران",
  "الباحة",
  "الجوف",
]

const CLIENT_TYPES = [
  "proj_client_government",
  "proj_client_private",
  "proj_client_semi_government",
] as const

export default function NewProjectPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const router = useRouter()
  const firestore = useFirestore()
  const storage = useStorage()
  const { toast } = useToast()
  const { user, isUserLoading } = useUser()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [location, setLocation] = useState("")
  const [budget, setBudget] = useState("")
  const [status, setStatus] = useState<"active" | "paused" | "completed">("active")
  const [projectType, setProjectType] = useState("")
  const [region, setRegion] = useState("")
  const [clientType, setClientType] = useState("")
  const [blueprintFile, setBlueprintFile] = useState<File | null>(null)
  const [blueprintUploading, setBlueprintUploading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [nameError, setNameError] = useState("")

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type === "application/pdf") {
      setBlueprintFile(file)
    } else if (file) {
      toast({ title: "PDF فقط", description: "يرجى اختيار ملف PDF", variant: "destructive" })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setNameError(t("proj_name_required"))
      return
    }
    if (!user || !firestore) return

    setIsSubmitting(true)
    setNameError("")

    try {
      const typedProfile = profile as { organizationId?: string } | null
      let blueprintUrl: string | null = null

      if (blueprintFile && storage) {
        setBlueprintUploading(true)
        const storageRef = ref(storage, `projects/${user.uid}/${Date.now()}_${blueprintFile.name}`)
        await uploadBytes(storageRef, blueprintFile)
        blueprintUrl = await getDownloadURL(storageRef)
        setBlueprintUploading(false)
      }

      await addDoc(collection(firestore, "projects"), {
        organizationId: typedProfile?.organizationId || user.uid,
        contractorId: user.uid,
        name: name.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        region: region || null,
        budget: budget ? Number(budget) : null,
        status,
        projectType: projectType || null,
        clientType: clientType || null,
        blueprintUrl,
        rfqIds: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      toast({ title: t("proj_toast_created") })
      router.push("/contractor/projects")
    } catch (err) {
      console.error(err)
      toast({
        title: t("generic_error_title"),
        description: t("proj_toast_save_error"),
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
      setBlueprintUploading(false)
    }
  }

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-black text-foreground font-headline">{t("proj_new")}</h1>
          <p className="text-muted-foreground mt-1">{t("proj_desc")}</p>
        </div>

        <Card className="border-slate-200/60">
          <CardHeader className="border-b pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FolderPlus size={20} className="text-primary" />
              {t("proj_new")}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-5" dir={isRtl ? "rtl" : "ltr"}>
              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="proj-name" className="font-semibold">
                  {t("proj_name")} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="proj-name"
                  value={name}
                  onChange={(e) => { setName(e.target.value); setNameError("") }}
                  placeholder={t("proj_name_placeholder")}
                  className={cn("h-11 rounded-xl", nameError ? "border-destructive" : "")}
                  disabled={isSubmitting}
                />
                {nameError && <p className="text-xs text-destructive">{nameError}</p>}
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label htmlFor="proj-desc" className="font-semibold">{t("proj_description")}</Label>
                <Textarea
                  id="proj-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="rounded-xl resize-none"
                  disabled={isSubmitting}
                />
              </div>

              {/* Project Type + Client Type */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="font-semibold">{t("proj_type")}</Label>
                  <Select value={projectType} onValueChange={setProjectType} disabled={isSubmitting}>
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue placeholder={t("proj_type_placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {PROJECT_TYPES.map((key) => (
                        <SelectItem key={key} value={key}>{t(key)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="font-semibold">{t("proj_client_type")}</Label>
                  <Select value={clientType} onValueChange={setClientType} disabled={isSubmitting}>
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue placeholder={t("proj_client_type_placeholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {CLIENT_TYPES.map((key) => (
                        <SelectItem key={key} value={key}>{t(key)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Region */}
              <div className="space-y-1.5">
                <Label className="font-semibold">{t("proj_region")}</Label>
                <Select value={region} onValueChange={setRegion} disabled={isSubmitting}>
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue placeholder={t("proj_region_placeholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {SAUDI_REGIONS.map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Location (detailed) */}
              <div className="space-y-1.5">
                <Label htmlFor="proj-location" className="font-semibold">{t("proj_location")}</Label>
                <Input
                  id="proj-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="h-11 rounded-xl"
                  disabled={isSubmitting}
                />
              </div>

              {/* Budget + Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="proj-budget" className="font-semibold">{t("proj_budget")}</Label>
                  <Input
                    id="proj-budget"
                    type="number"
                    min={0}
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    className="h-11 rounded-xl"
                    disabled={isSubmitting}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-semibold">{t("proj_status")}</Label>
                  <Select value={status} onValueChange={(v) => setStatus(v as typeof status)} disabled={isSubmitting}>
                    <SelectTrigger className="h-11 rounded-xl">
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

              {/* Blueprint PDF Upload */}
              <div className="space-y-1.5">
                <Label className="font-semibold">{t("proj_blueprint_pdf")}</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {blueprintFile ? (
                  <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-xl">
                    <FileText size={20} className="text-primary shrink-0" />
                    <span className="text-sm font-medium text-primary flex-1 truncate">{blueprintFile.name}</span>
                    <button
                      type="button"
                      onClick={() => { setBlueprintFile(null); if (fileInputRef.current) fileInputRef.current.value = "" }}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      aria-label="Remove file"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSubmitting}
                    className="w-full flex flex-col items-center justify-center gap-2 h-20 border-2 border-dashed border-slate-200 rounded-xl text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all"
                  >
                    <Upload size={20} />
                    <span className="text-sm font-medium">{t("proj_blueprint_upload")}</span>
                  </button>
                )}
              </div>

              {/* Submit */}
              <Button
                type="submit"
                className="w-full h-11 font-bold gap-2"
                disabled={isSubmitting || isUserLoading || blueprintUploading}
              >
                {(isSubmitting || blueprintUploading) ? <Loader2 className="animate-spin" size={16} /> : <FolderPlus size={16} />}
                {blueprintUploading ? t("proj_blueprint_uploading") : t("proj_save")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
