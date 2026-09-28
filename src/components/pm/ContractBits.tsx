"use client"

// Small pieces the Contract screens share: a row of choice chips (the
// prototype's `chips`), the attachments a record carries as links, and a
// check line for a drawer's "before it counts" list.

import type { ReactNode } from "react"
import { CheckCircle2, Clock, FileText } from "lucide-react"
import { cn } from "@/lib/utils"

export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled,
  multi,
}: {
  options: Array<{ id: T; label: ReactNode }>
  value: T | T[] | null
  onChange: (v: T) => void
  label: string
  disabled?: boolean
  multi?: boolean
}) {
  const on = (id: T) => (Array.isArray(value) ? value.includes(id) : value === id)
  return (
    <div role={multi ? "group" : "radiogroup"} aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role={multi ? undefined : "radio"}
          aria-checked={multi ? undefined : on(o.id)}
          aria-pressed={multi ? on(o.id) : undefined}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={cn(
            "min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors hover:border-module/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
            on(o.id) ? "border-module bg-module/10 text-module" : "bg-background text-muted-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function FileLinks({ files, className }: { files: Array<{ url: string; name: string }> | null | undefined; className?: string }) {
  if (!files?.length) return null
  return (
    <span className={cn("inline-flex flex-wrap gap-1.5", className)}>
      {files.map((f) => (
        <a
          key={f.url}
          href={f.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-[14rem] items-center gap-1 rounded-full bg-cta/10 px-2 py-0.5 text-[11px] font-bold text-cta hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileText size={11} aria-hidden="true" />
          <span className="truncate">{f.name}</span>
        </a>
      ))}
    </span>
  )
}

export function CheckLine({ ok, title, note }: { ok: boolean; title: ReactNode; note: ReactNode }) {
  const Icon = ok ? CheckCircle2 : Clock
  return (
    <div className="flex items-start gap-2.5 py-2">
      <Icon size={16} className={cn("mt-0.5 shrink-0", ok ? "text-success" : "text-warning")} aria-hidden="true" />
      <span className="min-w-0 text-sm">
        <b className="block font-semibold">{title}</b>
        <span className="text-xs text-muted-foreground">{note}</span>
      </span>
    </div>
  )
}

export function FormHint({ children, tone }: { children: ReactNode; tone?: "warn" | "bad" }) {
  return <p className={cn("text-[11px]", tone === "warn" ? "font-semibold text-warning" : tone === "bad" ? "font-bold text-destructive" : "text-muted-foreground")}>{children}</p>
}
