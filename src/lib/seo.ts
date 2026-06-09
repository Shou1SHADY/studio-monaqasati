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
  const ogImg = ogImage || '/og-image.jpg'

  return {
    title: fullTitle,
    description,
    manifest: '/site.webmanifest',
    icons: {
      icon: [
        { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
        { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
        { url: '/favicon.ico', sizes: '48x48' },
      ],
      shortcut: '/favicon.ico',
      apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    },
    alternates: alternatesForPath(path, locale),
    openGraph: {
      type: 'website',
      locale: locale === 'ar' ? 'ar_SA' : 'en_US',
      siteName,
      title: fullTitle,
      description,
      images: [{ url: ogImg, width: 1200, height: 630, alt: siteName }],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: [ogImg],
    },
  }
}
