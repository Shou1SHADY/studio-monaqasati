"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { TRIAL_MAX_DAYS, parseTrialDays } from "@/lib/subscription-status"

export function TrialDaysInput({ id, label, value, onChange, disabled }: { id: string; label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const invalid = value !== "" && parseTrialDays(value) === null
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="font-bold">
        {label}
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        dir="ltr"
        className="max-w-[8rem]"
        value={value}
        maxLength={String(TRIAL_MAX_DAYS).length}
        aria-invalid={invalid}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      />
    </div>
  )
}
