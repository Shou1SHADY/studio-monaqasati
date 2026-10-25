"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { JoinFreeButton } from "@/components/supplier-free/JoinFreeButton"

// The registration card (LNK-04): short, with one button. After a send it carries the mobile he verified, so the account opens
// on it and his result reaches him there; before, it is just the invitation.
export function PromoCard({ phone, preview = false }: { phone?: string; preview?: boolean }) {
  const t = useTranslations("PublicRfq")
  const [later, setLater] = useState(false)
  if (later) return <p className="rounded-md border bg-muted/40 p-3 text-center text-xs text-muted-foreground">{t("promo_saved")}</p>
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-md border border-accent/30 bg-accent/5 p-3.5" aria-label={t("promo_title")}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent/15 text-primary" aria-hidden="true">
        <Bell size={16} />
      </span>
      <div className="min-w-[180px] flex-1 space-y-0.5">
        <p className="text-sm font-bold text-foreground">{t("promo_title")}</p>
        <p className="text-xs text-muted-foreground">{phone ? t("promo_mobile", { phone }) : t("promo_sub")}</p>
      </div>
      {preview ? (
        <span className="rounded-md border px-3 py-1.5 text-xs font-semibold text-muted-foreground">{t("promo_btn")}</span>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          <JoinFreeButton size="sm" variant="accent" initialPhone={phone}>
            {t("promo_btn")}
          </JoinFreeButton>
          {phone && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setLater(true)}>
              {t("promo_not_now")}
            </Button>
          )}
        </span>
      )}
    </section>
  )
}
