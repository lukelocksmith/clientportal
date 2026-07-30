import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Middleware runs on Edge — we only do lightweight cookie check here.
// Full DB session validation happens in each route/layout.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Extract slug from path like /wdf or /wdf/chat
  const slugMatch = pathname.match(/^\/([a-z0-9-]+)(\/.*)?$/)
  if (!slugMatch) return NextResponse.next()

  const slug = slugMatch[1]
  const subpath = slugMatch[2] ?? ''

  // Skip auth for login page, API routes and admin panel
  if (subpath === '/login' || pathname.startsWith('/api/') || slug === 'admin') {
    return NextResponse.next()
  }

  // Check session cookie exists (full validation in layout).
  // The admin cookie counts too: an admin browsing any portal has no
  // portal_session, and getSession(slug) resolves the admin bypass. Without
  // this the bypass is unreachable from a browser — the edge bounced the
  // admin to the login page before any page code ran.
  // Presence is all we check here (no DB, no crypto on Edge); admin_session
  // is HMAC-verified downstream in getAdminSession().
  const sessionCookie = request.cookies.get('portal_session')
  const adminCookie = request.cookies.get('admin_session')
  if (!sessionCookie?.value && !adminCookie?.value) {
    const loginUrl = new URL(`/${slug}/login`, request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public).*)',
  ],
}
