const DEFAULT_AUTH_REDIRECT = '/dashboard';

export function resolveAuthRedirectTarget(
  rawRedirectUrl: string | null | undefined,
  origin?: string,
) {
  if (!rawRedirectUrl) {
    return DEFAULT_AUTH_REDIRECT;
  }

  if (!origin) {
    return rawRedirectUrl.startsWith('/') ? rawRedirectUrl : DEFAULT_AUTH_REDIRECT;
  }

  try {
    const redirectUrl = new URL(rawRedirectUrl, origin);

    if (redirectUrl.origin !== origin) {
      return DEFAULT_AUTH_REDIRECT;
    }

    if (
      redirectUrl.pathname.startsWith('/sign-in') ||
      redirectUrl.pathname.startsWith('/sign-up')
    ) {
      return DEFAULT_AUTH_REDIRECT;
    }

    return `${redirectUrl.pathname}${redirectUrl.search}${redirectUrl.hash}` || DEFAULT_AUTH_REDIRECT;
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
}
