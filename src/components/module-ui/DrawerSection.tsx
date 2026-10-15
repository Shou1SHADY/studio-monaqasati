"use client"

import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

/** A collapsible part of a record's drawer: title, optional count, then the rows. */
export function DrawerSection({ title, count, summary, defaultOpen = true, children }: { title: ReactNode; count?: number; /** A short figure shown at the far side of the header while the section is closed or open. */ summary?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="rounded-xl border bg-card">
      <CollapsibleTrigger className="group flex min-h-11 w-full items-center justify-between gap-2 px-4 text-start text-sm font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-center gap-2">
          {title}
          {count !== undefined && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{count}</span>}
        </span>
        <span className="ms-auto flex items-center gap-2">
          {summary !== undefined && summary !== null && <span className="text-xs font-semibold tabular-nums text-muted-foreground">{summary}</span>}
          <ChevronDown size={16} className={cn("shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180")} aria-hidden="true" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-4 py-2">{children}</CollapsibleContent>
    </Collapsible>
  )
}
