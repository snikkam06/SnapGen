'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Shield,
    Search,
    Users,
    CreditCard,
    Sparkles,
    AlertTriangle,
    RefreshCw,
    CheckCircle,
    XCircle,
    Plus,
    Minus,
    Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

type AdminTab = 'users' | 'jobs' | 'credits' | 'moderation';

interface AdminUser {
    id: string;
    email: string;
    fullName: string | null;
    role: string;
    clerkUserId: string;
}

interface FailedJob {
    id: string;
    jobType: string;
    status: string;
    provider: string;
    errorMessage: string | null;
    createdAt: string;
    userId: string;
}

interface ModerationItem {
    id: string;
    kind: string;
    moderationStatus: string;
    storageKey: string;
    userId: string;
    createdAt: string;
}

export default function AdminPage() {
    const [activeTab, setActiveTab] = useState<AdminTab>('users');
    const [searchQuery, setSearchQuery] = useState('');
    const [creditEmail, setCreditEmail] = useState('');
    const [creditAmount, setCreditAmount] = useState('');
    const [creditReason, setCreditReason] = useState('');
    const [creditUserId, setCreditUserId] = useState<string | null>(null);
    const tokenQuery = useApiToken();
    const queryClient = useQueryClient();
    const { getToken, isReady, userId } = tokenQuery;

    const tabs = [
        { id: 'users' as AdminTab, name: 'Users', icon: Users },
        { id: 'jobs' as AdminTab, name: 'Jobs', icon: Sparkles },
        { id: 'credits' as AdminTab, name: 'Credits', icon: CreditCard },
        { id: 'moderation' as AdminTab, name: 'Moderation', icon: AlertTriangle },
    ];

    // Users search
    const usersQuery = useQuery({
        queryKey: ['admin-users', userId, searchQuery],
        enabled: isReady && activeTab === 'users' && searchQuery.length >= 2,
        queryFn: () => api.adminSearchUsers(getToken, searchQuery) as Promise<AdminUser[]>,
    });

    // Failed jobs
    const failedJobsQuery = useQuery({
        queryKey: ['admin-failed-jobs', userId],
        enabled: isReady && activeTab === 'jobs',
        queryFn: () => api.adminGetFailedJobs(getToken) as Promise<FailedJob[]>,
    });

    const retryJobMutation = useMutation({
        mutationFn: async (jobId: string) => {
            if (!isReady) throw new Error('No token');
            return api.adminRetryJob(getToken, jobId);
        },
        onSuccess: async () => {
            toast.success('Job retry queued');
            await queryClient.invalidateQueries({ queryKey: ['admin-failed-jobs'] });
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Retry failed');
        },
    });

    // Credit user lookup
    const creditUserQuery = useQuery({
        queryKey: ['admin-credit-user', userId, creditEmail],
        enabled: isReady && activeTab === 'credits' && creditEmail.length >= 3,
        queryFn: () => api.adminSearchUsers(getToken, creditEmail) as Promise<AdminUser[]>,
    });

    const adjustCreditsMutation = useMutation({
        mutationFn: async ({ amount }: { amount: number }) => {
            if (!isReady || !creditUserId) throw new Error('Missing token or user');
            return api.adminAdjustCredits(getToken, {
                userId: creditUserId,
                amount,
                reason: creditReason || 'Manual adjustment',
            });
        },
        onSuccess: async () => {
            toast.success('Credits adjusted');
            setCreditAmount('');
            setCreditReason('');
            await queryClient.invalidateQueries({ queryKey: ['credits'] });
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Adjustment failed');
        },
    });

    // Moderation
    const moderationQuery = useQuery({
        queryKey: ['admin-moderation', userId],
        enabled: isReady && activeTab === 'moderation',
        queryFn: () => api.adminGetModerationQueue(getToken) as Promise<ModerationItem[]>,
    });

    const moderateMutation = useMutation({
        mutationFn: async ({ assetId, status }: { assetId: string; status: string }) => {
            if (!isReady) throw new Error('No token');
            return api.adminModerateAsset(getToken, assetId, status);
        },
        onSuccess: async () => {
            toast.success('Asset moderated');
            await queryClient.invalidateQueries({ queryKey: ['admin-moderation'] });
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Moderation failed');
        },
    });

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

            {/* Users Tab */}
            {activeTab === 'users' && (
                <div className="space-y-4">
                    <div className="relative max-w-md">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                        <input
                            type="text"
                            placeholder="Search users by email or name..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="input-field pl-11"
                        />
                    </div>
                    {usersQuery.isPending && searchQuery.length >= 2 ? (
                        <div className="glass-card p-8 text-center text-white/40">
                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                            Searching...
                        </div>
                    ) : (usersQuery.data?.length ?? 0) > 0 ? (
                        <div className="glass-card overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/10 text-white/50">
                                        <th className="text-left p-3">Email</th>
                                        <th className="text-left p-3">Name</th>
                                        <th className="text-left p-3">Role</th>
                                        <th className="text-left p-3">ID</th>
                                        <th className="text-left p-3">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {usersQuery.data?.map((user) => (
                                        <tr key={user.id} className="border-b border-white/5 hover:bg-white/5">
                                            <td className="p-3">{user.email}</td>
                                            <td className="p-3">{user.fullName || '-'}</td>
                                            <td className="p-3">{user.role}</td>
                                            <td className="p-3 text-xs text-white/40 font-mono">{user.id.slice(0, 8)}...</td>
                                            <td className="p-3">
                                                <button
                                                    onClick={() => {
                                                        setCreditUserId(user.id);
                                                        setCreditEmail(user.email);
                                                        setActiveTab('credits');
                                                    }}
                                                    className="text-xs text-purple-400 hover:text-purple-300"
                                                >
                                                    Add Credits
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : searchQuery.length >= 2 ? (
                        <div className="glass-card p-8 text-center text-white/40">No users found</div>
                    ) : (
                        <div className="glass-card p-8 text-center">
                            <Users className="w-12 h-12 text-white/10 mx-auto mb-3" />
                            <p className="text-white/40 text-sm">Type at least 2 characters to search users.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Jobs Tab */}
            {activeTab === 'jobs' && (
                <div className="space-y-4">
                    {failedJobsQuery.isPending ? (
                        <div className="glass-card p-8 text-center text-white/40">
                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                            Loading failed jobs...
                        </div>
                    ) : (failedJobsQuery.data?.length ?? 0) > 0 ? (
                        <div className="glass-card overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/10 text-white/50">
                                        <th className="text-left p-3">ID</th>
                                        <th className="text-left p-3">Type</th>
                                        <th className="text-left p-3">Provider</th>
                                        <th className="text-left p-3">Error</th>
                                        <th className="text-left p-3">Date</th>
                                        <th className="text-left p-3">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {failedJobsQuery.data?.map((job) => (
                                        <tr key={job.id} className="border-b border-white/5 hover:bg-white/5">
                                            <td className="p-3 font-mono text-xs text-white/40">{job.id.slice(0, 8)}...</td>
                                            <td className="p-3">{job.jobType}</td>
                                            <td className="p-3">{job.provider}</td>
                                            <td className="p-3 text-red-400 text-xs max-w-xs truncate">{job.errorMessage || '-'}</td>
                                            <td className="p-3 text-xs text-white/40">{new Date(job.createdAt).toLocaleDateString()}</td>
                                            <td className="p-3">
                                                <button
                                                    onClick={() => retryJobMutation.mutate(job.id)}
                                                    disabled={retryJobMutation.isPending}
                                                    className="btn-secondary text-xs px-2 py-1"
                                                >
                                                    <RefreshCw className="w-3 h-3 mr-1" />
                                                    Retry
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="glass-card p-8 text-center">
                            <Sparkles className="w-12 h-12 text-white/10 mx-auto mb-3" />
                            <p className="text-white/40 text-sm">No failed jobs found.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Credits Tab */}
            {activeTab === 'credits' && (
                <div className="space-y-4">
                    <div className="glass-card p-6">
                        <h3 className="font-semibold mb-4">Manual Credit Adjustment</h3>
                        <div className="grid md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm text-white/60 mb-2">User Email</label>
                                <input
                                    type="email"
                                    placeholder="user@example.com"
                                    className="input-field"
                                    value={creditEmail}
                                    onChange={(e) => {
                                        setCreditEmail(e.target.value);
                                        setCreditUserId(null);
                                    }}
                                />
                                {creditUserQuery.data && creditUserQuery.data.length > 0 && !creditUserId && (
                                    <div className="mt-2 rounded-lg bg-white/5 border border-white/10 max-h-32 overflow-y-auto">
                                        {creditUserQuery.data.map((user) => (
                                            <button
                                                key={user.id}
                                                onClick={() => {
                                                    setCreditUserId(user.id);
                                                    setCreditEmail(user.email);
                                                }}
                                                className="w-full text-left px-3 py-2 text-sm hover:bg-white/10 transition-colors"
                                            >
                                                {user.email} <span className="text-white/40">({user.fullName || 'No name'})</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {creditUserId && (
                                    <p className="text-xs text-green-400 mt-1">User selected</p>
                                )}
                            </div>
                            <div>
                                <label className="block text-sm text-white/60 mb-2">Amount</label>
                                <input
                                    type="number"
                                    placeholder="100"
                                    className="input-field"
                                    value={creditAmount}
                                    onChange={(e) => setCreditAmount(e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm text-white/60 mb-2">Reason</label>
                                <input
                                    type="text"
                                    placeholder="Manual adjustment"
                                    className="input-field"
                                    value={creditReason}
                                    onChange={(e) => setCreditReason(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                            <button
                                onClick={() => adjustCreditsMutation.mutate({ amount: Math.abs(Number(creditAmount)) })}
                                disabled={!creditUserId || !creditAmount || adjustCreditsMutation.isPending}
                                className="btn-primary text-sm"
                            >
                                <Plus className="w-4 h-4 mr-1" />
                                Add Credits
                            </button>
                            <button
                                onClick={() => adjustCreditsMutation.mutate({ amount: -Math.abs(Number(creditAmount)) })}
                                disabled={!creditUserId || !creditAmount || adjustCreditsMutation.isPending}
                                className="btn-secondary text-sm text-red-400 hover:text-red-300"
                            >
                                <Minus className="w-4 h-4 mr-1" />
                                Deduct Credits
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Moderation Tab */}
            {activeTab === 'moderation' && (
                <div className="space-y-4">
                    {moderationQuery.isPending ? (
                        <div className="glass-card p-8 text-center text-white/40">
                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                            Loading moderation queue...
                        </div>
                    ) : (moderationQuery.data?.length ?? 0) > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {moderationQuery.data?.map((item) => (
                                <div key={item.id} className="glass-card p-4 space-y-3">
                                    <div className="text-sm">
                                        <p className="font-medium">{item.kind}</p>
                                        <p className="text-xs text-white/40 mt-1 truncate">{item.storageKey}</p>
                                        <p className="text-xs text-white/40">
                                            {new Date(item.createdAt).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => moderateMutation.mutate({ assetId: item.id, status: 'approved' })}
                                            disabled={moderateMutation.isPending}
                                            className="btn-primary text-xs flex-1"
                                        >
                                            <CheckCircle className="w-3 h-3 mr-1" />
                                            Approve
                                        </button>
                                        <button
                                            onClick={() => moderateMutation.mutate({ assetId: item.id, status: 'rejected' })}
                                            disabled={moderateMutation.isPending}
                                            className="btn-secondary text-xs flex-1 text-red-400"
                                        >
                                            <XCircle className="w-3 h-3 mr-1" />
                                            Reject
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="glass-card p-8 text-center">
                            <AlertTriangle className="w-12 h-12 text-white/10 mx-auto mb-3" />
                            <p className="text-white/40 text-sm">Moderation queue is empty.</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
