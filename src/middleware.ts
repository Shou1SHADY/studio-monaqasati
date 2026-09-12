import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { allowedOrigin, corsHeaders } from './lib/cors';

const intl = createMiddleware(routing);

// Two jobs, split by path:
//
//  - /api/*  — cross-origin access for the mobile app's web build. The native
//    app calls these routes with no browser in the way; the same app exported
//    as a PWA runs on its own origin, and the browser will not hand it a
//    response from this site unless the response names that origin. The
//    preflight is answered here so route handlers never see an OPTIONS
//    request; the real response gets the same headers on the way out. Origins
//    are allow-listed in src/lib/cors.ts — an unlisted origin gets no header
//    and stays blocked, exactly as today.
//
//  - everything else — next-intl locale routing, unchanged.
export default function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    const origin = allowedOrigin(req.headers.get('origin'));
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, {
        status: 204,
        headers: origin ? corsHeaders(origin) : { Vary: 'Origin' },
      });
    }
    const res = NextResponse.next();
    if (origin) {
      for (const [key, value] of Object.entries(corsHeaders(origin))) res.headers.set(key, value);
    }
    return res;
  }
  return intl(req);
}

export const config = {
  // Internationalized pathnames, plus the API for the CORS branch above.
  matcher: ['/', '/(ar|en)/:path*', '/((?!_next|_vercel|api|.*\\..*).*)', '/api/:path*'],
};
