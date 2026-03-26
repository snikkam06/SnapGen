'use client';

import { useState } from 'react';
import {
    Sparkles,
    ArrowRight,
    TrendingUp,
    TrendingDown,
    Receipt,
    ExternalLink,
    Loader2,
} from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn, formatCredits, formatDate } from '@/lib/utils';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';

interface LedgerEntry {
    id: string;
    amount: number;
    entryType: string;
    reason: string;
    createdAt: string;
}

interface CreditsResponse {
    balance: number;
    recentEntries: LedgerEntry[];
}

interface MeResponse {
    plan: {
        code: string;
        name: string;
    };
    balance: number;
}

interface SessionResponse {
    url: string;
}

interface PlanOption {
    name: string;
    monthlyCode: string;
    yearlyCode: string;
    monthlyPrice: string;
    yearlyPrice: string;
    yearlyMonthlyEquiv: string;
    credits: string;
    popular: boolean;
}

const plans: PlanOption[] = [
    {
        name: 'Creator',
        monthlyCode: 'creator-monthly',
        yearlyCode: 'creator-yearly',
        monthlyPrice: '$32',
        yearlyPrice: '$150',
        yearlyMonthlyEquiv: '$12.50',
        credits: '7,200',
        popular: true,
    },
    {
        name: 'Pro',
        monthlyCode: 'pro-monthly',
        yearlyCode: 'pro-yearly',
        monthlyPrice: '$75',
        yearlyPrice: '$360',
        yearlyMonthlyEquiv: '$30',
        credits: '18,000',
        popular: false,
    },
    {
        name: 'Business',
        monthlyCode: 'business-monthly',
        yearlyCode: 'business-yearly',
        monthlyPrice: '$170',
        yearlyPrice: '$800',
        yearlyMonthlyEquiv: '$66.67',
        credits: '45,000',
        popular: false,
    },
];

