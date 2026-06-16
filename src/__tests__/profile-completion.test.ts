/**
 * Tests for the profile completion percentage logic used on web and mobile.
 * This catches the bug where description (optional) was used instead of city (required).
 * Formula: [name, phone, city, location, crNumber, taxNumber, cr.url, vat.url] / 8 for contractor
 *          [name, phone, city, location, crNumber, taxNumber, specializations, cr.url, vat.url, projects] / 10 for supplier
 */

// ─── Contractor completion formula ────────────────────────────────────────────

interface ContractorProfile {
  name: string
  phone: string
  city: string
  location: string
  crNumber: string
  taxNumber: string
  legalDocuments: {
    cr: { url: string }
    vat: { url: string }
  }
  description?: string // optional — must NOT affect percentage
}

function contractorCompletionPercentage(profile: ContractorProfile): number {
  return Math.round([
    profile.name,
    profile.phone,
    profile.city,
    profile.location,
    profile.crNumber,
    profile.taxNumber,
    profile.legalDocuments.cr.url,
    profile.legalDocuments.vat.url,
  ].filter(Boolean).length / 8 * 100)
}

describe('Contractor profile completion formula', () => {
  const fullyCompleteProfile: ContractorProfile = {
    name: 'شركة الأبناء',
    phone: '+966501234567',
    city: 'الرياض',
    location: 'طريق الملك عبدالعزيز',
    crNumber: '1010123456',
    taxNumber: '300012345678901',
    legalDocuments: {
      cr: { url: 'https://storage.example.com/cr.pdf' },
      vat: { url: 'https://storage.example.com/vat.pdf' },
    },
  }

  it('shows 100% when all 8 required fields are filled', () => {
    expect(contractorCompletionPercentage(fullyCompleteProfile)).toBe(100)
  })

  it('shows 100% even when optional description is empty', () => {
    const profileNoDesc = { ...fullyCompleteProfile, description: '' }
    expect(contractorCompletionPercentage(profileNoDesc)).toBe(100)
  })

  it('shows 88% when one of the 8 required fields is missing (7/8)', () => {
    const missing = { ...fullyCompleteProfile, city: '' }
    expect(contractorCompletionPercentage(missing)).toBe(88)
  })

  it('shows 75% when two fields are missing (6/8)', () => {
    // Remove exactly 2 fields: city + vat url → 6/8 remain
    const missing = {
      ...fullyCompleteProfile,
      city: '',
      legalDocuments: { cr: { url: fullyCompleteProfile.legalDocuments.cr.url }, vat: { url: '' } },
    }
    expect(contractorCompletionPercentage(missing)).toBe(75)
  })

  it('shows 0% for completely empty profile', () => {
    const empty: ContractorProfile = {
      name: '',
      phone: '',
      city: '',
      location: '',
      crNumber: '',
      taxNumber: '',
      legalDocuments: { cr: { url: '' }, vat: { url: '' } },
    }
    expect(contractorCompletionPercentage(empty)).toBe(0)
  })

  it('city is required — missing city reduces percentage', () => {
    const withCity = contractorCompletionPercentage(fullyCompleteProfile)
    const withoutCity = contractorCompletionPercentage({ ...fullyCompleteProfile, city: '' })
    expect(withCity).toBeGreaterThan(withoutCity)
  })

  it('description does NOT affect percentage (optional field)', () => {
    const withDesc = contractorCompletionPercentage({ ...fullyCompleteProfile, description: 'شركة متخصصة' })
    const withoutDesc = contractorCompletionPercentage({ ...fullyCompleteProfile, description: '' })
    expect(withDesc).toBe(withoutDesc)
  })

  it('missing VAT document reduces percentage by one step (12.5%)', () => {
    const withVat = contractorCompletionPercentage(fullyCompleteProfile)
    const withoutVat = contractorCompletionPercentage({
      ...fullyCompleteProfile,
      legalDocuments: { cr: { url: 'https://storage.example.com/cr.pdf' }, vat: { url: '' } },
    })
    // 8/8=100, 7/8=87.5→88; difference = 12 (rounding applied to each value, not to 1/8)
    expect(withVat - withoutVat).toBe(12)
  })
})

// ─── Supplier completion formula ──────────────────────────────────────────────

