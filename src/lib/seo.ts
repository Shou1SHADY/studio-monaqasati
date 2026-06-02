import type { Metadata } from 'next'

const BASE_URL = 'https://mdmaktech.sa'

export function alternatesForPath(path: string, locale: string) {
  const arPath = path === '/' ? BASE_URL : `${BASE_URL}${path}`
  const enPath = path === '/' ? `${BASE_URL}/en` : `${BASE_URL}/en${path}`
  const canonical = locale === 'ar' ? arPath : enPath

  return {
    canonical,
    languages: {
      ar: arPath,
      en: enPath,
      'x-default': arPath,
    },
  }
}

interface PageMetaParams {
  locale: string
  title: string
  description: string
  path: string
  ogImage?: string
}

export function buildPageMetadata({ locale, title, description, path, ogImage }: PageMetaParams): Metadata {
  const siteName = locale === 'ar' ? 'مدماك تيك' : 'Mdmak Tech'
  const fullTitle = `${title} | ${siteName}`
  const ogImg = ogImage || '/logo17.jpg'

  return {
    title: fullTitle,
    description,
    icons: {
      icon: '/logo17.jpg',
      shortcut: '/logo17.jpg',
      apple: '/logo17.jpg',
    },
    alternates: alternatesForPath(path, locale),
    openGraph: {
      type: 'website',
      locale: locale === 'ar' ? 'ar_SA' : 'en_US',
      siteName,
      title: fullTitle,
      description,
      images: [{ url: ogImg, width: 512, height: 512, alt: siteName }],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [ogImg],
    },
  }
}
