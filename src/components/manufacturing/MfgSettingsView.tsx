"use client"

// Settings (ST) — viewed by the workshop manager, the cost controller and
// management; edited by the manager only. Top to bottom: the station registry,
// what the organisation uses of the module, the policies read from Finance and
// Governance, the boundaries with the other Mdmak modules, and the
// manufacturing permissions matrix.

import { MfgSetStations } from "./MfgSetDepartments"
import { MfgSetBoundaries, MfgSetFeatures, MfgSetPermissions, MfgSetPolicies } from "./MfgSetReference"

export function MfgSettingsView() {
  return (
    <div className="space-y-4">
      <MfgSetStations />
      <MfgSetFeatures />
      <MfgSetPolicies />
      <MfgSetBoundaries />
      <MfgSetPermissions />
    </div>
  )
}
