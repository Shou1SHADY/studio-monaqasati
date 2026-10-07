import { addDoc, collection, type Firestore } from "firebase/firestore"
import { DOCUMENT_NOTES, sideOf, storedParties, threadBlocks, threadKey, type DocParties, type ThreadBlock, type ThreadFile, type ThreadTarget, type Visibility } from "./document-thread"
import { emitProcEvent } from "./procurement/events"

export class ThreadError extends Error {
  constructor(readonly blocks: ThreadBlock[]) {
    super("blocked")
    this.name = "ThreadError"
  }
}

export interface ThreadActor {
  uid: string
  name: string
  /** The author's own company. */
  orgId: string
}

/** Who to tell on each side — the people the document already names. */
export interface ThreadNotify {
  buyer?: string[]
  supplier?: string[]
}

interface PostBase {
  target: ThreadTarget
  parties: DocParties
  visibility: Visibility
  notify?: ThreadNotify
}

const snippet = (text: string) => (text.length > 140 ? `${text.slice(0, 137)}…` : text)

async function post(firestore: Firestore, actor: ThreadActor, input: PostBase & { kind: "comment" | "file"; body: string; file?: ThreadFile }) {
  const side = sideOf(actor.orgId, input.parties)
  const body = input.body.trim()
  const blocks = threadBlocks({ kind: input.kind, body, file: input.file, visibility: input.visibility, side, parties: input.parties })
  if (blocks.length || !side) throw new ThreadError(blocks)
  const key = threadKey(input.target.kind, input.target.id)
  const stored = storedParties(input.visibility, side, input.parties)
  const shared = stored.buyerOrgId !== null && stored.supplierOrgId !== null
  const ref = await addDoc(collection(firestore, DOCUMENT_NOTES), {
    targetKey: key,
    targetKind: input.target.kind,
    targetId: input.target.id,
    targetLabel: input.target.label,
    targetHref: input.target.href,
    targetSupplierHref: input.target.supplierHref ?? "",
    kind: input.kind,
    visibility: shared ? "shared" : "internal",
    body,
    file: input.file ?? null,
    authorId: actor.uid,
    authorName: actor.name,
    authorOrgId: actor.orgId,
    ...stored,
    at: new Date().toISOString(),
  })
  const toTell = shared ? (side === "buyer" ? input.notify?.supplier : input.notify?.buyer) : null
  if (toTell?.length) {
    await emitProcEvent(firestore, { uid: actor.uid, name: actor.name }, {
      kind: input.kind === "comment" ? "doc_comment" : "doc_file",
      organizationId: side === "buyer" ? (input.parties.supplierOrgId as string) : input.parties.buyerOrgId,
      to: [{ users: toTell }],
      params: { about: input.target.label, text: snippet(input.kind === "comment" ? body : input.file?.name ?? "") },
      link: side === "buyer" ? (input.target.supplierHref ?? input.target.href) : input.target.href,
    })
  }
  return ref.id
}

/** A comment on a document: shared with the other company, or kept inside the author's own. */
export const postComment = (firestore: Firestore, actor: ThreadActor, input: PostBase & { body: string }) => post(firestore, actor, { ...input, kind: "comment" })

/** An attachment already uploaded to Storage; `body` is an optional caption. */
export const attachThreadFile = (firestore: Firestore, actor: ThreadActor, input: PostBase & { file: ThreadFile; body?: string }) =>
  post(firestore, actor, { ...input, kind: "file", body: input.body ?? "" })
