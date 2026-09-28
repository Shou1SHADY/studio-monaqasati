// Supporting documents on a PM record (the prototype's attBox): photos or PDFs,
// always optional — a record is valid without them, but a delay or a dispute
// with a photo becomes evidence. Stored as `{url, name}` like the rest of PM.

export interface PmAttachment {
  url: string
  name: string
}

export const MAX_ATTACHMENTS = 10

/** Only well-formed entries, at most ten — what a write stores. */
export function cleanAttachments(files: ReadonlyArray<Partial<PmAttachment>> | null | undefined): PmAttachment[] {
  return (files ?? [])
    .filter((f): f is PmAttachment => typeof f?.url === "string" && f.url.length > 0 && typeof f.name === "string")
    .slice(0, MAX_ATTACHMENTS)
    .map((f) => ({ url: f.url, name: f.name }))
}

export const isPdf = (name: string) => /\.pdf$/i.test(name)
