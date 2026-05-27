import { MetadataRoute } from 'next'
import { routing } from '@/i18n/routing'

const BASE_URL = 'https://mdmaktech.sa'

const publicRoutes = [
  { path: '/', priority: 1.0, changeFreq: 'weekly' as const },
  { path: '/about', priority: 0.8, changeFreq: 'monthly' as const },
  { path: '/pricing', priority: 0.9, changeFreq: 'weekly' as const },
  { path: '/contact', priority: 0.7, changeFreq: 'monthly' as const },
  { path: '/terms', priority: 0.4, changeFreq: 'yearly' as const },
  { path: '/privacy', priority: 0.4, changeFreq: 'yearly' as const },
  { path: '/login', priority: 0.5, changeFreq: 'monthly' as const },
  { path: '/register', priority: 0.6, changeFreq: 'monthly' as const },
]

export default function sitemap(): MetadataRoute.Sitemap {
  const defaultLocale = routing.defaultLocale

  return publicRoutes.flatMap((route) => {
    const entries: MetadataRoute.Sitemap = [
      {
        url: `${BASE_URL}${route.path}`,
        lastModified: new Date(),
        changeFrequency: route.changeFreq,
        priority: route.path === '/' ? 1.0 : route.priority * 0.95,
      },
    ]

    for (const locale of routing.locales) {
      if (locale === defaultLocale) continue
      entries.push({
        url: `${BASE_URL}/${locale}${route.path}`,
        lastModified: new Date(),
        changeFrequency: route.changeFreq,
        priority: route.priority * 0.85,
      })
    }

    return entries
  })
}
