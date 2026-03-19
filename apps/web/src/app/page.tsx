import Link from 'next/link';
import {
    Sparkles,
    Shield,
    Image as ImageIcon,
    Video,
    Layers,
    ArrowRight,
    Star,
    ChevronRight,
} from 'lucide-react';

export default function LandingPage() {
    return (
        <div className="min-h-screen bg-background">
            {/* Navigation */}
            <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-background/80 backdrop-blur-xl">
                <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-white" />
                        </div>
                        <span className="text-xl font-bold gradient-text">mysfw.ai</span>
                    </Link>
                    <div className="hidden md:flex items-center gap-8">
                        <Link href="/pricing" className="text-sm text-white/60 hover:text-white transition-colors">
                            Pricing
                        </Link>
                        <Link href="/sign-in" className="btn-ghost">
                            Sign In
                        </Link>
                        <Link href="/sign-up" className="btn-primary text-sm px-5 py-2">
                            Get Started Free
                            <ArrowRight className="w-4 h-4 ml-2" />
                        </Link>
                    </div>
                </div>
            </nav>

            {/* Hero Section */}
            <section className="relative pt-32 pb-20 px-6 overflow-hidden">
                {/* Background effects */}
                <div className="absolute inset-0 -z-10">
                    <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/20 rounded-full blur-[128px]" />
                    <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-pink-600/20 rounded-full blur-[128px]" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-purple-900/10 rounded-full blur-[200px]" />
                </div>

                <div className="max-w-5xl mx-auto text-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/10 border border-purple-500/20 mb-8 animate-fade-in">
                        <Sparkles className="w-4 h-4 text-purple-400" />
                        <span className="text-sm text-purple-300">Now with FLUX & SDXL support</span>
                    </div>

                    <h1 className="text-5xl md:text-7xl font-black tracking-tight mb-6 animate-slide-up">
                        <span className="gradient-text">Create Stunning</span>
                        <br />
                        <span className="text-white">AI-Generated Content</span>
                    </h1>

                    <p className="text-lg md:text-xl text-white/50 max-w-2xl mx-auto mb-10 animate-slide-up" style={{ animationDelay: '0.1s' }}>
                        Train custom AI models on your characters, generate photorealistic images and videos,
                        and build your content portfolio — all with a few clicks.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-slide-up" style={{ animationDelay: '0.2s' }}>
                        <Link href="/sign-up" className="btn-primary text-lg px-8 py-4 animate-pulse-glow">
                            Start Creating Free
                            <ArrowRight className="w-5 h-5 ml-2" />
                        </Link>
                        <Link href="/pricing" className="btn-secondary text-lg px-8 py-4">
                            View Pricing
                        </Link>
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-8 max-w-lg mx-auto mt-16 animate-fade-in" style={{ animationDelay: '0.4s' }}>
                        {[
                            { value: '500K+', label: 'Images Generated' },
                            { value: '10K+', label: 'Active Users' },
                            { value: '99.9%', label: 'Uptime' },
                        ].map((stat) => (
                            <div key={stat.label} className="text-center">
                                <div className="text-2xl font-bold gradient-text">{stat.value}</div>
                                <div className="text-xs text-white/40 mt-1">{stat.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Features Section */}
            <section className="py-24 px-6 border-t border-white/5">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">
                            Everything You Need to
                            <span className="gradient-text"> Create</span>
                        </h2>
                        <p className="text-white/50 max-w-lg mx-auto">
                            A complete platform for AI-powered content creation, from model training to final export.
                        </p>
                    </div>

                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {[
                            {
                                icon: Sparkles,
                                title: 'Custom Character Training',
                                description: 'Upload photos and train LoRA models for your unique characters. Create AI versions of anyone with photorealistic accuracy.',
                                gradient: 'from-purple-500 to-violet-500',
                            },
                            {
                                icon: ImageIcon,
                                title: 'Image Generation',
                                description: 'Generate unlimited high-quality images with your trained characters. Multiple style packs, aspect ratios, and fine-tuned control.',
                                gradient: 'from-pink-500 to-rose-500',
                            },
                            {
                                icon: Video,
                                title: 'Video Generation',
                                description: 'Bring your characters to life with AI-generated videos. Create dynamic content in just a few seconds.',
                                gradient: 'from-blue-500 to-cyan-500',
                            },
                            {
                                icon: Layers,
                                title: 'Face Swap',
                                description: 'Seamlessly swap faces in images and videos. Perfect for creating variations and custom scenarios.',
                                gradient: 'from-orange-500 to-amber-500',
                            },
                            {
                                icon: Shield,
                                title: 'Private & Secure',
                                description: 'All your content is stored securely with signed URLs. Full control over your creations with private galleries.',
                                gradient: 'from-indigo-500 to-purple-500',
                            },
                        ].map((feature) => (
                            <div
                                key={feature.title}
                                className="glass-card-hover p-6 group cursor-pointer"
                            >
                                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300`}>
                                    <feature.icon className="w-6 h-6 text-white" />
                                </div>
                                <h3 className="text-lg font-semibold mb-2 text-white">{feature.title}</h3>
                                <p className="text-sm text-white/50 leading-relaxed">{feature.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* How It Works */}
            <section className="py-24 px-6 border-t border-white/5 bg-white/[0.02]">
                <div className="max-w-4xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-3xl md:text-4xl font-bold mb-4">
                            How It <span className="gradient-text">Works</span>
                        </h2>
                    </div>

                    <div className="space-y-12">
                        {[
                            {
                                step: '01',
                                title: 'Create Your Character',
                                description: 'Upload 10-20 high-quality photos of your subject. Our AI will learn their unique features.',
                            },
                            {
                                step: '02',
                                title: 'Train Your Model',
                                description: 'Our AI trains a custom LoRA model in minutes. This captures the essence of your character.',
                            },
                            {
                                step: '03',
                                title: 'Generate Content',
                                description: 'Use your trained model to generate unlimited images and videos in any style or scenario.',
                            },
                            {
                                step: '04',
                                title: 'Export & Share',
                                description: 'Download your creations in high resolution. Build your portfolio and share with the world.',
                            },
                        ].map((item, index) => (
                            <div key={item.step} className="flex gap-6 items-start group">
                                <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-xl font-bold group-hover:scale-110 transition-transform duration-300">
                                    {item.step}
                                </div>
                                <div>
                                    <h3 className="text-xl font-semibold mb-2">{item.title}</h3>
                                    <p className="text-white/50">{item.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA Section */}
            <section className="py-24 px-6 border-t border-white/5">
                <div className="max-w-3xl mx-auto text-center">
                    <h2 className="text-3xl md:text-5xl font-bold mb-6">
                        Ready to <span className="gradient-text">Get Started?</span>
                    </h2>
                    <p className="text-lg text-white/50 mb-10">
                        Join thousands of creators already using mysfw.ai to build stunning AI content.
                        Start free, upgrade when you need more power.
                    </p>
                    <Link href="/sign-up" className="btn-primary text-lg px-10 py-4 animate-pulse-glow">
                        Create Your First Character
                        <ChevronRight className="w-5 h-5 ml-2" />
                    </Link>
                </div>
            </section>

            {/* Footer */}
            <footer className="border-t border-white/5 py-12 px-6">
                <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                            <Sparkles className="w-3 h-3 text-white" />
                        </div>
                        <span className="font-semibold gradient-text">mysfw.ai</span>
                    </div>
                    <div className="flex items-center gap-6 text-sm text-white/40">
                        <Link href="/terms" className="hover:text-white transition-colors">Terms</Link>
                        <Link href="/privacy" className="hover:text-white transition-colors">Privacy</Link>
                        <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
                    </div>
                    <div className="text-sm text-white/30">
                        © {new Date().getFullYear()} mysfw.ai. All rights reserved.
                    </div>
                </div>
            </footer>
        </div>
    );
}
