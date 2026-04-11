'use client';

import { UserProfile } from '@clerk/nextjs';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
    Crown,
    ArrowRight,
    ExternalLink,
    Loader2,
    Calendar,
    AlertTriangle,
} from 'lucide-react';
import { cn, formatDate } from '@/lib/utils';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import Link from 'next/link';

interface MeResponse {
    plan: {
        code: string;
        name: string;
    };
    balance: number;
    subscription: {
        status: string;
        currentPeriodEnd: string | null;
        cancelAtPeriodEnd: boolean;
    } | null;
}

interface SessionResponse {
    url: string;
}

export default function SettingsPage() {
    const tokenQuery = useApiToken();
    const { getToken, isReady, userId } = tokenQuery;

    const meQuery = useQuery({
        queryKey: ['me', userId],
        enabled: isReady,
        queryFn: () => api.getMe(getToken) as Promise<MeResponse>,
    });

    const portalMutation = useMutation({
        mutationFn: () => api.createPortalSession(getToken) as Promise<SessionResponse>,
        onSuccess: (data) => {
            window.location.href = data.url;
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to open billing portal');
        },
    });

    const currentPlan = meQuery.data?.plan ?? { code: 'free', name: 'Free' };
    const subscription = meQuery.data?.subscription;
    const isFreePlan = currentPlan.code === 'free';
    const isYearly = currentPlan.code.endsWith('-yearly');
    const isActive = subscription?.status === 'active';
    const isCanceling = subscription?.cancelAtPeriodEnd === true;

    return (
        <div className="space-y-8">
            <div className="page-header">
                <h1 className="page-title">Account Settings</h1>
                <p className="page-description">Manage your account, membership, and preferences.</p>
            </div>

            {/* Membership Section */}
            <div className="glass-card p-6">
                <div className="flex items-center gap-2 mb-4">
                    <Crown className="w-5 h-5 text-purple-400" />
                    <h2 className="text-lg font-semibold">Membership</h2>
                </div>

                {meQuery.isPending ? (
                    <div className="flex items-center gap-2 text-white/40">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading membership info...
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Current Plan */}
                        <div className="flex items-center justify-between p-4 rounded-lg bg-white/5">
                            <div>
                                <p className="text-sm text-white/50">Current Plan</p>
                                <p className="text-xl font-bold">
                                    {currentPlan.name}
                                    {!isFreePlan && (
                                        <span className="text-sm font-normal text-white/40 ml-2">
                                            {isYearly ? 'Yearly' : 'Monthly'}
                                        </span>
                                    )}
                                </p>
                            </div>
                            <div className={cn(
                                'px-3 py-1 rounded-full text-xs font-semibold',
                                isFreePlan ? 'bg-white/10 text-white/60' :
                                isCanceling ? 'bg-yellow-500/20 text-yellow-400' :
                                isActive ? 'bg-green-500/20 text-green-400' :
                                'bg-red-500/20 text-red-400',
                            )}>
                                {isFreePlan ? 'Free' :
                                 isCanceling ? 'Canceling' :
                                 isActive ? 'Active' : subscription?.status || 'Inactive'}
                            </div>
                        </div>

                        {/* Renewal / Cancellation Info */}
                        {!isFreePlan && subscription?.currentPeriodEnd && (
                            <div className={cn(
                                'flex items-center gap-2 p-3 rounded-lg text-sm',
                                isCanceling ? 'bg-yellow-500/10 text-yellow-400' : 'bg-white/5 text-white/50',
                            )}>
                                {isCanceling ? (
                                    <>
                                        <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                                        Your plan will be downgraded to Free on {formatDate(subscription.currentPeriodEnd)}
                                    </>
                                ) : (
                                    <>
                                        <Calendar className="w-4 h-4 flex-shrink-0" />
                                        Next renewal: {formatDate(subscription.currentPeriodEnd)}
                                    </>
                                )}
                            </div>
                        )}

                        {/* Actions */}
                        <div className="flex flex-wrap gap-3 pt-2">
                            {isFreePlan ? (
                                <Link href="/dashboard/billing" className="btn-primary text-sm">
                                    Upgrade Plan
                                    <ArrowRight className="w-4 h-4 ml-2" />
                                </Link>
                            ) : (
                                <>
                                    <Link href="/dashboard/billing" className="btn-primary text-sm">
                                        Change Plan
                                        <ArrowRight className="w-4 h-4 ml-2" />
                                    </Link>
                                    <button
                                        className="btn-secondary text-sm"
                                        disabled={portalMutation.isPending}
                                        onClick={() => portalMutation.mutate()}
                                    >
                                        {portalMutation.isPending ? (
                                            <>
                                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                Redirecting...
                                            </>
                                        ) : (
                                            <>
                                                <ExternalLink className="w-4 h-4 mr-2" />
                                                Manage Subscription
                                            </>
                                        )}
                                    </button>
                                </>
                            )}
                        </div>
                        {!isFreePlan && (
                            <p className="text-xs text-white/30">
                                Update payment method, view invoices, or cancel your subscription through the Stripe billing portal.
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* Clerk Account Settings */}
            <div className="glass-card p-6 overflow-hidden">
                <h2 className="text-lg font-semibold mb-4">Account</h2>
                <UserProfile
                    path="/dashboard/settings"
                    appearance={{
                        elements: {
                            rootBox: 'w-full',
                            card: 'bg-transparent shadow-none border-none w-full max-w-full',
                            navbar: 'hidden',
                            pageScrollBox: 'p-0',
                        },
                    }}
                />
            </div>
        </div>
    );
}
