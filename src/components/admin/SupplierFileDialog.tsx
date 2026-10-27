"use client"

// A supplier company's file for the platform admin: who it is, its official documents, its certificates, and the
// decisions that are the admin's — approve, a specializations request, where it is based, delete. The subscribed list and
// the free list open the same file; each passes only the decisions it offers (the free list has no delete).

import type { ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertCircle, Award, Building, CheckCircle2, ExternalLink, FileText, Trash2, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { NativeSelect } from "@/components/module-ui/NativeSelect"

export type SupplierOrigin = "auto" | "local" | "international"

interface LegalDoc {
  url?: string
  expiryDate?: string
}

interface Certificate {
  name?: string
  issuer?: string
  expiryDate?: string
  documentUrl?: string
}

export interface SupplierFile {
  id: string
  name: string
  email: string
  contact: string
  city: string
  crNumber: string
  taxNumber: string
  category: string
  specializations: string[]
  coverageCities: string[]
  pendingSpecializations: string[] | null
  pendingCoverageCities: string[] | null
  hasSpecsRequest: boolean
  legalDocuments: Record<string, LegalDoc | undefined>
  certificates: Certificate[]
  hasAllRequiredDocs: boolean
  verified: boolean
  origin?: SupplierOrigin
  international?: boolean
}

export function SupplierFileDialog({
  supplier,
  open,
  onOpenChange,
  statusBadge,
  onVerify,
  canWithdraw = true,
  onSpecsDecision,
  onOrigin,
  onDelete,
  children,
}: {
  supplier: SupplierFile | null
  open: boolean
  onOpenChange: (open: boolean) => void
  statusBadge: ReactNode
  onVerify?: (verify: boolean) => void
  /** False leaves an approved company's approval alone (the free list only approves). */
  canWithdraw?: boolean
  onSpecsDecision?: (approve: boolean) => void
  onOrigin?: (origin: SupplierOrigin) => void
  onDelete?: () => void
  /** Facts the caller adds under the basics (how it came, its quotes…). */
  children?: ReactNode
}) {
  const t = useTranslations("Portal.Admin.Suppliers")
  const locale = useLocale()
  const docLabels: Record<string, string> = { cr: t("doc_cr"), vat: t("doc_vat") }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir={locale === "ar" ? "rtl" : "ltr"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <Building size={22} className="text-primary" />
            {t("supplier_details")}
          </DialogTitle>
          <DialogDescription>{t("details_subtitle")}</DialogDescription>
        </DialogHeader>

        {supplier && (
          <div className="space-y-5 py-2">
            <div className="bg-slate-50 p-4 rounded-xl space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="font-bold text-lg text-slate-800">{supplier.name}</h4>
                {statusBadge}
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><span className="text-muted-foreground">{t("email_label")}</span><span className="ms-2 font-medium text-xs">{supplier.email || "—"}</span></div>
                <div><span className="text-muted-foreground">{t("phone_label")}</span><bdi dir="ltr" className="ms-2 font-medium">{supplier.contact || "—"}</bdi></div>
                <div><span className="text-muted-foreground">{t("city_label")}</span><span className="ms-2 font-medium">{supplier.city || "—"}</span></div>
                <div><span className="text-muted-foreground">{t("cr_label")}</span><span className="ms-2 font-medium">{supplier.crNumber || "—"}</span></div>
                <div><span className="text-muted-foreground">{t("tax_label")}</span><span className="ms-2 font-medium">{supplier.taxNumber || "—"}</span></div>
                <div><span className="text-muted-foreground">{t("spec_label")}</span><span className="ms-2 font-medium">{supplier.category || "—"}</span></div>
              </div>
              {onOrigin && (
                <div className="flex flex-col gap-1.5 border-t pt-3 sm:flex-row sm:items-center sm:gap-3">
                  <label htmlFor="supplier-origin" className="text-sm text-muted-foreground shrink-0">{t("origin_label")}</label>
                  <NativeSelect
                    id="supplier-origin"
                    value={supplier.origin ?? "auto"}
                    onChange={(e) => onOrigin(e.target.value as SupplierOrigin)}
                    className="sm:w-64"
                  >
                    <option value="auto">{t(supplier.international ? "origin_auto_intl" : "origin_auto_local")}</option>
                    <option value="local">{t("origin_local")}</option>
                    <option value="international">{t("origin_international")}</option>
                  </NativeSelect>
                </div>
              )}
              {supplier.specializations.length > 1 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {supplier.specializations.map((spec) => (
                    <Badge key={spec} variant="secondary" className="text-xs">{spec}</Badge>
                  ))}
                </div>
              )}
            </div>

            {children}

            {supplier.hasSpecsRequest && onSpecsDecision && (
              <>
                <Separator />
                <div className="space-y-3 p-4 rounded-xl bg-cta/5 border border-cta/20">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2">
                    <Zap size={18} className="text-cta" />
                    {t("specs_request_title")}
                  </h4>
                  {supplier.pendingSpecializations && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-bold text-muted-foreground">{t("specs_requested_specializations")}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {supplier.pendingSpecializations.map((spec) => (
                          <Badge key={spec} className={supplier.specializations.includes(spec) ? "bg-slate-100 text-slate-600 text-xs" : "bg-cta/10 text-cta border-cta/20 text-xs"}>
                            {spec}
                          </Badge>
                        ))}
                        {supplier.pendingSpecializations.length === 0 && <span className="text-xs text-muted-foreground">{t("specs_requested_empty")}</span>}
                      </div>
                    </div>
                  )}
                  {supplier.pendingCoverageCities && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-bold text-muted-foreground">{t("specs_requested_coverage")}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {supplier.pendingCoverageCities.map((city) => (
                          <Badge key={city} className={supplier.coverageCities.includes(city) ? "bg-slate-100 text-slate-600 text-xs" : "bg-cta/10 text-cta border-cta/20 text-xs"}>
                            {city}
                          </Badge>
                        ))}
                        {supplier.pendingCoverageCities.length === 0 && <span className="text-xs text-muted-foreground">{t("specs_requested_empty")}</span>}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={() => onSpecsDecision(true)} className="gap-1.5">
                      <CheckCircle2 size={14} />
                      {t("specs_approve")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onSpecsDecision(false)} className="text-destructive border-destructive/20 hover:bg-destructive/5">
                      {t("specs_reject")}
                    </Button>
                  </div>
                </div>
              </>
            )}

            <Separator />

            <div className="space-y-3">
              <h4 className="font-bold text-slate-800 flex items-center gap-2">
                <FileText size={18} className="text-primary" />
                {t("legal_docs_title")}
              </h4>
              {Object.entries(docLabels).map(([key, label]) => {
                const docData = supplier.legalDocuments?.[key]
                const url = docData?.url
                const hasUrl = typeof url === "string" && url.length > 0
                return (
                  <div
                    key={key}
                    className={`p-4 rounded-xl border flex items-center justify-between gap-4 ${hasUrl ? "bg-emerald-50/60 border-emerald-200" : "bg-slate-50 border-slate-200"}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`h-9 w-9 rounded-lg flex items-center justify-center shrink-0 ${hasUrl ? "bg-emerald-100 text-emerald-600" : "bg-slate-100 text-slate-400"}`}>
                        <FileText size={18} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-slate-800">{label}</p>
                        {hasUrl ? (
                          <p className="text-xs text-emerald-700 font-medium mt-0.5">
                            {t("uploaded")}
                            {docData?.expiryDate && <span className="text-slate-500 ms-2">{t("expires", { date: docData.expiryDate })}</span>}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-400 mt-0.5">{t("not_uploaded")}</p>
                        )}
                      </div>
                    </div>
                    {hasUrl ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                        <Button size="sm" variant="outline" className="gap-1.5 text-xs font-bold border-emerald-300 hover:bg-emerald-50">
                          <ExternalLink size={13} />
                          {t("open_file")}
                        </Button>
                      </a>
                    ) : (
                      <Badge variant="secondary" className="text-xs shrink-0">{t("not_found_doc")}</Badge>
                    )}
                  </div>
                )
              })}
            </div>

            {supplier.certificates.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h4 className="font-bold text-slate-800 flex items-center gap-2">
                    <Award size={18} className="text-purple-500" />
                    {t("certificates_title", { count: supplier.certificates.length })}
                  </h4>
                  <div className="space-y-2">
                    {supplier.certificates.map((cert, idx) => (
                      <div key={idx} className="p-3 rounded-xl border bg-purple-50/40 border-purple-100 flex items-center justify-between">
                        <div>
                          <p className="font-bold text-sm">{cert.name}</p>
                          <p className="text-xs text-muted-foreground">{cert.issuer}{cert.expiryDate && ` • ${t("expires", { date: cert.expiryDate })}`}</p>
                        </div>
                        {cert.documentUrl && (
                          <a href={cert.documentUrl} target="_blank" rel="noopener noreferrer">
                            <Button size="sm" variant="outline" className="gap-1 text-xs">
                              <ExternalLink size={12} />
                              {t("view")}
                            </Button>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {!supplier.hasAllRequiredDocs && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-destructive/10 border border-destructive/20">
                <AlertCircle className="text-destructive shrink-0 mt-0.5" size={18} />
                <p className="text-sm text-destructive font-bold">{t("cannot_verify")}</p>
              </div>
            )}

            <Separator />

            <div className="flex gap-3 pt-1 flex-wrap">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                {t("close")}
              </Button>
              {onVerify && supplier.verified && canWithdraw && (
                <Button
                  variant="outline"
                  className="flex-1 text-destructive border-destructive/20 hover:bg-destructive/5"
                  onClick={() => { onVerify(false); onOpenChange(false) }}
                >
                  {t("unverify_account")}
                </Button>
              )}
              {onVerify && !supplier.verified && (
                <Button className="flex-1 gap-2" disabled={!supplier.hasAllRequiredDocs} onClick={() => { onVerify(true); onOpenChange(false) }}>
                  <CheckCircle2 size={16} />
                  {t("verify_account")}
                </Button>
              )}
              {onDelete && (
                <Button variant="outline" className="gap-2 text-destructive border-destructive/20 hover:bg-destructive/5" onClick={onDelete}>
                  <Trash2 size={15} />
                  {t("delete_account")}
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
