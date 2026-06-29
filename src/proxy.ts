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

  // Check session cookie exists (full validation in layout)
  const sessionCookie = request.cookies.get('portal_session')
  if (!sessionCookie?.value) {
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
