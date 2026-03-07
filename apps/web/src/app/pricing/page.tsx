import Link from 'next/link';
import { Sparkles, Check, ArrowRight } from 'lucide-react';
import { PLAN_CODES } from '@snapgen/config';

const plans = [
    {
        code: PLAN_CODES.FREE,
        name: 'Free',
        price: '$0',
        period: '/mo',
        credits: '50 credits/mo',
        popular: false,
        features: [
            '1 character',
            '2 images per generation',
            'Basic style packs',
            'Standard queue',
        ],
    },
    {
        code: PLAN_CODES.CREATOR,
        name: 'Creator',
        price: '$19.99',
        period: '/mo',
        credits: '500 credits/mo',
        popular: true,
        features: [
            '5 characters',
            '4 images per generation',
            'All style packs',
            'Video generation',
            'Face swap',
            'Image upscaling',
        ],
    },
    {
        code: PLAN_CODES.PRO,
        name: 'Pro',
        price: '$49.99',
        period: '/mo',
        credits: '2,000 credits/mo',
        popular: false,
        features: [
            '20 characters',
            '8 images per generation',
            'All style packs',
            'Video generation',
            'Face swap',
            'Image upscaling',
            'Priority queue',
        ],
    },
    {
        code: PLAN_CODES.BUSINESS,
        name: 'Business',
        price: '$149.99',
        period: '/mo',
        credits: '10,000 credits/mo',
        popular: false,
        features: [
            'Unlimited characters',
            '16 images per generation',
            'All style packs',
            'Video generation',
            'Face swap',
            'Image upscaling',
            'Priority queue',
            'API access',
            'White-label options',
        ],
    },
];

export default function PricingPage() {
    return (
        <div className="min-h-screen bg-background">
            {/* Nav */}
            <nav className="border-b border-white/5 bg-background/80 backdrop-blur-xl">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-white" />
                        </div>
                        <span className="text-xl font-bold gradient-text">SnapGen</span>
                    </Link>
                    <Link href="/sign-up" className="btn-primary text-sm px-5 py-2">
                        Get Started
                    </Link>
                </div>
            </nav>

            <div className="max-w-6xl mx-auto px-6 py-20">
                <div className="text-center mb-16">
                    <h1 className="text-4xl md:text-5xl font-bold mb-4">
                        Simple, <span className="gradient-text">Transparent</span> Pricing
                    </h1>
                    <p className="text-lg text-white/50 max-w-lg mx-auto">
                        Start free and scale as you grow. No hidden fees, cancel anytime.
                    </p>
                </div>

                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {plans.map((plan) => (
                        <div
                            key={plan.code}
                            className={`relative rounded-2xl p-6 flex flex-col ${plan.popular
                                    ? 'gradient-border bg-card shadow-xl shadow-purple-500/10'
                                    : 'glass-card'
                                }`}
                        >
                            {plan.popular && (
                                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 text-xs font-semibold">
                                    Most Popular
                                </div>
                            )}

                            <div className="mb-6">
                                <h3 className="text-lg font-semibold mb-2">{plan.name}</h3>
                                <div className="flex items-baseline gap-1">
                                    <span className="text-4xl font-bold">{plan.price}</span>
                                    <span className="text-white/40">{plan.period}</span>
                                </div>
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
                    ))}
                </div>
            </div>
        </div>
    );
}
