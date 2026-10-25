"use client"

// The box that writes to the other side of an order: a line, an optional file, «أرسل». For an off-platform supplier the send
// button wears the WhatsApp mark — the message is stored here and opened in WhatsApp on the buyer's own phone, with the order link
// (nothing is sent from the server, B-08).

import { useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { Loader2, MessageCircle, Paperclip, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import type { MessageFile } from "@/lib/procurement/po-messages"

export function Composer({
  placeholder,
  whatsapp = false,
  disabled = false,
  onSend,
  onUpload,
}: {
  placeholder: string
  whatsapp?: boolean
  disabled?: boolean
  onSend: (input: { text: string; file: MessageFile | null }) => Promise<void>
  onUpload: (file: File) => Promise<MessageFile>
}) {
  const t = useTranslations("Portal.ProcChats")
  const { toast } = useToast()
  const [text, setText] = useState("")
  const [file, setFile] = useState<MessageFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const picker = useRef<HTMLInputElement>(null)

  const submit = async () => {
    if (busy || disabled) return
    if (!text.trim() && !file) {
      toast({ title: t("write_message") })
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSend({ text, file })
      setText("")
      setFile(null)
    } catch {
      setError(t("failed"))
    } finally {
      setBusy(false)
    }
  }

  const pick = async (list: FileList | null) => {
    const f = list?.[0]
    if (!f) return
    setBusy(true)
    setError(null)
    try {
      setFile(await onUpload(f))
      toast({ title: t("file_attached") })
    } catch {
      setError(t("upload_failed"))
    } finally {
      setBusy(false)
      if (picker.current) picker.current.value = ""
    }
  }

  return (
    <div className="space-y-1.5">
      {file && (
        <p className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs" dir="auto">
          <Paperclip size={11} aria-hidden="true" />
          {file.name}
          <button type="button" onClick={() => setFile(null)} aria-label={t("remove_file")} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <X size={12} aria-hidden="true" />
          </button>
        </p>
      )}
      <div className="flex items-center gap-2">
        <input ref={picker} type="file" accept="image/*,application/pdf" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void pick(e.target.files)} />
        <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" disabled={busy || disabled} onClick={() => picker.current?.click()} aria-label={t("attach")} title={t("attach")}>
          <Paperclip size={16} aria-hidden="true" />
        </Button>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          maxLength={2000}
          disabled={disabled}
          dir="auto"
          className="h-10"
        />
        <Button type="button" className="h-10 shrink-0 gap-1.5" disabled={busy || disabled || (!text.trim() && !file)} onClick={() => void submit()}>
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : whatsapp ? <MessageCircle size={14} aria-hidden="true" /> : <Send size={14} className="rtl-flip" aria-hidden="true" />}
          {t("send")}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
