import { auth } from '@clerk/nextjs/server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  getFirstSearchParamValue,
  getRequestOrigin,
  resolveAuthRedirectTarget,
} from '@/lib/auth-redirect';
import { SignInScreen } from './sign-in-screen';

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SignInPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const requestHeaders = await headers();
  const redirectUrl = resolveAuthRedirectTarget(
    getFirstSearchParamValue(params.redirect_url),
    getRequestOrigin(requestHeaders),
  );
  const { userId } = await auth();

  if (userId) {
    redirect(redirectUrl);
  }

  return <SignInScreen redirectUrl={redirectUrl} />;
}
