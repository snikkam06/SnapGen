'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { RedirectToSignIn, SignOutButton, SignedIn, SignedOut, UserButton } from '@clerk/nextjs';
import { useQuery } from '@tanstack/react-query';
import {
  Sparkles,
  LayoutDashboard,
  Users,
  Layers,
  FolderOpen,
  CreditCard,
  Settings,
  Shield,
  ChevronLeft,
  ChevronRight,
  Wand2,

  LogOut,
  Menu,
  Video,
} from 'lucide-react';
import { useState } from 'react';
import { AuthSync } from '@/components/auth-sync';
import { Providers } from '@/components/providers';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import { formatCredits } from '@/lib/utils';
import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Characters', href: '/dashboard/characters', icon: Users },
  { name: 'Generate', href: '/dashboard/generate', icon: Wand2 },
  { name: 'Video', href: '/dashboard/video', icon: Video },
  { name: 'Gallery', href: '/dashboard/gallery', icon: FolderOpen },
  { name: 'Face Swap', href: '/dashboard/faceswap', icon: Layers },

  { name: 'Jobs', href: '/dashboard/jobs', icon: Sparkles },
  { name: 'Billing', href: '/dashboard/billing', icon: CreditCard },
  { name: 'Settings', href: '/dashboard/settings', icon: Settings },
];

const adminNavigation = [{ name: 'Admin', href: '/dashboard/admin', icon: Shield }];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SignedOut>
        <div className="flex min-h-screen items-center justify-center bg-background px-6">
          <div className="glass-card max-w-md p-8 text-center">
            <h1 className="text-2xl font-bold">Redirecting to sign in</h1>
            <p className="mt-3 text-sm text-white/50">
              You need an account to access the SnapGen dashboard.
            </p>
          </div>
          <RedirectToSignIn />
        </div>
      </SignedOut>
      <SignedIn>
        <Providers>
          <AuthSync />
          <DashboardShell>{children}</DashboardShell>
        </Providers>
      </SignedIn>
    </>
  );
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const tokenQuery = useApiToken();
  const creditsQuery = useQuery({
    queryKey: ['credits', tokenQuery.data],
    enabled: !!tokenQuery.data,
    queryFn: () => api.getCredits(tokenQuery.data as string) as Promise<{ balance: number }>,
  });

  return (
    <div className="min-h-screen bg-background flex">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-white/5 bg-card/50 backdrop-blur-xl transition-all duration-300',
          collapsed ? 'w-[68px]' : 'w-64',
          'max-lg:w-64',
          mobileOpen ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-4 border-b border-white/5">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            {!collapsed && <span className="text-lg font-bold gradient-text">SnapGen</span>}
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-gradient-to-r from-purple-600/20 to-pink-600/20 text-white border-l-2 border-purple-500'
                    : 'text-white/50 hover:text-white hover:bg-white/5',
                  collapsed && 'justify-center px-2',
                )}
                title={collapsed ? item.name : undefined}
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {!collapsed && <span>{item.name}</span>}
              </Link>
            );
          })}

          {process.env.NEXT_PUBLIC_SHOW_ADMIN === 'true' && (
            <div className="pt-4 mt-4 border-t border-white/5">
              {adminNavigation.map((item) => {
                const isActive = item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                      isActive
                        ? 'bg-gradient-to-r from-purple-600/20 to-pink-600/20 text-white'
                        : 'text-white/50 hover:text-white hover:bg-white/5',
                      collapsed && 'justify-center px-2',
                    )}
                    title={collapsed ? item.name : undefined}
                  >
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    {!collapsed && <span>{item.name}</span>}
                  </Link>
                );
              })}
            </div>
          )}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="h-12 flex items-center justify-center border-t border-white/5 text-white/40 hover:text-white hover:bg-white/5 transition-colors"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </aside>

      {/* Main content */}
      <main className={cn('flex-1 transition-all duration-300', collapsed ? 'lg:ml-[68px]' : 'lg:ml-64')}>
        {/* Top bar */}
        <header className="h-16 border-b border-white/5 flex items-center justify-between px-6 bg-background/80 backdrop-blur-xl sticky top-0 z-40">
          <button
            onClick={() => setMobileOpen(true)}
            className="lg:hidden p-2 -ml-2 text-white/60 hover:text-white"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-4 ml-auto">
            <div className="glass-card px-4 py-1.5 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-medium">
                {creditsQuery.isPending ? (
                  <span className="inline-block w-14 h-4 bg-white/10 rounded animate-pulse" />
                ) : (
                  `${formatCredits(creditsQuery.data?.balance || 0)} credits`
                )}
              </span>
            </div>
            <SignOutButton>
              <button className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10 hover:text-white">
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </SignOutButton>
            <UserButton
              appearance={{
                elements: {
                  avatarBox: 'w-8 h-8',
                },
              }}
            />
          </div>
        </header>

        {/* Page content */}
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
