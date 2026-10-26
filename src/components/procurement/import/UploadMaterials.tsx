"use client"

// «ارفع ملف إكسل» in step 1 of the RFQ editor (IMP-01) with «قالب مدماك» beside it. Uploading is part of creating an
// RFQ: whoever can create one uploads, and no new permission exists; whoever cannot sees why the button is off.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Download, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { usePermissions } from "@/hooks/usePermissions"
import { useToast } from "@/hooks/use-toast"
import type { MaterialIndex } from "@/lib/materials/tree"
import type { EditorGroup, EditorLine } from "@/lib/procurement/rfq-editor"
import { downloadMaterialsTemplate } from "./downloadTemplate"
import { ImportMaterialsDialog } from "./ImportMaterialsDialog"

export function UploadMaterials({ index, groups, onAdd }: { index: MaterialIndex | null; groups: EditorGroup[]; onAdd: (lines: EditorLine[], groupKey: string) => void }) {
  const t = useTranslations("Portal.Procurement.import")
  const te = useTranslations("Portal.ProcEditor")
  const { toast } = useToast()
  const { can, isOrgOwner } = usePermissions()
  const [open, setOpen] = useState(false)
  const allowed = isOrgOwner || can("rfq.create") || can("rfq.manage") || can("projects.publish") || can("offers.accept") || can("po.approve")
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="gap-2" disabled={!allowed || !index} title={allowed ? t("upload_hint") : t("no_permission")} onClick={() => setOpen(true)}>
          <Upload size={15} aria-hidden="true" /> {t("upload")}
        </Button>
        <Button
          type="button"
          variant="link"
          className="h-auto gap-1 p-0 text-xs"
          onClick={() => {
            if (downloadMaterialsTemplate()) toast({ title: t("template_downloaded") })
          }}
        >
          <Download size={13} aria-hidden="true" /> {t("template")}
        </Button>
      </div>
      {!allowed && <p className="basis-full text-xs text-muted-foreground">{t("no_permission")}</p>}
      {index && (
        <ImportMaterialsDialog
          open={open}
          onOpenChange={setOpen}
          index={index}
          places={groups.map((g) => ({ key: g.key, label: g.label || g.city || te("group_unnamed") }))}
          onAdd={onAdd}
        />
      )}
    </>
  )
}
