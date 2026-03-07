import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
    '/',
    '/pricing',
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/forgot-password(.*)',
    '/terms',
    '/privacy',
    '/api/webhooks(.*)',
]);

export default clerkMiddleware(async (auth, request) => {
    if (!isPublicRoute(request)) {
        const { userId } = await auth();
        if (!userId) {
            const signInUrl = new URL('/sign-in', request.url);
            signInUrl.searchParams.set('redirect_url', request.url);
            return NextResponse.redirect(signInUrl);
        }
    }
});

export const config = {
    matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
