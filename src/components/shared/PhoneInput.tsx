"use client"

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { COUNTRIES, PHONE_DIAL_CODES } from "@/lib/constants"

const DEFAULT_COUNTRY = "SA"

/** Splits a stored phone value like "+966501234567" into its country code
 * and national number, matching the longest known dial code prefix first
 * (+971 vs +20 could otherwise both match a bare "+9..."). Falls back to
 * Saudi Arabia for unrecognized or empty values. */
function parsePhone(value: string): { country: string; national: string } {
  const digits = value.replace(/[^\d+]/g, "")
  const candidates = Object.entries(PHONE_DIAL_CODES).sort((a, b) => b[1].dialCode.length - a[1].dialCode.length)
  for (const [country, { dialCode }] of candidates) {
    if (digits.startsWith(dialCode)) {
      return { country, national: digits.slice(dialCode.length) }
    }
  }
  return { country: DEFAULT_COUNTRY, national: digits.replace(/^\+/, "") }
}

/**
 * A phone number field restricted to digits, with a country-code prefix
 * selector. Stores/emits the number as a single E.164-style string (e.g.
 * "+966501234567") so it's a drop-in replacement for a plain text `phone`
 * field — no schema change needed on documents that already store one.
 */
export function PhoneInput({
  value,
  onChange,
  id,
  disabled,
  locale,
}: {
  value: string
  onChange: (value: string) => void
  id?: string
  disabled?: boolean
  locale: string
}) {
  const t = useTranslations("Portal.Shared")
  const { country, national } = useMemo(() => parsePhone(value || ""), [value])
  const { nationalLength } = PHONE_DIAL_CODES[country] || PHONE_DIAL_CODES[DEFAULT_COUNTRY]

  const handleCountryChange = (nextCountry: string) => {
    const dialCode = PHONE_DIAL_CODES[nextCountry]?.dialCode || PHONE_DIAL_CODES[DEFAULT_COUNTRY].dialCode
    onChange(national ? `${dialCode}${national}` : "")
  }

  const handleNumberChange = (raw: string) => {
    const digitsOnly = raw.replace(/\D/g, "").slice(0, nationalLength)
    const dialCode = PHONE_DIAL_CODES[country]?.dialCode || PHONE_DIAL_CODES[DEFAULT_COUNTRY].dialCode
    onChange(digitsOnly ? `${dialCode}${digitsOnly}` : "")
  }

  const isIncomplete = national.length > 0 && national.length < nationalLength

  return (
    <div dir="ltr">
      <div className="flex gap-2">
        <Select value={country} onValueChange={handleCountryChange} disabled={disabled}>
          <SelectTrigger className="w-[110px] h-11 shrink-0">
            <SelectValue>{PHONE_DIAL_CODES[country]?.dialCode}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {COUNTRIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {PHONE_DIAL_CODES[c.value]?.dialCode} — {locale === "ar" ? c.labelAr : c.labelEn}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          id={id}
          type="tel"
          inputMode="numeric"
          value={national}
          onChange={(e) => handleNumberChange(e.target.value)}
          disabled={disabled}
          placeholder={"5".padEnd(nationalLength, "x")}
          className="h-11 flex-1 text-left"
        />
      </div>
      {isIncomplete && (
        <p className="text-[11px] text-warning mt-1">{t("phone_incomplete", { count: nationalLength })}</p>
      )}
    </div>
  )
}
