import { getDownloadURL, ref, uploadBytes, type FirebaseStorage } from "firebase/storage"

export interface StoredFile {
  name: string
  url: string
  path: string
}

const SAFE = /[^A-Za-z0-9._\u0600-\u06FF-]+/g

/** A supplier's file, stored under his company: quotes, invoices, warranties, documents. */
export async function uploadSupplierFile(storage: FirebaseStorage, orgId: string, folder: string, file: File): Promise<StoredFile> {
  const path = `suppliers/${orgId}/${folder}/${Date.now()}-${file.name.replace(SAFE, "_")}`
  const r = ref(storage, path)
  await uploadBytes(r, file)
  return { name: file.name, url: await getDownloadURL(r), path }
}
