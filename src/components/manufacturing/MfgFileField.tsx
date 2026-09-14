"use client"

// Evidence is an attachment, not a tick (ORD-10, PR-01, ORD-14): the survey
// sketch, the client's signed slab form, the shop drawing. The file goes to
// Storage under the org and the order; the form keeps its URL and name.

import { useId, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { getDownloadURL, ref, uploadBytes } from "firebase/storage"
import { CheckCircle2, Loader2, Paperclip, X } from "lucide-react"
import { useStorage } from "@/firebase/provider"
import { cn } from "@/lib/utils"

export interface UploadedFile {
  url: string
  name: string
}

export function MfgFileField({
  orgId,
  folder,
  value,
  onChange,
  accept = "image/*,application/pdf",
  label,
  hint,
  required,
}: {
  orgId: string
  /** e.g. `workOrders/{id}/survey` */
  folder: string
  value: UploadedFile | null
  onChange: (f: UploadedFile | null) => void
  accept?: string
  label: string
  hint?: string
  required?: boolean
}) {
  const t = useTranslations("Portal.Shared")
  const storage = useStorage()
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async (file: File | undefined) => {
    if (!file || !storage || !orgId) return
    if (file.size > 15 * 1024 * 1024) {
      setError(t("mfg4_file_too_big"))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const safe = file.name.replace(/[^\w.\-؀-ۿ]+/g, "_")
      const fileRef = ref(storage, `organizations/${orgId}/manufacturing/${folder}/${Date.now()}_${safe}`)
      await uploadBytes(fileRef, file, { contentType: file.type })
      onChange({ url: await getDownloadURL(fileRef), name: file.name })
    } catch (err) {
      console.error(err)
      setError(t("mfg4_err_upload"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-bold text-slate-700">
        {label}
        {required && <span className="ms-0.5 text-warning">*</span>}
      </label>
      {value ? (
        <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 px-3 py-2 text-xs">
          <CheckCircle2 size={14} className="shrink-0 text-success" aria-hidden="true" />
          <a href={value.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-semibold text-success underline-offset-2 hover:underline">
            {value.name}
          </a>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("mfg4_file_remove")}
            className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={13} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          id={id}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-white px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors",
            "hover:border-warning/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          )}
        >
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Paperclip size={14} aria-hidden="true" />}
          {busy ? t("mfg4_file_uploading") : t("mfg4_file_attach")}
        </button>
      )}
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
      {error ? <p className="text-[11px] font-semibold text-destructive">{error}</p> : hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
