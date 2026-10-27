"use client"

import { CheckCircle2, Circle } from "lucide-react"
import { Link } from "@/i18n/routing"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { FIRST_STEPS_HREF, type FirstStep } from "./home-model"
import type { Free } from "./useFree"

export function FirstSteps({ steps, t }: { steps: FirstStep[]; t: Free["t"] }) {
  return (
    <section aria-labelledby="home-first-steps" className="rounded-2xl border bg-card px-4 py-4">
      <h2 id="home-first-steps" className="text-sm font-black">
        {t("fsTitle")}
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t("fsSub")}</p>
      <ol className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.id} className="flex items-center gap-2.5 text-sm">
            {s.done ? <CheckCircle2 size={18} className="shrink-0 text-success" aria-hidden="true" /> : <Circle size={18} className="shrink-0 text-muted-foreground/50" aria-hidden="true" />}
            <span className={cn("min-w-0 flex-1", s.done && "text-muted-foreground")}>{t(s.id === "docs" ? "fsDocs" : "fsAsk")}</span>
            {s.waiting ? <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-bold text-warning">{t("apprPending")}</span> : s.done ? <span className="text-[11px] font-bold text-success">{t("fsDone")}</span> : null}
          </li>
        ))}
      </ol>
      {steps.some((s) => !s.done) && (
        <Button asChild size="sm" className="mt-3">
          <Link href={FIRST_STEPS_HREF}>{t("fsOpen")}</Link>
        </Button>
      )}
    </section>
  )
}
