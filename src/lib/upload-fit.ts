// Files sent THROUGH a Next.js route (multipart to /api/...) must fit the host's request-body
// limit: Vercel, where production runs, refuses a body over 4.5 MB before the route sees it.
// A phone photo at the gate is often 4–8 MB, so an image is re-encoded in the browser before it is
// sent; a PDF over the limit is refused with a clear message. The routes check the same ceiling.

/** The most a route accepts — under Vercel's 4.5 MB body limit, with room for the form's other fields. */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024
/** Images above this are re-encoded before upload. */
const SHRINK_ABOVE = 2.5 * 1024 * 1024
const MAX_SIDE = 2400

export const shouldShrink = (f: { size: number; type: string }): boolean => f.type.startsWith("image/") && f.type !== "image/gif" && f.size > SHRINK_ABOVE

/** The file as it can be sent, or null when it cannot be made to fit (a PDF over the limit). Browser only. */
export async function fitForUpload(file: File): Promise<File | null> {
  if (!shouldShrink(file)) return file.size <= UPLOAD_MAX_BYTES ? file : null
  try {
    const bitmap = await createImageBitmap(file)
    for (const [side, quality] of [[MAX_SIDE, 0.82], [1800, 0.75], [1400, 0.7]] as const) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality))
      if (blob && blob.size <= UPLOAD_MAX_BYTES) return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" })
    }
  } catch {
    /* an image the browser cannot decode (HEIC on some browsers): send it as it is if it fits */
  }
  return file.size <= UPLOAD_MAX_BYTES ? file : null
}
