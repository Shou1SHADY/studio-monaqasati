import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

/** Where a multi-step form is: done steps ticked, the current one in the module's colour. */
export function WizardSteps({ steps, current, ariaLabel }: { steps: string[]; current: number; ariaLabel: string }) {
  return (
    <ol aria-label={ariaLabel} className="flex flex-wrap items-center gap-2">
      {steps.map((label, i) => {
        const done = i < current
        const on = i === current
        return (
          <li key={label} aria-current={on ? "step" : undefined} className="flex items-center gap-2">
            <span
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black tabular-nums",
                done ? "bg-success text-success-foreground" : on ? "bg-module text-module-foreground" : "bg-muted text-muted-foreground"
              )}
            >
              {done ? <Check size={14} aria-hidden="true" /> : i + 1}
            </span>
            <span className={cn("text-sm font-bold", on ? "text-foreground" : "text-muted-foreground")}>{label}</span>
            {i < steps.length - 1 && <span className="mx-1 hidden h-px w-6 bg-border sm:block" aria-hidden="true" />}
          </li>
        )
      })}
    </ol>
  )
}
