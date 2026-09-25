import { Ban } from "lucide-react"

/** Why the save button is disabled — every reason, in words, beside the button.
 * The same rules run again in the write, so the screen and the save never disagree. */
export function BlockingReasons({ title, reasons }: { title: string; reasons: string[] }) {
  if (!reasons.length) return null
  return (
    <div role="status" className="rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-2.5 text-sm">
      <p className="flex items-center gap-1.5 font-bold text-destructive">
        <Ban size={15} aria-hidden="true" />
        {title}
      </p>
      <ul className="mt-1 list-disc space-y-0.5 ps-6 text-foreground">
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </div>
  )
}
