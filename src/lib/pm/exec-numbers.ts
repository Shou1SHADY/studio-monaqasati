// The shown number of an Execution record that carries its project's sequence
// (the prototype's msNext/punchNext/ncrNext): «ق-014/07», «مل-014/03»,
// «ن.م-014/02» — the prefix is the message's, this is what follows it. The
// stored `seq` stays a plain number; without the project's PJ number (a legacy
// project, or still loading) the record's own number stands alone.

import { projectSeq } from "./correspondence"

export const projectDocNo = (projectNo: string | null | undefined, seq: number) => {
  const no = String(seq).padStart(2, "0")
  return projectNo ? `${projectSeq(projectNo)}/${no}` : no
}
