"use client";

import { cn } from '@/lib/utils';

/**
 * The blueprint grid behind a section, with laser beams running along its lines
 * (vertical ones fall, horizontal ones cross). Beams sit on exact grid lines (48px cells)
 * and share the grid's edge fade. Hidden for reduced motion.
 */
export function GridBackdrop({ beams = true, className }: { beams?: boolean; className?: string }) {
  return (
    <div className={cn('absolute inset-0 ln-grid-bg pointer-events-none overflow-hidden', className)} aria-hidden="true">
      {beams && (
        <>
          <span className="ln-beam ln-beam-v ln-beam-v1" />
          <span className="ln-beam ln-beam-v ln-beam-v2" />
          <span className="ln-beam ln-beam-v ln-beam-v3" />
          <span className="ln-beam ln-beam-h ln-beam-h1" />
          <span className="ln-beam ln-beam-h ln-beam-h2" />
        </>
      )}
    </div>
  );
}
