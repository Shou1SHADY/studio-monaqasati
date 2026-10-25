// An order line's specification under its name (PO-01, prototype `linePath` + `specCells`): the tree path as a muted line, then
// each spec value as a small neutral chip — «16 مم» «G60». Nothing when the order was made before the spec was copied.

import { specCells } from "@/lib/procurement/po-line-spec"
import { cn } from "@/lib/utils"

export function LineSpec({ spec, path, className }: { spec?: string | null; path?: string | null; className?: string }) {
  const cells = specCells(spec)
  if (!cells.length && !path) return null
  return (
    <div className={cn("space-y-1", className)}>
      {path && (
        <p className="text-[11px] text-muted-foreground" dir="auto">
          {path}
        </p>
      )}
      {cells.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label={spec || undefined}>
          {cells.map((c, i) => (
            <li key={`${c}-${i}`} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground" dir="auto">
              {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
