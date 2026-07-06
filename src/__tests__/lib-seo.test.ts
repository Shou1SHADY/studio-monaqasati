import { alternatesForPath, buildPageMetadata } from '../lib/seo'

const BASE_URL = 'https://mdmaktech.sa'

describe('alternatesForPath()', () => {
  describe('root path "/"', () => {
    it('Arabic locale: canonical is base URL', () => {
      const result = alternatesForPath('/', 'ar')
      expect(result.canonical).toBe(BASE_URL)
    })

    it('English locale: canonical is /en', () => {
      const result = alternatesForPath('/', 'en')
      expect(result.canonical).toBe(`${BASE_URL}/en`)
    })

    it('always includes ar, en, x-default language alternates', () => {
      const result = alternatesForPath('/', 'ar')
      expect(result.languages).toHaveProperty('ar', BASE_URL)
      expect(result.languages).toHaveProperty('en', `${BASE_URL}/en`)
      expect(result.languages).toHaveProperty('x-default', BASE_URL)
    })
  })

  describe('non-root path', () => {
    it('Arabic canonical is base + path', () => {
      const result = alternatesForPath('/contact', 'ar')
      expect(result.canonical).toBe(`${BASE_URL}/contact`)
    })

    it('English canonical is /en + path', () => {
      const result = alternatesForPath('/contact', 'en')
      expect(result.canonical).toBe(`${BASE_URL}/en/contact`)
    })

    it('language alternates include both ar and en paths', () => {
      const result = alternatesForPath('/pricing', 'ar')
      expect(result.languages.ar).toBe(`${BASE_URL}/pricing`)
      expect(result.languages.en).toBe(`${BASE_URL}/en/pricing`)
    })

    it('x-default always points to ar version', () => {
      const result = alternatesForPath('/about', 'en')
      expect(result.languages['x-default']).toBe(`${BASE_URL}/about`)
    })
  })
})

describe('buildPageMetadata()', () => {
  const base = {
    locale: 'ar',
    title: 'الرئيسية',
    description: 'منصة طلبات عروض أسعار ذكية',
    path: '/',
  }

  it('includes locale-aware site name in title', () => {
    const meta = buildPageMetadata(base)
    expect(meta.title).toContain('مدماك تيك')
  })

  it('includes English site name for en locale', () => {
    const meta = buildPageMetadata({ ...base, locale: 'en', title: 'Home' })
    expect(meta.title).toContain('Mdmak Tech')
  })

  it('formats title as "title | siteName"', () => {
    const meta = buildPageMetadata({ ...base, title: 'الأسعار' })
    expect(meta.title).toBe('الأسعار | مدماك تيك')
  })

  it('passes description through', () => {
    const meta = buildPageMetadata(base)
    expect(meta.description).toBe('منصة طلبات عروض أسعار ذكية')
  })

  it('includes openGraph data', () => {
    const meta = buildPageMetadata(base)
    expect(meta.openGraph).toBeDefined()
    expect(meta.openGraph?.type).toBe('website')
    expect(meta.openGraph?.title).toContain('الرئيسية')
  })

  it('uses ar_SA locale for OG when locale is ar', () => {
    const meta = buildPageMetadata(base)
    expect(meta.openGraph?.locale).toBe('ar_SA')
  })

  it('uses en_US locale for OG when locale is en', () => {
    const meta = buildPageMetadata({ ...base, locale: 'en', title: 'Home', description: 'desc' })
    expect(meta.openGraph?.locale).toBe('en_US')
  })

  it('includes twitter card metadata', () => {
    const meta = buildPageMetadata(base)
    expect(meta.twitter).toBeDefined()
    expect(meta.twitter?.card).toBe('summary_large_image')
  })

  it('uses default OG image when none provided', () => {
    const meta = buildPageMetadata(base)
    expect((meta.openGraph?.images as any[])?.[0]?.url).toBe('/og-image.jpg')
  })

  it('uses custom OG image when provided', () => {
    const meta = buildPageMetadata({ ...base, ogImage: '/custom-og.jpg' })
    expect((meta.openGraph?.images as any[])?.[0]?.url).toBe('/custom-og.jpg')
  })

  it('includes alternates with canonical URL', () => {
    const meta = buildPageMetadata(base)
    expect(meta.alternates?.canonical).toBe(BASE_URL)
  })

  it('includes manifest and favicon icons', () => {
    const meta = buildPageMetadata(base)
    expect(meta.manifest).toBe('/site.webmanifest')
    expect(meta.icons).toBeDefined()
  })
})
