import Link from 'next/link';
import { Sparkles } from 'lucide-react';

const sections = [
  {
    title: 'Using mysfw.ai',
    body: 'You are responsible for the prompts, uploads, and outputs you create in mysfw.ai. Do not upload content you do not have the right to use, and do not use the service to generate unlawful, deceptive, or abusive material.',
  },
  {
    title: 'Accounts and Billing',
    body: 'Paid plans renew automatically until canceled. Credits and subscription limits reset according to your active plan. We may suspend access for fraud, abuse, chargebacks, or violations of these terms.',
  },
  {
    title: 'Generated Content',
    body: 'You retain rights to original materials you upload and may use generated outputs subject to applicable law, third-party rights, and any model or provider restrictions attached to the underlying generation service.',
  },
  {
    title: 'Service Availability',
    body: 'AI generation relies on third-party infrastructure and may occasionally be delayed, rate-limited, or unavailable. We may update features, providers, and pricing as the platform evolves.',
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b border-white/5 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 to-pink-500">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold gradient-text">mysfw.ai</span>
          </Link>
          <Link href="/pricing" className="btn-ghost">
            Pricing
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-4xl px-6 py-20">
        <div className="mb-12">
          <p className="mb-3 text-sm uppercase tracking-[0.24em] text-purple-300">
            Terms of Service
          </p>
          <h1 className="mb-4 text-4xl font-bold md:text-5xl">Terms for using mysfw.ai</h1>
          <p className="max-w-2xl text-white/50">
            These terms describe the basic rules for accessing the platform, buying credits, and
            using generated outputs responsibly.
          </p>
        </div>

        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.title} className="glass-card p-6">
              <h2 className="mb-3 text-xl font-semibold">{section.title}</h2>
              <p className="leading-7 text-white/60">{section.body}</p>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
