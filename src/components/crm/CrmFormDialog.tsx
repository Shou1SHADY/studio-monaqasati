"use client"

import { useEffect, useState, type ElementType, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export interface CrmFormStep {
  id: string
  /** Short label for the progress rail. */
  title: string
  content: ReactNode
  /**
   * Returns a message to show and block on, or null to allow advancing.
   * Validation is per-step so a missing required field is caught where it was
   * asked for, instead of at the end of a form the user has already left.
   */
  validate?: () => string | null
}

/**
 * The chrome every CRM form dialog shares.
 *
 * Two things it fixes that a plain `DialogContent` does not:
 *
 *  - **The footer stays put.** A scrolling dialog that keeps its submit button
 *    inside the scroll area hides the primary action behind fifteen fields —
 *    you cannot see what you are working towards, and saving means scrolling
 *    to the bottom to hunt for it. Here the body scrolls and the footer does
 *    not.
 *  - **Long forms are stepped.** Creating an opportunity asks for a dozen
 *    things across three unrelated concerns. Presenting them as one wall makes
 *    a five-second task feel like paperwork; three short steps with a visible
 *    position do not.
 *
 * A single-step form gets the same shell and simply has no navigation.
 */
export function CrmFormDialog({
  open,
  onOpenChange,
  title,
  description,
  icon: Icon,
  steps,
  isSaving = false,
  submitLabel,
  onSubmit,
  size = "md",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  icon?: ElementType
  steps: CrmFormStep[]
  isSaving?: boolean
  submitLabel: string
  onSubmit: () => void
  size?: "md" | "lg"
}) {
  const t = useTranslations("Portal.Shared")
  const locale = useLocale()
  const isRtl = locale === "ar"
  const { toast } = useToast()
  const [index, setIndex] = useState(0)

  // Reopening always starts at the beginning: a dialog that resumes on step 3
  // of a form the user abandoned is disorienting.
  useEffect(() => {
    if (open) setIndex(0)
  }, [open])

  const total = steps.length
  const step = steps[Math.min(index, total - 1)]
  const isLast = index >= total - 1
  const isFirst = index === 0

  const guard = (): boolean => {
    const error = step?.validate?.()
    if (error) {
      toast({ title: error, variant: "destructive" })
      return false
    }
    return true
  }

  const next = () => {
    if (!guard()) return
    setIndex((i) => Math.min(total - 1, i + 1))
  }

  const submit = () => {
    if (!guard()) return
    onSubmit()
  }

  const Back = isRtl ? ArrowRight : ArrowLeft
  const Next = isRtl ? ArrowLeft : ArrowRight

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!isSaving) onOpenChange(o) }}>
      {/* Flex column + overflow-hidden is what lets the body scroll while the
          header and footer stay fixed. */}
      <DialogContent
        dir={isRtl ? "rtl" : "ltr"}
        className={cn(
          "flex flex-col gap-0 p-0 max-h-[90vh] overflow-hidden",
          size === "lg" ? "max-w-2xl" : "max-w-lg"
        )}
      >
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0 text-start">
          <DialogTitle className="flex items-center gap-2 text-start">
            {Icon && <Icon size={18} className="shrink-0" aria-hidden="true" />}
            {title}
          </DialogTitle>
          {description && <DialogDescription className="text-start">{description}</DialogDescription>}
        </DialogHeader>

        {total > 1 && (
          <nav aria-label={t("crm_form_steps")} className="px-6 pb-4 shrink-0">
            <ol className="flex items-center gap-2">
              {steps.map((s, i) => (
                <li key={s.id} className="flex-1 min-w-0">
                  {/* Completed steps are clickable so a user can go back and
                      correct something without losing what comes after. */}
                  <button
                    type="button"
                    onClick={() => { if (i < index) setIndex(i) }}
                    disabled={i >= index || isSaving}
                    aria-current={i === index ? "step" : undefined}
                    className={cn(
                      "w-full text-start rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      i < index && "cursor-pointer"
                    )}
                  >
                    <span
                      className={cn(
                        "block h-1 rounded-full transition-colors",
                        i <= index ? "bg-primary" : "bg-muted"
                      )}
                      aria-hidden="true"
                    />
                    <span
                      className={cn(
                        "block text-[11px] mt-1.5 truncate font-semibold",
                        i === index ? "text-foreground" : "text-muted-foreground"
                      )}
                    >
                      {s.title}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <form
          className="flex-1 min-h-0 overflow-y-auto px-6 pb-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (isLast) submit()
            else next()
          }}
        >
          {step?.content}
          {/* A submit input so Enter still works even though the real submit
              button lives outside the form element. */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>

        <div className="shrink-0 border-t bg-background px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button type="button" variant="ghost" onClick={() => setIndex((i) => i - 1)} disabled={isSaving} className="gap-1.5">
                <Back size={15} />
                {t("crm_form_back")}
              </Button>
            )}
            {total > 1 && (
              <span className="text-xs text-muted-foreground" dir="ltr">
                {index + 1}/{total}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              {t("crm_cancel")}
            </Button>
            {isLast ? (
              <Button type="button" onClick={submit} disabled={isSaving} className="gap-2">
                {isSaving && <Loader2 size={15} className="animate-spin" />}
                {submitLabel}
              </Button>
            ) : (
              <Button type="button" onClick={next} disabled={isSaving} className="gap-1.5">
                {t("crm_form_next")}
                <Next size={15} />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Required-field marker. A bare `*` in the label text is invisible to a screen
 * reader and easy to render inconsistently; this carries an accessible name and
 * looks the same everywhere.
 */
export function RequiredMark() {
  const t = useTranslations("Portal.Shared")
  return (
    <span className="text-destructive" title={t("crm_field_required")}>
      *<span className="sr-only"> {t("crm_field_required")}</span>
    </span>
  )
}

/** A labelled group inside a form step. */
export function CrmFieldGroup({
  label,
  hint,
  children,
  className,
}: {
  label?: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <p className="text-sm font-medium">{label}</p>}
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Read-only summary line for a review step. */
export function CrmReviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2 border-b last:border-b-0 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-semibold text-foreground text-end min-w-0">{children}</span>
    </div>
  )
}