export default function BillingPage() {
    const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly');
    const tokenQuery = useApiToken();
    const { getToken, isReady, userId } = tokenQuery;

    const creditsQuery = useQuery({
        queryKey: ['credits', userId],
        enabled: isReady,
        queryFn: () => api.getCredits(getToken) as Promise<CreditsResponse>,
    });

    const meQuery = useQuery({
        queryKey: ['me', userId],
        enabled: isReady,
        queryFn: () => api.getMe(getToken) as Promise<MeResponse>,
    });

    const checkoutMutation = useMutation({
        mutationFn: (planCode: string) => api.createCheckoutSession(getToken, planCode) as Promise<SessionResponse>,
        onSuccess: (data) => {
            window.location.href = data.url;
        },
        onError: (error: Error) => {
            toast.error(error.message || 'Failed to create checkout session');
        },
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

    const creditBalance = creditsQuery.data?.balance ?? 0;
    const ledgerEntries = creditsQuery.data?.recentEntries ?? [];
    const currentPlan = meQuery.data?.plan ?? { code: 'free', name: 'Free' };

    const isLoading = tokenQuery.isPending || creditsQuery.isPending || meQuery.isPending;

    return (
        <div className="space-y-8">
            <div className="page-header">
                <h1 className="page-title">Billing & Credits</h1>
                <p className="page-description">Manage your subscription and track credit usage.</p>
            </div>

            {/* Credit Balance Card */}
            <div className="glass-card p-6 bg-gradient-to-br from-purple-600/10 to-pink-600/10">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-white/50 mb-1">Available Credits</p>
                        <p className="text-5xl font-bold gradient-text">
                            {isLoading ? '...' : formatCredits(creditBalance)}
                        </p>
                        <p className="text-sm text-white/40 mt-2">
                            Plan: <span className="text-white font-medium">
                                {isLoading ? '...' : currentPlan.name}
                            </span>
                        </p>
                    </div>
                    <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                        <Sparkles className="w-10 h-10 text-white" />
                    </div>
                </div>
            </div>

            {/* Plan Options */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Upgrade Your Plan</h2>
                    <div className="flex items-center gap-1 rounded-full bg-white/5 p-1">
                        <button
                            className={cn(
                                'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
                                billingInterval === 'monthly'
                                    ? 'bg-purple-500 text-white'
                                    : 'text-white/50 hover:text-white/80',
                            )}
                            onClick={() => setBillingInterval('monthly')}
                        >
                            Monthly
                        </button>
                        <button
                            className={cn(
                                'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
                                billingInterval === 'yearly'
                                    ? 'bg-purple-500 text-white'
                                    : 'text-white/50 hover:text-white/80',
                            )}
                            onClick={() => setBillingInterval('yearly')}
                        >
                            Yearly
                        </button>
                    </div>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                    {plans.map((plan) => {
                        const planCode = billingInterval === 'yearly' ? plan.yearlyCode : plan.monthlyCode;
                        const displayPrice = billingInterval === 'yearly' ? plan.yearlyMonthlyEquiv : plan.monthlyPrice;
                        const isCurrentPlan = currentPlan.code === plan.monthlyCode || currentPlan.code === plan.yearlyCode;
                        return (
                            <div
                                key={plan.name}
                                className={cn(
                                    'glass-card p-5 flex flex-col',
                                    plan.popular && 'ring-1 ring-purple-500/50',
                                )}
                            >
                                {plan.popular && (
                                    <span className="text-xs font-semibold text-purple-400 mb-2">RECOMMENDED</span>
                                )}
                                <h3 className="text-lg font-semibold">{plan.name}</h3>
                                <p className="text-2xl font-bold mt-1">{displayPrice}<span className="text-sm font-normal text-white/40">/mo</span></p>
                                {billingInterval === 'yearly' && (
                                    <p className="text-xs text-white/40 mt-1">Billed yearly at {plan.yearlyPrice}/yr</p>
                                )}
                                <p className="text-sm text-purple-400 mt-1">{plan.credits} tokens/mo</p>
                                <button
                                    className="btn-primary mt-4 text-sm"
                                    disabled={checkoutMutation.isPending || isCurrentPlan}
                                    onClick={() => checkoutMutation.mutate(planCode)}
                                >
                                    {checkoutMutation.isPending && checkoutMutation.variables === planCode ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Redirecting...
                                        </>
                                    ) : isCurrentPlan ? (
                                        'Current Plan'
                                    ) : (
                                        <>
                                            Upgrade
                                            <ArrowRight className="w-4 h-4 ml-2" />
                                        </>
                                    )}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Credit History */}
            <div>
                <h2 className="text-xl font-semibold mb-4">Credit History</h2>
                <div className="glass-card overflow-hidden">
                    {isLoading ? (
                        <div className="p-8 text-center">
                            <Loader2 className="w-8 h-8 text-white/20 mx-auto mb-3 animate-spin" />
                            <p className="text-white/40 text-sm">Loading credit history...</p>
                        </div>
                    ) : ledgerEntries.length === 0 ? (
                        <div className="p-8 text-center">
                            <Receipt className="w-12 h-12 text-white/10 mx-auto mb-3" />
                            <p className="text-white/40 text-sm">No credit transactions yet.</p>
                        </div>
                    ) : (
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-white/5">
                                    <th className="text-left text-xs font-medium text-white/40 px-4 py-3">Type</th>
                                    <th className="text-left text-xs font-medium text-white/40 px-4 py-3">Reason</th>
                                    <th className="text-right text-xs font-medium text-white/40 px-4 py-3">Amount</th>
                                    <th className="text-right text-xs font-medium text-white/40 px-4 py-3">Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ledgerEntries.map((entry) => (
                                    <tr key={entry.id} className="border-b border-white/5 last:border-0">
                                        <td className="px-4 py-3 text-sm">
                                            <span className="flex items-center gap-2">
                                                {entry.amount >= 0 ? (
                                                    <TrendingUp className="w-4 h-4 text-green-400" />
                                                ) : (
                                                    <TrendingDown className="w-4 h-4 text-red-400" />
                                                )}
                                                <span className="capitalize">{entry.entryType}</span>
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-sm text-white/60">{entry.reason}</td>
                                        <td className={cn(
                                            'px-4 py-3 text-sm text-right font-medium',
                                            entry.amount >= 0 ? 'text-green-400' : 'text-red-400',
                                        )}>
                                            {entry.amount >= 0 ? '+' : ''}{formatCredits(entry.amount)}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-right text-white/40">
                                            {formatDate(entry.createdAt)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* Manage Subscription */}
            <div className="glass-card p-6">
                <h3 className="font-semibold mb-2">Manage Subscription</h3>
                <p className="text-sm text-white/40 mb-4">
                    Access your Stripe customer portal to update payment methods, view invoices, or cancel your subscription.
                </p>
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
                            Open Billing Portal
                        </>
                    )}
                </button>
            </div>
        </div>
    );
}
