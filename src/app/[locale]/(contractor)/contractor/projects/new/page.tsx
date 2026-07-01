"use client"

import { useState } from "react"
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
import { useFirestore, useUser, useMemoFirebase, useDoc } from "@/firebase"
import { collection, doc, addDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { Loader2, FolderPlus } from "lucide-react"

export default function NewProjectPage() {
  const t = useTranslations("Portal.Contractor")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const router = useRouter()
  const firestore = useFirestore()
  const { toast } = useToast()
  const { user, isUserLoading } = useUser()

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [location, setLocation] = useState("")
  const [budget, setBudget] = useState("")
  const [status, setStatus] = useState<"active" | "paused" | "completed">("active")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [nameError, setNameError] = useState("")

  const userDocRef = useMemoFirebase(() => {
    if (isUserLoading || !user || !firestore) return null
    return doc(firestore, "users", user.uid)
  }, [firestore, user, isUserLoading])
  const { data: profile } = useDoc(userDocRef)

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
      await addDoc(collection(firestore, "projects"), {
        organizationId: typedProfile?.organizationId || user.uid,
        contractorId: user.uid,
        name: name.trim(),
        description: description.trim() || null,
        location: location.trim() || null,
        budget: budget ? Number(budget) : null,
        status,
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
    }
  }

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
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
                  className={cn(
                    "h-11 rounded-xl",
                    nameError ? "border-destructive focus-visible:ring-destructive" : ""
                  )}
                  disabled={isSubmitting}
                />
                {nameError && <p className="text-xs text-destructive">{nameError}</p>}
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label htmlFor="proj-desc" className="font-semibold">
                  {t("proj_description")}
                </Label>
                <Textarea
                  id="proj-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="rounded-xl resize-none"
                  disabled={isSubmitting}
                />
              </div>

              {/* Location */}
              <div className="space-y-1.5">
                <Label htmlFor="proj-location" className="font-semibold">
                  {t("proj_location")}
                </Label>
                <Input
                  id="proj-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="h-11 rounded-xl"
                  disabled={isSubmitting}
                />
              </div>

              {/* Budget */}
              <div className="space-y-1.5">
                <Label htmlFor="proj-budget" className="font-semibold">
                  {t("proj_budget")}
                </Label>
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

              {/* Status */}
              <div className="space-y-1.5">
                <Label className="font-semibold">{t("proj_status")}</Label>
                <Select
                  value={status}
                  onValueChange={(v) => setStatus(v as "active" | "paused" | "completed")}
                  disabled={isSubmitting}
                >
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

              {/* Submit */}
              <Button
                type="submit"
                className="w-full h-11 font-bold gap-2"
                disabled={isSubmitting || isUserLoading}
              >
                {isSubmitting ? <Loader2 className="animate-spin" size={16} /> : <FolderPlus size={16} />}
                {t("proj_save")}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </PortalLayout>
  )
}
