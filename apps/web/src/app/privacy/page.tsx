import Link from 'next/link';
import { Sparkles } from 'lucide-react';

const sections = [
  {
    title: 'Information We Collect',
    body: 'mysfw.ai stores account details, uploaded training assets, prompts, generated media, billing events, and operational logs needed to run the service, prevent abuse, and support your workspace.',
  },
  {
    title: 'How We Use Data',
    body: 'We use your data to authenticate users, process payments, generate media, improve reliability, and respond to support requests. We do not sell your personal information.',
  },
  {
    title: 'Storage and Sharing',
    body: 'Generated outputs and uploads may be processed by trusted infrastructure providers involved in storage, billing, and model execution. Access is limited to delivering the service and meeting legal obligations.',
  },
  {
    title: 'Your Controls',
    body: 'You can update your profile, remove assets, and request account deletion. Some billing, fraud-prevention, and audit records may be retained when legally required or operationally necessary.',
  },
];

export default function PrivacyPage() {
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
          <p className="mb-3 text-sm uppercase tracking-[0.24em] text-purple-300">Privacy Policy</p>
          <h1 className="mb-4 text-4xl font-bold md:text-5xl">How mysfw.ai handles your data</h1>
          <p className="max-w-2xl text-white/50">
            This page summarizes the information mysfw.ai collects, why it is used, and the controls
            available to account owners.
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
