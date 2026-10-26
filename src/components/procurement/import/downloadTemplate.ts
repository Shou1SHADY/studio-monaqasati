import { MATERIALS_TEMPLATE_FILE, buildMaterialsTemplate } from "@/lib/boq-import/materials-template"

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/** «حمّل قالب مدماك»: the template built in the browser and handed to the user. Returns false when the browser would not. */
export function downloadMaterialsTemplate(): boolean {
  try {
    const url = URL.createObjectURL(new Blob([buildMaterialsTemplate()], { type: XLSX }))
    const a = document.createElement("a")
    a.href = url
    a.download = MATERIALS_TEMPLATE_FILE
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    return true
  } catch {
    return false
  }
}
