'use client';

import { useState } from 'react';
import {
    Shield,
    Search,
    Users,
    CreditCard,
    Sparkles,
    AlertTriangle,
    RefreshCw,
    Eye,
    Ban,
    Plus,
    Minus,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type AdminTab = 'users' | 'jobs' | 'credits' | 'moderation';

export default function AdminPage() {
    const [activeTab, setActiveTab] = useState<AdminTab>('users');
    const [searchQuery, setSearchQuery] = useState('');

    const tabs = [
        { id: 'users' as AdminTab, name: 'Users', icon: Users },
        { id: 'jobs' as AdminTab, name: 'Jobs', icon: Sparkles },
        { id: 'credits' as AdminTab, name: 'Credits', icon: CreditCard },
        { id: 'moderation' as AdminTab, name: 'Moderation', icon: AlertTriangle },
    ];

    return (
        <div className="space-y-6">
            <div className="page-header">
                <div className="flex items-center gap-3">
                    <Shield className="w-8 h-8 text-red-400" />
                    <div>
                        <h1 className="page-title">Admin Panel</h1>
                        <p className="page-description">Manage users, jobs, credits, and moderation.</p>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex items-center gap-1 glass-card p-1 w-fit">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        className={cn(
                            'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                            activeTab === tab.id
                                ? 'bg-purple-600 text-white'
                                : 'text-white/50 hover:text-white hover:bg-white/5',
                        )}
                    >
                        <tab.icon className="w-4 h-4" />
                        {tab.name}
                    </button>
                ))}
            </div>

            {/* Search */}
            <div className="relative max-w-md">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                    type="text"
                    placeholder={`Search ${activeTab}...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="input-field pl-11"
                />
            </div>

            {/* Content Areas */}
            {activeTab === 'users' && (
                <div className="glass-card p-8 text-center">
                    <Users className="w-12 h-12 text-white/10 mx-auto mb-3" />
                    <p className="text-white/40 text-sm">User management will display here.</p>
                    <p className="text-xs text-white/30 mt-1">Search, view profiles, suspend accounts, adjust roles.</p>
                </div>
            )}

            {activeTab === 'jobs' && (
                <div className="glass-card p-8 text-center">
                    <Sparkles className="w-12 h-12 text-white/10 mx-auto mb-3" />
                    <p className="text-white/40 text-sm">Job inspection and retry management.</p>
                    <p className="text-xs text-white/30 mt-1">View failed jobs, retry processing, inspect provider responses.</p>
                </div>
            )}

            {activeTab === 'credits' && (
                <div className="space-y-4">
                    <div className="glass-card p-6">
                        <h3 className="font-semibold mb-4">Manual Credit Adjustment</h3>
                        <div className="grid md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm text-white/60 mb-2">User Email</label>
                                <input type="email" placeholder="user@example.com" className="input-field" />
                            </div>
                            <div>
                                <label className="block text-sm text-white/60 mb-2">Amount</label>
                                <input type="number" placeholder="100" className="input-field" />
                            </div>
                            <div>
                                <label className="block text-sm text-white/60 mb-2">Reason</label>
                                <input type="text" placeholder="Manual adjustment" className="input-field" />
                            </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                            <button className="btn-primary text-sm">
                                <Plus className="w-4 h-4 mr-1" />
                                Add Credits
                            </button>
                            <button className="btn-secondary text-sm text-red-400 hover:text-red-300">
                                <Minus className="w-4 h-4 mr-1" />
                                Deduct Credits
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'moderation' && (
                <div className="glass-card p-8 text-center">
                    <AlertTriangle className="w-12 h-12 text-white/10 mx-auto mb-3" />
                    <p className="text-white/40 text-sm">Moderation review queue.</p>
                    <p className="text-xs text-white/30 mt-1">Review flagged content, handle takedown requests, manage bans.</p>
                </div>
            )}
        </div>
    );
}
