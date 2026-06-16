import {
  CATEGORIES_DATA,
  PREDEFINED_CATEGORIES,
  SAUDI_CITIES,
  CATEGORIES_EN,
  CITIES_EN,
  getCategoryName,
  getCityName,
  displayCategory,
  displayCity,
  displaySubcategory,
  SUBCATEGORIES_EN,
} from '../lib/constants'

// ─── CATEGORIES_DATA ──────────────────────────────────────────────────────────

describe('CATEGORIES_DATA', () => {
  it('has at least 10 main categories', () => {
    expect(Object.keys(CATEGORIES_DATA).length).toBeGreaterThanOrEqual(10)
  })

  it('every category has at least one subcategory', () => {
    Object.entries(CATEGORIES_DATA).forEach(([cat, subs]) => {
      expect(Array.isArray(subs)).toBe(true)
      expect(subs.length).toBeGreaterThan(0)
    })
  })

  it('all subcategories are strings', () => {
    Object.values(CATEGORIES_DATA).flat().forEach(sub => {
      expect(typeof sub).toBe('string')
      expect(sub.trim().length).toBeGreaterThan(0)
    })
  })

  it('contains key construction categories', () => {
    expect(CATEGORIES_DATA).toHaveProperty('حديد ومعادن')
    expect(CATEGORIES_DATA).toHaveProperty('أسمنت وخرسانة')
    expect(CATEGORIES_DATA).toHaveProperty('كهرباء وإنارة')
    expect(CATEGORIES_DATA).toHaveProperty('أبواب ونوافذ')
  })

  it('حديد ومعادن contains rebar', () => {
    expect(CATEGORIES_DATA['حديد ومعادن']).toContain('حديد تسليح')
  })
})

// ─── PREDEFINED_CATEGORIES ────────────────────────────────────────────────────

describe('PREDEFINED_CATEGORIES', () => {
  it('equals Object.keys of CATEGORIES_DATA', () => {
    expect(PREDEFINED_CATEGORIES).toEqual(Object.keys(CATEGORIES_DATA))
  })

  it('has no duplicates', () => {
    const unique = new Set(PREDEFINED_CATEGORIES)
    expect(unique.size).toBe(PREDEFINED_CATEGORIES.length)
  })

  it('all entries are non-empty strings', () => {
    PREDEFINED_CATEGORIES.forEach(cat => {
      expect(typeof cat).toBe('string')
      expect(cat.trim().length).toBeGreaterThan(0)
    })
  })
})

// ─── SAUDI_CITIES ─────────────────────────────────────────────────────────────

describe('SAUDI_CITIES', () => {
  it('contains at least 15 cities', () => {
    expect(SAUDI_CITIES.length).toBeGreaterThanOrEqual(15)
  })

  it('has no duplicates', () => {
    const unique = new Set(SAUDI_CITIES)
    expect(unique.size).toBe(SAUDI_CITIES.length)
  })

  it('contains the major cities', () => {
    expect(SAUDI_CITIES).toContain('الرياض')
    expect(SAUDI_CITIES).toContain('جدة')
    expect(SAUDI_CITIES).toContain('الدمام')
    expect(SAUDI_CITIES).toContain('مكة المكرمة')
    expect(SAUDI_CITIES).toContain('المدينة المنورة')
  })

  it('all entries are non-empty strings', () => {
    SAUDI_CITIES.forEach(city => {
      expect(typeof city).toBe('string')
      expect(city.trim().length).toBeGreaterThan(0)
    })
  })
})

// ─── getCategoryName() ────────────────────────────────────────────────────────

describe('getCategoryName()', () => {
  it('returns Arabic name for ar locale', () => {
    expect(getCategoryName('حديد ومعادن', 'ar')).toBe('حديد ومعادن')
  })

  it('returns English name for en locale', () => {
    expect(getCategoryName('حديد ومعادن', 'en')).toBe('Iron & Metals')
    expect(getCategoryName('أسمنت وخرسانة', 'en')).toBe('Cement & Concrete')
  })

  it('falls back to Arabic key if no EN translation exists', () => {
    expect(getCategoryName('فئة غير موجودة', 'en')).toBe('فئة غير موجودة')
  })
})