interface SupplierProfile {
  name: string
  phone: string
  city: string
  location: string
  crNumber: string
  taxNumber: string
  specializations: string[]
  legalDocuments: {
    cr: { url: string }
    vat: { url: string }
  }
  projects: any[]
  description?: string // optional — must NOT affect percentage
}

function supplierCompletionPercentage(profile: SupplierProfile): number {
  return Math.round([
    profile.name,
    profile.phone,
    profile.city,
    profile.location,
    profile.crNumber,
    profile.taxNumber,
    profile.specializations.length > 0,
    profile.legalDocuments.cr.url,
    profile.legalDocuments.vat.url,
    profile.projects.length > 0,
  ].filter(Boolean).length / 10 * 100)
}

describe('Supplier profile completion formula', () => {
  const fullyCompleteSupplier: SupplierProfile = {
    name: 'مورد الحديد',
    phone: '+966509876543',
    city: 'جدة',
    location: 'طريق الملك فهد',
    crNumber: '4030123456',
    taxNumber: '300098765432100',
    specializations: ['حديد ومعادن', 'أسمنت وخرسانة'],
    legalDocuments: {
      cr: { url: 'https://storage.example.com/cr.pdf' },
      vat: { url: 'https://storage.example.com/vat.pdf' },
    },
    projects: [{ name: 'مشروع الرياض', year: 2025 }],
  }

  it('shows 100% when all 10 fields are filled', () => {
    expect(supplierCompletionPercentage(fullyCompleteSupplier)).toBe(100)
  })

  it('shows 100% even when optional description is empty', () => {
    const noDesc = { ...fullyCompleteSupplier, description: '' }
    expect(supplierCompletionPercentage(noDesc)).toBe(100)
  })

  it('shows 90% when one field missing (9/10)', () => {
    const missing = { ...fullyCompleteSupplier, city: '' }
    expect(supplierCompletionPercentage(missing)).toBe(90)
  })

  it('specializations being empty reduces percentage', () => {
    const noSpecs = { ...fullyCompleteSupplier, specializations: [] }
    expect(supplierCompletionPercentage(noSpecs)).toBe(90)
  })

  it('no projects reduces percentage', () => {
    const noProjects = { ...fullyCompleteSupplier, projects: [] }
    expect(supplierCompletionPercentage(noProjects)).toBe(90)
  })

  it('shows 0% for completely empty supplier profile', () => {
    const empty: SupplierProfile = {
      name: '',
      phone: '',
      city: '',
      location: '',
      crNumber: '',
      taxNumber: '',
      specializations: [],
      legalDocuments: { cr: { url: '' }, vat: { url: '' } },
      projects: [],
    }
    expect(supplierCompletionPercentage(empty)).toBe(0)
  })
})

// ─── isProfileComplete gate check ─────────────────────────────────────────────
// This is the flag written to Firestore that unlocks app access

function isProfileComplete(profile: {
  name?: string
  phone?: string
  crNumber?: string
  taxNumber?: string
  city?: string
  location?: string
}): boolean {
  return !!(
    profile.name?.trim() &&
    profile.phone?.trim() &&
    profile.crNumber?.trim() &&
    profile.taxNumber?.trim() &&
    profile.city?.trim() &&
    profile.location?.trim()
  )
}

describe('isProfileComplete gate (6 required fields)', () => {
  it('returns true when all 6 required fields are filled', () => {
    expect(isProfileComplete({
      name: 'شركة الأبناء',
      phone: '+966501234567',
      crNumber: '1010123456',
      taxNumber: '300012345678901',
      city: 'الرياض',
      location: 'شارع الملك',
    })).toBe(true)
  })

  it('returns false when any field is missing', () => {
    expect(isProfileComplete({ name: 'شركة', phone: '+966', crNumber: '101', taxNumber: '300', city: '' })).toBe(false)
    expect(isProfileComplete({ name: 'شركة', phone: '+966', crNumber: '101', taxNumber: '', city: 'الرياض', location: 'شارع' })).toBe(false)
  })

  it('returns false for whitespace-only values', () => {
    expect(isProfileComplete({
      name: '  ',
      phone: '+966',
      crNumber: '101',
      taxNumber: '300',
      city: 'الرياض',
      location: 'شارع',
    })).toBe(false)
  })

  it('returns false for entirely empty profile', () => {
    expect(isProfileComplete({})).toBe(false)
  })
})
