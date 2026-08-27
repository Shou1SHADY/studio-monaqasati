import type {NextConfig} from 'next';

import createNextIntlPlugin from 'next-intl/plugin';
 
const withNextIntl = createNextIntlPlugin(
  './src/i18n/request.ts'
);

/**
 * Firebase App Hosting injects FIREBASE_WEBAPP_CONFIG (the bound web app's SDK
 * config, as JSON) into every build. Mapping it onto the NEXT_PUBLIC_* variables
 * here means a backend always talks to the project it lives in — no per-backend
 * environment naming to forget, and no way for the UAT backend to build against
 * production. Explicitly set NEXT_PUBLIC_* values still win.
 */
function firebaseEnvFromAppHosting(): Record<string, string> {
  const raw = process.env.FIREBASE_WEBAPP_CONFIG
  if (!raw) return {}
  try {
    const cfg = JSON.parse(raw) as Record<string, string | undefined>
    const map: Record<string, string | undefined> = {
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: cfg.projectId,
      NEXT_PUBLIC_FIREBASE_APP_ID: cfg.appId,
      NEXT_PUBLIC_FIREBASE_API_KEY: cfg.apiKey,
      NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: cfg.authDomain,
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: cfg.storageBucket,
      NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: cfg.messagingSenderId,
      NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: cfg.measurementId,
      // The UAT project identifies itself; nothing else has to.
      NEXT_PUBLIC_APP_ENV: cfg.projectId === 'mdmaktech-uat' ? 'uat' : undefined,
    }
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(map)) {
      if (process.env[key]) out[key] = process.env[key] as string
      else if (value) out[key] = value
    }
    return out
  } catch {
    return {}
  }
}

/** @type {import('next').NextConfig} */
const nextConfig: NextConfig = {
  env: firebaseEnvFromAppHosting(),
  trailingSlash: false,
  serverExternalPackages: [
    'genkit',
    '@genkit-ai/core',
    '@genkit-ai/google-genai',
    'genkit-cli',
    '@opentelemetry/sdk-node',
    '@opentelemetry/exporter-jaeger',
    'firebase-admin',
    'jwks-rsa',
    'jose',
  ],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'framer-motion',
      '@radix-ui/react-accordion',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-label',
      '@radix-ui/react-select',
      '@radix-ui/react-tabs',
      '@radix-ui/react-toast',
      '@radix-ui/react-tooltip',
    ],
  },
  images: {
    qualities: [50, 75, 90],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default withNextIntl(nextConfig);
