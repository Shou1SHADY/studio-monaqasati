// HR 1.0 — the first line of every HR write: the guard again, whatever the
// screen showed (RL-02, NFR "server-enforced"); a refusal or a block carries
// its code, and the screen words it.

import { hrRefusal, type HrAction, type HrContext } from "./access"

export class HrWriteError extends Error {
  constructor(readonly code: string, readonly blocks: string[] = []) {
    super(code)
    this.name = "HrWriteError"
  }
}

export function assertHr(ctx: HrContext, action: HrAction, scope: { site?: string | null } = {}): void {
  const r = hrRefusal(ctx, action, scope)
  if (r) throw new HrWriteError(r)
}
