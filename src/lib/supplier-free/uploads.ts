import { getDownloadURL, ref, uploadBytes, type FirebaseStorage } from "firebase/storage"

export interface StoredFile {
  name: string
  url: string
  path: string
}

const SAFE = /[^A-Za-z0-9._\u0600-\u06FF-]+/g

/** A supplier's file, stored under his company: quotes, invoices, warranties, documents. The company's legal documents
 * (`documents`) sit under the uploader's own id as well: storage.rules lets only him read or write them through Storage —
 * everyone else who may see one opens it by the link saved on the company's record. */
export async function uploadSupplierFile(storage: FirebaseStorage, orgId: string, folder: string, file: File, uploaderUid?: string): Promise<StoredFile> {
  if (folder === "documents" && !uploaderUid) throw new Error("a company document needs its uploader")
  const dir = folder === "documents" ? `${folder}/${uploaderUid}` : folder
  const path = `suppliers/${orgId}/${dir}/${Date.now()}-${file.name.replace(SAFE, "_")}`
  const r = ref(storage, path)
  await uploadBytes(r, file)
  return { name: file.name, url: await getDownloadURL(r), path }
}
