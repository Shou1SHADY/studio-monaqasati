"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { doc, serverTimestamp, setDoc } from "firebase/firestore"
import { getDownloadURL, ref, uploadBytes } from "firebase/storage"
import { ImagePlus, Loader2, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useFirestore, useStorage } from "@/firebase"
import { useToast } from "@/hooks/use-toast"
import { CRM_ORG_PROFILE } from "@/lib/crm"
import {
  QUOTATION_LOGO_ACCEPT,
  QUOTATION_LOGO_MAX_BYTES,
  logoStoragePath,
  validateLogoFile,
} from "@/lib/quotation-document"
import { cn } from "@/lib/utils"

/**
 * The company logo on the quotation letterhead. A picked file shows on the
 * sheet at once from a local object URL while it uploads to Storage
 * (`quotation-branding/{orgId}/…`), then swaps to the download URL once that
 * has loaded. The logo is also remembered on `crmOrgProfile/{orgId}` so the
 * next quotation starts with it. Removing clears that default; the Storage
 * object stays, because quotations already issued still print with it.
 */
export function QuotationLogoField({
  orgId,
  value,
  onChange,
  onUploadingChange,
  disabled,
}: {
  orgId: string
  value: string | null
  onChange: (url: string | null) => void
  onUploadingChange?: (uploading: boolean) => void
  disabled?: boolean
}) {
  const t = useTranslations("Portal.Shared")
  const firestore = useFirestore()
  const storage = useStorage()
  const { toast } = useToast()
  const inputId = useId()
  const hintId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  // The object URL currently on screen, so a stale upload never overwrites a
  // newer pick or a removal, and so it can be released.
  const pendingUrlRef = useRef<string | null>(null)

  useEffect(() => {
    onUploadingChange?.(uploading)
  }, [uploading, onUploadingChange])

  useEffect(
    () => () => {
      if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current)
    },
    []
  )

  const rememberDefault = async (url: string | null, path: string | null) => {
    if (!firestore || !orgId) return
    try {
      await setDoc(
        doc(firestore, CRM_ORG_PROFILE, orgId),
        { organizationId: orgId, quotationLogoUrl: url, quotationLogoPath: path, updatedAt: serverTimestamp() },
        { merge: true }
      )
    } catch (err) {
      // The logo still sits on this quotation — only the default was not kept.
      console.error("Saving the default quotation logo failed:", err)
    }
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    const problem = validateLogoFile(file)
    if (problem) {
      toast({
        title: problem === "type" ? t("sales_qb_logo_type_error") : t("sales_qb_logo_size_error", { size: QUOTATION_LOGO_MAX_BYTES / (1024 * 1024) }),
        variant: "destructive",
      })
      return
    }
    if (!storage || !orgId) {
      toast({ title: t("sales_qb_logo_upload_error"), variant: "destructive" })
      return
    }

    const previous = value && !value.startsWith("blob:") ? value : null
    if (pendingUrlRef.current) URL.revokeObjectURL(pendingUrlRef.current)
    const localUrl = URL.createObjectURL(file)
    pendingUrlRef.current = localUrl
    onChange(localUrl)
    setUploading(true)
    try {
      const path = logoStoragePath(orgId, file.name)
      const fileRef = ref(storage, path)
      await uploadBytes(fileRef, file, { contentType: file.type })
      const url = await getDownloadURL(fileRef)
      // Swap only once the remote copy has loaded, so the sheet never flashes.
      await new Promise<void>((resolve) => {
        const img = new Image()
        img.onload = () => resolve()
        img.onerror = () => resolve()
        img.src = url
      })
      if (pendingUrlRef.current !== localUrl) return
      onChange(url)
      URL.revokeObjectURL(localUrl)
      pendingUrlRef.current = null
      await rememberDefault(url, path)
      toast({ title: t("sales_qb_logo_uploaded") })
    } catch (err) {
      console.error("Quotation logo upload failed:", err)
      if (pendingUrlRef.current === localUrl) {
        onChange(previous)
        URL.revokeObjectURL(localUrl)
        pendingUrlRef.current = null
      }
      toast({ title: t("sales_qb_logo_upload_error"), variant: "destructive" })
    } finally {
      setUploading(false)
    }
  }

  const handleRemove = () => {
    if (pendingUrlRef.current) {
      URL.revokeObjectURL(pendingUrlRef.current)
      pendingUrlRef.current = null
    }
    onChange(null)
    void rememberDefault(null, null)
  }

  return (
    <div className="flex items-start gap-4">
      <div
        className={cn(
          "relative grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border bg-muted/30",
          !value && "border-dashed"
        )}
      >
        {value ? (
          // Plain <img>: a blob: preview or a Firebase Storage URL, neither
          // of which next/image is configured to load.
          <img src={value} alt={t("sales_qb_logo_alt_generic")} className="h-full w-full object-contain p-2" />
        ) : (
          <ImagePlus size={24} className="text-muted-foreground" aria-hidden="true" />
        )}
        {uploading && (
          <div className="absolute inset-0 grid place-items-center bg-white/70">
            <Loader2 size={20} className="animate-spin text-primary" aria-hidden="true" />
            <span className="sr-only">{t("sales_qb_logo_uploading")}</span>
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-2">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={QUOTATION_LOGO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-describedby={hintId}
          onChange={(e) => {
            void handleFile(e.target.files?.[0])
            e.target.value = ""
          }}
          disabled={disabled || uploading}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || uploading}
            aria-describedby={hintId}
          >
            {value ? <RefreshCw size={14} aria-hidden="true" /> : <ImagePlus size={14} aria-hidden="true" />}
            {value ? t("sales_qb_logo_replace") : t("sales_qb_logo_upload")}
          </Button>
          {value && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleRemove}
              disabled={disabled || uploading}
            >
              <Trash2 size={14} aria-hidden="true" />
              {t("sales_qb_logo_remove")}
            </Button>
          )}
        </div>
        <p id={hintId} className="text-[11px] text-muted-foreground">
          {t("sales_qb_logo_hint", { size: QUOTATION_LOGO_MAX_BYTES / (1024 * 1024) })}
        </p>
      </div>
    </div>
  )
}
