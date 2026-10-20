"use client"

// «تخصصاتك من شجرة المواد» (PUR-04): a supplier chooses once the sub-categories his
// company supplies; public RFQs written on the tree reach him by them. Until he has,
// the card says so plainly — only private RFQs and guest links reach him.

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2 } from "lucide-react"
import { getAuth } from "firebase/auth"
import { Button } from "@/components/ui/button"
import { Callout } from "@/components/module-ui/Callout"
import { useToast } from "@/hooks/use-toast"
import { useMaterialTree } from "@/hooks/useMaterialTree"
import { MaterialSubsPicker } from "./MaterialSubsPicker"

export function SupplierSpecialtiesCard({ current, canEdit, onSaved }: { current: string[]; canEdit: boolean; onSaved?: (ids: string[]) => void }) {
  const t = useTranslations("Portal.Materials")
  const { toast } = useToast()
  const { index } = useMaterialTree()
  const [ids, setIds] = useState<string[]>(current)
  const [saving, setSaving] = useState(false)
  const currentKey = current.join("|")
  useEffect(() => setIds(currentKey ? currentKey.split("|") : []), [currentKey])
  const dirty = ids.join("|") !== currentKey

  const save = async () => {
    const user = getAuth().currentUser
    if (!user || !ids.length) return
    setSaving(true)
    try {
      const res = await fetch("/api/supplier/specialties", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ subIds: ids }),
      })
      if (!res.ok) throw new Error(String(res.status))
      toast({ title: t("specialties_saved", { count: ids.length }) })
      onSaved?.(ids)
    } catch {
      toast({ title: t("specialties_failed"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="tree-specialties">
      <div>
        <h3 id="tree-specialties" className="text-base font-bold">
          {t("specialties_title")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("specialties_desc")}</p>
      </div>
      {!current.length && <Callout tone="warn">{t("specialties_none")}</Callout>}
      <MaterialSubsPicker index={index} value={ids} onChange={setIds} disabled={!canEdit || saving} />
      {canEdit ? (
        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={!dirty || !ids.length || saving} className="gap-2">
            {saving && <Loader2 size={14} className="animate-spin" />}
            {t("specialties_save")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("specialties_owner_only")}</p>
      )}
    </section>
  )
}
