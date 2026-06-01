import { MetadataRoute } from 'next'
import { routing } from '@/i18n/routing'

const BASE_URL = 'https://mdmaktech.sa'
const defaultLocale = routing.defaultLocale

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
  return publicRoutes.flatMap((route) => {
    const arUrl = route.path === '/'
      ? BASE_URL
      : `${BASE_URL}${route.path}`
    const enUrl = route.path === '/'
      ? `${BASE_URL}/en`
      : `${BASE_URL}/en${route.path}`

    const languages: Record<string, string> = {
      ar: arUrl,
      en: enUrl,
      'x-default': arUrl,
    }

    const arEntry: MetadataRoute.Sitemap[number] = {
      url: arUrl,
      lastModified: new Date(),
      changeFrequency: route.changeFreq,
      priority: route.path === '/' ? 1.0 : route.priority * 0.95,
      alternates: { languages },
    }

    const enEntry: MetadataRoute.Sitemap[number] = {
      url: enUrl,
      lastModified: new Date(),
      changeFrequency: route.changeFreq,
      priority: route.priority * 0.85,
      alternates: { languages },
    }

    return [arEntry, enEntry]
  })
}
