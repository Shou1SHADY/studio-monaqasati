"use client"

import { useTranslations } from "next-intl"
import { Lock } from "lucide-react"

export function OwnerOnlyNotice() {
  const t = useTranslations("Portal.Shared")
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Lock size={24} aria-hidden="true" />
      </div>
      <h1 className="text-xl font-black">{t("owner_only_title")}</h1>
      <p className="text-sm text-muted-foreground">{t("owner_only_desc")}</p>
    </div>
  )
}
