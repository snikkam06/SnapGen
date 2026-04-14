'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Sparkles, Check, ArrowRight } from 'lucide-react';
import { PLAN_CODES } from '@snapgen/config';
import { cn } from '@/lib/utils';

const freePlan = {
    code: PLAN_CODES.FREE,
    name: 'Free',
    price: '$0',
    credits: '50 credits/mo',
    features: [
        '1 character',
        '2 images per generation',
        'Basic style packs',
        'Standard queue',
    ],
};

interface PaidPlan {
    code: string;
    name: string;
    monthlyPrice: string;
    yearlyPrice: string;
    yearlyMonthlyEquiv: string;
    credits: string;
    popular: boolean;
    features: string[];
}

const paidPlans: PaidPlan[] = [
    {
        code: PLAN_CODES.BASIC,
        name: 'Basic',
        monthlyPrice: '$17',
        yearlyPrice: '$120',
        yearlyMonthlyEquiv: '$10.00',
        credits: '2,000 credits/mo',
        popular: false,
        features: [
            '2 characters',
            '3 images per generation',
            'All style packs',
            'Standard queue',
        ],
    },
    {
        code: PLAN_CODES.CREATOR,
        name: 'Creator',
        monthlyPrice: '$32',
        yearlyPrice: '$180',
        yearlyMonthlyEquiv: '$15.00',
        credits: '7,200 credits/mo',
        popular: true,
        features: [
            '5 characters',
            '4 images per generation',
            'All style packs',
            'Video generation',
            'Face swap',
        ],
    },
    {
        code: PLAN_CODES.PRO,
        name: 'Pro',
        monthlyPrice: '$75',
        yearlyPrice: '$360',
        yearlyMonthlyEquiv: '$30.00',
        credits: '18,000 credits/mo',
        popular: false,
        features: [
            '20 characters',
            '8 images per generation',
            'All style packs',
            'Video generation',
            'Face swap',
            'Priority queue',
        ],
    },
    {
        code: PLAN_CODES.BUSINESS,
        name: 'Business',
        monthlyPrice: '$170',
        yearlyPrice: '$800',
        yearlyMonthlyEquiv: '$66.67',
        credits: '45,000 credits/mo',
        popular: false,
        features: [
            'Unlimited characters',
            '16 images per generation',
            'All style packs',
            'Video generation',
            'Face swap',
            'Priority queue',
            'API access',
            'White-label options',
        ],
    },
];

export default function PricingPage() {
    const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly');

    return (
        <div className="min-h-screen bg-background">
            {/* Nav */}
            <nav className="border-b border-white/5 bg-background/80 backdrop-blur-xl">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-white" />
                        </div>
                        <span className="text-xl font-bold gradient-text">mysfw.ai</span>
                    </Link>
                    <Link href="/sign-up" className="btn-primary text-sm px-5 py-2">
                        Get Started
                    </Link>
                </div>
            </nav>

            <div className="max-w-7xl mx-auto px-6 py-20">
                <div className="text-center mb-10">
                    <h1 className="text-4xl md:text-5xl font-bold mb-4">
                        Simple, <span className="gradient-text">Transparent</span> Pricing
                    </h1>
                    <p className="text-lg text-white/50 max-w-lg mx-auto">
                        Start free and scale as you grow. No hidden fees, cancel anytime.
                    </p>
                </div>

                <div className="flex justify-center mb-10">
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

                <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-4">
                    <div className="relative rounded-2xl p-6 flex flex-col glass-card">
                        <div className="mb-6">
                            <h3 className="text-lg font-semibold mb-2">{freePlan.name}</h3>
                            <div className="flex items-baseline gap-1">
                                <span className="text-4xl font-bold">{freePlan.price}</span>
                                <span className="text-white/40">/mo</span>
                            </div>
                            <div className="text-sm text-purple-400 mt-2">{freePlan.credits}</div>
                        </div>
                        <ul className="space-y-3 mb-8 flex-1">
                            {freePlan.features.map((feature) => (
                                <li key={feature} className="flex items-center gap-2 text-sm text-white/70">
                                    <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                                    {feature}
                                </li>
                            ))}
                        </ul>
                        <Link href="/sign-up" className="btn-secondary w-full">
                            Get Started
                            <ArrowRight className="w-4 h-4 ml-2" />
                        </Link>
                    </div>

                    {paidPlans.map((plan) => {
                        const displayPrice = billingInterval === 'yearly' ? plan.yearlyMonthlyEquiv : plan.monthlyPrice;
                        return (
                            <div
                                key={plan.code}
                                className={cn(
                                    'relative rounded-2xl p-6 flex flex-col',
                                    plan.popular
                                        ? 'gradient-border bg-card shadow-xl shadow-purple-500/10'
                                        : 'glass-card',
                                )}
                            >
                                {plan.popular && (
                                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-xs font-semibold">
                                        Most Popular
                                    </div>
                                )}

                                <div className="mb-6">
                                    <h3 className="text-lg font-semibold mb-2">{plan.name}</h3>
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-4xl font-bold">{displayPrice}</span>
                                        <span className="text-white/40">/mo</span>
                                    </div>
                                    {billingInterval === 'yearly' && (
                                        <div className="text-xs text-white/40 mt-1">Billed yearly at {plan.yearlyPrice}/yr</div>
                                    )}
                                    <div className="text-sm text-purple-400 mt-2">{plan.credits}</div>
                                </div>

                                <ul className="space-y-3 mb-8 flex-1">
                                    {plan.features.map((feature) => (
                                        <li key={feature} className="flex items-center gap-2 text-sm text-white/70">
                                            <Check className="w-4 h-4 text-green-400 flex-shrink-0" />
                                            {feature}
                                        </li>
                                    ))}
                                </ul>

                                <Link
                                    href="/sign-up"
                                    className={plan.popular ? 'btn-primary w-full' : 'btn-secondary w-full'}
                                >
                                    Get Started
                                    <ArrowRight className="w-4 h-4 ml-2" />
                                </Link>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}
