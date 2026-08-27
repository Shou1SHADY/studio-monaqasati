import { MetadataRoute } from 'next'

import { SITE_URL } from '@/lib/app-env'

const BASE_URL = SITE_URL

const publicRoutes: Array<{ path: string; lastModified: string }> = [
  { path: '/',        lastModified: '2026-06-17' },
  { path: '/about',   lastModified: '2026-06-17' },
  { path: '/pricing', lastModified: '2026-06-17' },
  { path: '/contact', lastModified: '2026-01-01' },
  { path: '/terms',   lastModified: '2026-01-01' },
  { path: '/privacy', lastModified: '2026-01-01' },
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
      lastModified: new Date(route.lastModified),
      alternates: { languages },
    }

    const enEntry: MetadataRoute.Sitemap[number] = {
      url: enUrl,
      lastModified: new Date(route.lastModified),
      alternates: { languages },
    }

    return [arEntry, enEntry]
  })
}
