import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isProtectedRoute = createRouteMatcher(['/dashboard(.*)']);
const isMaintenancePage = createRouteMatcher(['/maintenance']);

export default clerkMiddleware(async (auth, request) => {
  // Redirect all traffic to the maintenance page when MAINTENANCE_MODE is enabled.
  // To take the site down: set MAINTENANCE_MODE=true and redeploy (or restart).
  // To bring it back up: remove the variable (or set it to anything other than "true").
  if (process.env.MAINTENANCE_MODE === 'true' && !isMaintenancePage(request)) {
    return NextResponse.redirect(new URL('/maintenance', request.url));
  }

  if (isProtectedRoute(request)) {
    const { userId } = await auth();

    if (!userId) {
      const signInUrl = new URL('/sign-in', request.url);
      signInUrl.searchParams.set('redirect_url', request.url);
      return NextResponse.redirect(signInUrl);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
