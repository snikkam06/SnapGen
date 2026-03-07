'use client';

import { UserProfile } from '@clerk/nextjs';

export default function SettingsPage() {
    return (
        <div className="space-y-8">
            <div className="page-header">
                <h1 className="page-title">Account Settings</h1>
                <p className="page-description">Manage your account, linked providers, and preferences.</p>
            </div>

            <div className="glass-card p-6 overflow-hidden">
                <UserProfile
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
