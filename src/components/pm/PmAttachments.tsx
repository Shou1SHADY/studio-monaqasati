"use client"

// The prototype's attBox and attTag on a PM record: add photos or PDFs one at a
// time through the shared file field (always optional), and a small chip on a
// row that opens what was attached. With no org to upload under, the field
// says nothing and the record saves without files.

import { useTranslations } from "next-intl"
import { Camera, FileText, X } from "lucide-react"
import { MfgFileField } from "@/components/manufacturing/MfgFileField"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { isPdf, MAX_ATTACHMENTS, type PmAttachment } from "@/lib/pm/attachments"
import { cn } from "@/lib/utils"

export function PmFilesField({
  orgId,
  folder,
  value,
  onChange,
  label,
  hint,
  disabled,
}: {
  orgId?: string | null
  /** e.g. `projects/{id}/sheets` */
  folder: string
  value: PmAttachment[]
  onChange: (files: PmAttachment[]) => void
  label: string
  hint?: string
  disabled?: boolean
}) {
  const t = useTranslations("Portal.PM.att")
  if (!orgId) return null
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((f, i) => (
            <li key={`${f.url}-${i}`} className="flex max-w-full items-center gap-1.5 rounded-lg border bg-muted/40 py-1 pe-1 ps-2 text-xs">
              {isPdf(f.name) ? <FileText size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" /> : <Camera size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
              <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 truncate font-semibold hover:underline" dir="auto">
                {f.name}
              </a>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((_, j) => j !== i))}
                aria-label={t("remove", { name: f.name })}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {value.length < MAX_ATTACHMENTS && !disabled && (
        <MfgFileField
          orgId={orgId}
          area="pm"
          folder={folder}
          value={null}
          onChange={(f) => f && onChange([...value, f])}
          label={`${label} — ${t("optional")}`}
          hint={hint}
        />
      )}
    </div>
  )
}

/** A chip beside what it proves: the count, opening the files. */
export function AttachmentTag({ files, tone = "info", label }: { files?: PmAttachment[] | null; tone?: "info" | "teal"; label?: string }) {
  const t = useTranslations("Portal.PM.att")
  if (!files?.length) return null
  const Icon = isPdf(files[0].name) ? FileText : Camera
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label ?? t("open", { count: files.length })}
          className={cn(
            "inline-flex min-h-7 items-center gap-1 rounded-full px-2 text-xs font-bold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            tone === "teal" ? "bg-success/10 text-success hover:bg-success/15" : "bg-cta/10 text-cta hover:bg-cta/15"
          )}
        >
          <Icon size={12} aria-hidden="true" />
          {files.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <p className="px-1 pb-1 text-xs font-bold text-muted-foreground">{label ?? t("files", { count: files.length })}</p>
        <ul className="space-y-1">
          {files.map((f, i) => (
            <li key={`${f.url}-${i}`}>
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-9 items-center gap-2 rounded-md px-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {isPdf(f.name) ? <FileText size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" /> : <Camera size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
                <span className="min-w-0 truncate" dir="auto">
                  {f.name}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
