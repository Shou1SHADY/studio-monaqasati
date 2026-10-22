"use client"

// The RFQ's name with its «✎» (RFQ-14, ED-05): suppliers read the new name in the request and on the visitor link. Enter saves.

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { IconButton } from "@/components/module-ui/IconButton"
import { useToast } from "@/hooks/use-toast"
import { RfqRouteError, renameRfqCall } from "@/lib/procurement/rfq-lifecycle-client"

export function RfqTitleEdit({ rfqId, title, canEdit }: { rfqId: string; title: string; canEdit: boolean }) {
  const t = useTranslations("Portal.Procurement.rfqpage.title")
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(title)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const next = value.trim()
    if (!next || next === title) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await renameRfqCall({ rfqId, title: next })
      toast({ title: t("saved") })
      setEditing(false)
    } catch (err) {
      toast({ title: t("failed"), description: err instanceof RfqRouteError ? err.reason : undefined, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  if (editing)
    return (
      <form
        className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <Input aria-label={t("label")} value={value} maxLength={200} autoFocus onChange={(e) => setValue(e.target.value)} className="h-10 max-w-md flex-1" />
        <Button type="submit" size="sm" disabled={saving || !value.trim()}>
          {t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => (setValue(title), setEditing(false))}>
          {t("cancel")}
        </Button>
      </form>
    )

  return (
    <h1 className="flex min-w-0 items-center gap-2 text-xl font-black leading-relaxed text-primary sm:text-2xl">
      <span className="min-w-0 truncate" dir="auto">
        {title || "—"}
      </span>
      {canEdit && <IconButton label={t("edit")} icon={Pencil} iconSize={14} className="h-8 w-8 md:h-8 md:w-8" onClick={() => (setValue(title), setEditing(true))} />}
    </h1>
  )
}