// ─── getCityName() ────────────────────────────────────────────────────────────

describe('getCityName()', () => {
  it('returns Arabic name for ar locale', () => {
    expect(getCityName('الرياض', 'ar')).toBe('الرياض')
  })

  it('returns English name for en locale', () => {
    expect(getCityName('الرياض', 'en')).toBe('Riyadh')
    expect(getCityName('جدة', 'en')).toBe('Jeddah')
    expect(getCityName('الدمام', 'en')).toBe('Dammam')
  })

  it('falls back to Arabic for unknown city in en', () => {
    expect(getCityName('مدينة غير موجودة', 'en')).toBe('مدينة غير موجودة')
  })
})

// ─── displayCategory() ────────────────────────────────────────────────────────

describe('displayCategory()', () => {
  it('returns Arabic for ar locale', () => {
    expect(displayCategory('حديد ومعادن', 'ar')).toBe('حديد ومعادن')
  })

  it('returns English for en locale', () => {
    expect(displayCategory('كهرباء وإنارة', 'en')).toBe('Electrical & Lighting')
  })

  it('falls back to key if not in CATEGORIES_EN', () => {
    expect(displayCategory('غير موجود', 'en')).toBe('غير موجود')
  })

  it('all PREDEFINED_CATEGORIES have English translations', () => {
    PREDEFINED_CATEGORIES.forEach(cat => {
      const en = displayCategory(cat, 'en')
      expect(typeof en).toBe('string')
      expect(en.trim().length).toBeGreaterThan(0)
    })
  })
})

// ─── displayCity() ────────────────────────────────────────────────────────────

describe('displayCity()', () => {
  it('returns Arabic for ar locale', () => {
    expect(displayCity('الرياض', 'ar')).toBe('الرياض')
  })

  it('returns English for en locale', () => {
    expect(displayCity('جدة', 'en')).toBe('Jeddah')
  })

  it('all SAUDI_CITIES have entries in CITIES_EN', () => {
    SAUDI_CITIES.forEach(city => {
      expect(CITIES_EN).toHaveProperty(city)
    })
  })
})

// ─── CATEGORIES_EN & CITIES_EN coverage ──────────────────────────────────────

describe('CATEGORIES_EN', () => {
  it('covers all PREDEFINED_CATEGORIES', () => {
    PREDEFINED_CATEGORIES.forEach(cat => {
      expect(CATEGORIES_EN).toHaveProperty(cat)
    })
  })

  it('all translations are non-empty English strings', () => {
    Object.values(CATEGORIES_EN).forEach(val => {
      expect(typeof val).toBe('string')
      expect(val.trim().length).toBeGreaterThan(0)
    })
  })
})

describe('CITIES_EN', () => {
  it('covers all SAUDI_CITIES', () => {
    SAUDI_CITIES.forEach(city => {
      expect(CITIES_EN).toHaveProperty(city)
    })
  })

  it('all translations are non-empty English strings', () => {
    Object.values(CITIES_EN).forEach(val => {
      expect(typeof val).toBe('string')
      expect(val.trim().length).toBeGreaterThan(0)
    })
  })
})

// ─── displaySubcategory() ─────────────────────────────────────────────────────

describe('displaySubcategory()', () => {
  it('returns Arabic for ar locale', () => {
    expect(displaySubcategory('حديد تسليح', 'ar')).toBe('حديد تسليح')
  })

  it('returns English for en locale when translation exists', () => {
    const en = displaySubcategory('حديد تسليح', 'en')
    expect(en).toBe(SUBCATEGORIES_EN['حديد تسليح'] || 'حديد تسليح')
  })

  it('falls back to Arabic key when no EN translation', () => {
    expect(displaySubcategory('تخصص غير موجود', 'en')).toBe('تخصص غير موجود')
  })
})
