"use client"

import { Badge } from "@/components/ui/badge"
import { Link } from "@/i18n/routing"
import type { PmEvent } from "@/lib/pm/events"
import type { Receipt } from "lucide-react"

export function Section({ icon: Icon, title, sub, count, action, children }: { icon: typeof Receipt; title: string; sub: string; count: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-black text-foreground">
            <Icon size={15} className="text-module" aria-hidden="true" />
            {title}
            {count > 0 && <Badge className="border-none bg-warning/10 text-[10px] tabular-nums text-warning">{count}</Badge>}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

export const Empty = ({ children }: { children: React.ReactNode }) => <p className="p-6 text-center text-sm text-muted-foreground">{children}</p>

export function ProjectCell({ event, projectName, sub }: { event: PmEvent; projectName: string; sub: React.ReactNode }) {
  return (
    <span className="min-w-0 flex-1">
      <Link href={`/contractor/projects/${event.projectId}`} className="rounded font-bold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span dir="ltr">{event.projectNo}</span>
        {projectName && <span dir="auto"> — {projectName}</span>}
      </Link>
      <span className="mt-0.5 block text-xs text-muted-foreground">{sub}</span>
    </span>
  )
}
