"use client"

// «رابط الأمر كما يراه» (PO-02, prototype `ALT.polink` preview): the order link's page exactly as the off-platform supplier reads it —
// his order, its lines and the one state block, the conversation as he sees it — inside a sheet with a banner that says it is a
// preview. Strictly read-only: the page comes from a buyer route that mints no token and never marks his read state, every control is
// disabled, and nothing here acts in his name. A real link to send is still one press away («انسخ رابط الأمر للإرسال»).

import { useEffect, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { Copy, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Callout } from "@/components/module-ui/Callout"
import { useToast } from "@/hooks/use-toast"
import type { PoLinkView } from "@/lib/po-link"
import { fetchPoLink, fetchPoLinkPreview } from "@/lib/procurement/po-message-client"
import { LinkOrderView, type LinkOrderActions } from "@/components/procurement/guest/LinkOrderView"
import { ThreadBody } from "./ThreadBody"

const NOTHING = async () => undefined
/** The preview never acts: every action is a no-op behind disabled controls. */
const READ_ONLY_ACTIONS: LinkOrderActions = { accept: NOTHING, decline: NOTHING, askChange: NOTHING, report: NOTHING, acceptVersion: NOTHING }

export function PoLinkPreviewSheet({ poId, supplierName, open, onOpenChange }: { poId: string; supplierName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("Portal.ProcChats")
  const locale = useLocale()
  const { toast } = useToast()
  const [view, setView] = useState<PoLinkView | null>(null)
  const [failed, setFailed] = useState(false)
  const [copying, setCopying] = useState(false)

  useEffect(() => {
    if (!open) return
    let gone = false
    setView(null)
    setFailed(false)
    fetchPoLinkPreview(poId)
      .then((v) => !gone && setView(v))
      .catch(() => !gone && setFailed(true))
    return () => {
      gone = true
    }
  }, [open, poId])

  const copy = async () => {
    setCopying(true)
    try {
      const link = await fetchPoLink(poId)
      await navigator.clipboard.writeText(link)
      toast({ title: t("preview_copied") })
    } catch {
      toast({ title: t("failed"), variant: "destructive" })
    } finally {
      setCopying(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={locale === "ar" ? "left" : "right"} dir={locale === "ar" ? "rtl" : "ltr"} className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="space-y-2 border-b px-4 py-4 text-start">
          <SheetTitle>{t("preview_title")}</SheetTitle>
          <SheetDescription className="sr-only">{t("preview_banner", { supplier: supplierName })}</SheetDescription>
          <Callout tone="info">{t("preview_banner", { supplier: supplierName })}</Callout>
        </SheetHeader>
        <div className="space-y-4 bg-muted/30 px-4 py-4">
          {failed ? (
            <p className="text-sm text-destructive" role="alert">
              {t("preview_failed")}
            </p>
          ) : !view ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
              {t("preview_loading")}
            </p>
          ) : (
            <>
              <LinkOrderView view={view} actions={READ_ONLY_ACTIONS} busy readOnly />
              {view.state !== "cancelled" && (
                <section className="rounded-md border bg-card" aria-label={t("thread_title_supplier")}>
                  <header className="border-b px-3.5 py-2.5">
                    <h2 className="text-sm font-bold">{t("thread_title_supplier")}</h2>
                  </header>
                  <div className="p-3.5">{view.thread.length === 0 ? <p className="text-sm text-muted-foreground">{t("no_messages")}</p> : <ThreadBody items={view.thread} side="supplier" no={view.no} supplierName={view.supplierName} company={view.company} />}</div>
                </section>
              )}
            </>
          )}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t px-4 py-3">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={copying} onClick={() => void copy()}>
            {copying ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            {t("preview_copy")}
          </Button>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {t("preview_close")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
