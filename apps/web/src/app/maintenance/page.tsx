import { Sparkles } from 'lucide-react';

export default function MaintenancePage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Sparkles className="w-9 h-9 text-white" />
          </div>
        </div>

        <h1 className="text-3xl font-bold text-white mb-3">Down for Maintenance</h1>
        <p className="text-white/60 text-lg mb-8">
          We&apos;re making some improvements. Check back soon.
        </p>

        <p className="text-white/30 text-sm">mysfw.ai</p>
      </div>
    </div>
  );
}
