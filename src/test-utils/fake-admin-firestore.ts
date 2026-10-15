// An in-memory stand-in for the Admin SDK's Firestore, enough for the server acts, the invoice route and the daily jobs:
// nested collections by path, `where(==)` chains, `add`, `set`/`update`/`create` (create refuses an existing document),
// and transactions that read documents or queries and write at the end. Tests mock `firebase-admin/firestore`'s
// FieldValue themselves.

type Doc = Record<string, unknown>

export class AdminError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

export interface FakeDocRef {
  id: string
  path: string
  get: () => Promise<FakeSnap>
  set: (data: Doc, opts?: { merge?: boolean }) => Promise<void>
  update: (patch: Doc) => Promise<void>
  create: (data: Doc) => Promise<void>
  collection: (name: string) => FakeCollection
}

export interface FakeSnap {
  exists: boolean
  id: string
  data: () => Doc | undefined
  ref: FakeDocRef
}

export interface FakeQuery {
  where: (field: string, op: string, value: unknown) => FakeQuery
  limit: (n: number) => FakeQuery
  get: () => Promise<{ empty: boolean; size: number; docs: FakeSnap[] }>
}

export interface FakeCollection extends FakeQuery {
  doc: (id?: string) => FakeDocRef
  add: (data: Doc) => Promise<FakeDocRef>
}

export class FakeAdminDb {
  docs = new Map<string, Doc>()
  private n = 0
  /** Every write, in order — `[path, data]`. */
  writes: [string, Doc][] = []

  seed(path: string, data: Doc) {
    this.docs.set(path, data)
    return this
  }

  get(path: string): Doc | undefined {
    return this.docs.get(path)
  }

  /** The documents directly under a collection path. */
  list(col: string): (Doc & { id: string })[] {
    return [...this.docs]
      .filter(([k]) => k.startsWith(`${col}/`) && !k.slice(col.length + 1).includes("/"))
      .map(([k, d]) => ({ ...d, id: k.slice(col.length + 1) }))
  }

  private write(path: string, data: Doc) {
    this.docs.set(path, data)
    this.writes.push([path, data])
  }

  private applyPatch(prev: Doc, patch: Doc): Doc {
    const next = { ...prev }
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object" && "__inc" in (v as Doc)) next[k] = (Number(next[k]) || 0) + Number((v as Doc).__inc)
      else next[k] = v
    }
    return next
  }

  doc(path: string): FakeDocRef {
    const id = path.slice(path.lastIndexOf("/") + 1)
    const ref: FakeDocRef = {
      id,
      path,
      get: async () => ({ exists: this.docs.has(path), id, data: () => this.docs.get(path), ref }),
      set: async (data, opts) => this.write(path, opts?.merge ? { ...(this.docs.get(path) || {}), ...data } : data),
      update: async (patch) => {
        if (!this.docs.has(path)) throw new AdminError("not-found")
        this.write(path, this.applyPatch(this.docs.get(path) || {}, patch))
      },
      create: async (data) => {
        if (this.docs.has(path)) throw new AdminError("already-exists")
        this.write(path, data)
      },
      collection: (name) => this.collection(`${path}/${name}`),
    }
    return ref
  }

  collection(col: string): FakeCollection {
    const query = (filters: [string, unknown][], max: number | null): FakeQuery => ({
      where: (f, _op, v) => query([...filters, [f, v]], max),
      limit: (n) => query(filters, n),
      get: async () => {
        const rows = this.list(col).filter((d) => filters.every(([f, v]) => d[f] === v))
        const docs = (max == null ? rows : rows.slice(0, max)).map((d) => {
          const ref = this.doc(`${col}/${d.id}`)
          return { exists: true, id: d.id, data: () => this.docs.get(`${col}/${d.id}`), ref }
        })
        return { empty: docs.length === 0, size: docs.length, docs }
      },
    })
    const base = query([], null)
    return {
      ...base,
      doc: (id?: string) => this.doc(`${col}/${id || `auto${++this.n}`}`),
      add: async (data: Doc) => {
        const ref = this.doc(`${col}/auto${++this.n}`)
        this.write(ref.path, data)
        return ref
      },
    }
  }

  /** Run transactions one after another, as Firestore does for two that read and write the same document (the second
   * retries after the first commits). Off by default: most tests run one act at a time. */
  serialTx = false
  private txChain: Promise<unknown> = Promise.resolve()

  async runTransaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    if (!this.serialTx) return this.runOne(fn)
    const run = this.txChain.then(() => this.runOne(fn))
    this.txChain = run.catch(() => undefined)
    return run
  }

  private async runOne<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    const pending: (() => Promise<void>)[] = []
    const tx: FakeTx = {
      get: ((target: FakeDocRef | FakeQuery) => ("path" in target ? (target as FakeDocRef).get() : (target as FakeQuery).get())) as FakeTx["get"],
      set: (ref, data, opts) => void pending.push(() => ref.set(data, opts)),
      update: (ref, patch) => void pending.push(() => ref.update(patch)),
      create: (ref, data) => {
        if (this.docs.has(ref.path)) throw new AdminError("already-exists")
        pending.push(() => ref.create(data))
      },
    }
    const out = await fn(tx)
    for (const w of pending) await w()
    return out
  }
}

export interface FakeTx {
  get: {
    (ref: FakeDocRef): Promise<FakeSnap>
    (q: FakeQuery): Promise<{ empty: boolean; size: number; docs: FakeSnap[] }>
  }
  set: (ref: FakeDocRef, data: Doc, opts?: { merge?: boolean }) => void
  update: (ref: FakeDocRef, patch: Doc) => void
  create: (ref: FakeDocRef, data: Doc) => void
}
