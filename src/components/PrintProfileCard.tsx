"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { doc, serverTimestamp, setDoc } from "firebase/firestore"
import { Loader2, Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useFirestore } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { usePrintProfile } from "@/hooks/usePrintProfile"
import { COMPANY_PRINT_PROFILE, printProfileErrors, printProfileFields } from "@/lib/company-print-profile"

export function PrintProfileCard({ defaults }: { defaults: { crNumber?: string; taxNumber?: string } }) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const { toast } = useToast()
  const { orgId, crNumber, taxNumber, isLoading } = usePrintProfile()
  const [cr, setCr] = useState("")
  const [vat, setVat] = useState("")
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setCr(crNumber)
    setVat(taxNumber)
  }, [crNumber, taxNumber])

  const save = async () => {
    if (!firestore || !orgId) return
    const fields = printProfileFields({ crNumber: cr, taxNumber: vat })
    const problems = printProfileErrors(fields)
    setErrors(problems)
    if (problems.length) return
    setSaving(true)
    try {
      await setDoc(doc(firestore, COMPANY_PRINT_PROFILE, orgId), { ...fields, taxNumber: (fields.taxNumber ?? "").replace(/\s/g, ""), organizationId: orgId, updatedAt: serverTimestamp() }, { merge: true })
      toast({ title: t("print_profile_saved") })
    } catch (err) {
      console.error(err)
      toast({ title: t("print_profile_failed"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Printer size={18} aria-hidden="true" />
          {t("print_profile_title")}
        </CardTitle>
        <CardDescription>{t("print_profile_desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="print-cr">{t("print_profile_cr")}</Label>
            <Input id="print-cr" dir="ltr" inputMode="numeric" value={cr} onChange={(e) => setCr(e.target.value)} disabled={isLoading || saving} aria-invalid={errors.includes("cr_format")} />
            {errors.includes("cr_format") && <p role="alert" className="text-xs text-destructive">{t("print_profile_err_cr")}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="print-vat">{t("print_profile_vat")}</Label>
            <Input id="print-vat" dir="ltr" inputMode="numeric" value={vat} onChange={(e) => setVat(e.target.value)} disabled={isLoading || saving} aria-invalid={errors.includes("vat_format")} />
            {errors.includes("vat_format") && <p role="alert" className="text-xs text-destructive">{t("print_profile_err_vat")}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => { setCr(defaults.crNumber ?? ""); setVat(defaults.taxNumber ?? "") }} disabled={saving}>
            {t("print_profile_fill")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={isLoading || saving || !orgId}>
            {saving && <Loader2 size={16} className="me-2 animate-spin" aria-hidden="true" />}
            {t("print_profile_save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
