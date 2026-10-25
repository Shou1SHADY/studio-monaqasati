"use client"

// «عرض N أخرى» / «عرض أقل» under a Today panel — one look for the decisions, the waits and the invitations.

import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

export function TodayMoreButton({ open, onClick, label }: { open: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t text-sm font-bold text-cta transition-colors hover:bg-module/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {label}
      <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
    </button>
  )
}
