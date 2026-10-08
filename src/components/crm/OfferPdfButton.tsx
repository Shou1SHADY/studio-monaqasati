"use client"

import { QuotationPdfSheet } from "@/components/sales/QuotationPdfSheet"
import { QuotationPrintButton } from "@/components/sales/QuotationPrintButton"
import { useQuotationBrandingDefaults } from "@/hooks/useQuotationBranding"
import type { CrmContact, CrmQuotation } from "@/lib/crm"
import { sheetDataFromQuotation } from "@/lib/quotation-document"
import { cn } from "@/lib/utils"
import { ltr } from "@/components/crm/OppBits"

/**
 * The offer's PDF as the client received it (OPP-04 #5): Sales' own quotation document for that version, printed to PDF
 * from the record — once sent, the rules lock every figure and text on it, so this IS what went to the client.
 */
export function OfferPdfButton({ quote, contact, className }: { quote: CrmQuotation; contact?: CrmContact | null; className?: string }) {
  const { branding } = useQuotationBrandingDefaults()
  return (
    <QuotationPrintButton
      size="sm"
      variant="outline"
      className={cn("h-7 gap-1 px-2 text-[11px] font-semibold", className)}
      sheet={<QuotationPdfSheet data={sheetDataFromQuotation(quote, { fallbackBranding: branding, contact })} />}
      documentTitle={quote.quotationNumber}
      label={ltr(`${quote.quotationNumber}.pdf`)}
    />
  )
}

