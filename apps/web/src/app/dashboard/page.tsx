'use client';

import { useQuery } from '@tanstack/react-query';
import {
    Sparkles,
    Image as ImageIcon,
    Users,
    CreditCard,
    Wand2,
    ArrowRight,
    Clock,
    CheckCircle,
    XCircle,
    Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import { formatCredits, formatRelativeTime, getStatusBadgeClass } from '@/lib/utils';

interface MeResponse {
    plan: {
        name: string;
    };
}

interface CharacterListItem {
    id: string;
}

interface JobListItem {
    id: string;
    jobType: string;
    status: string;
    prompt: string | null;
    reservedCredits: number;
    createdAt: string;
}

const quickActions = [
    { name: 'Generate Image', href: '/dashboard/generate', icon: Wand2, description: 'Create AI images with your characters' },
    { name: 'Create Character', href: '/dashboard/characters', icon: Users, description: 'Train a new AI character' },
    { name: 'View Gallery', href: '/dashboard/gallery', icon: ImageIcon, description: 'Browse your generated content' },
    { name: 'Buy Credits', href: '/dashboard/billing', icon: CreditCard, description: 'Top up your credit balance' },
];

export default function DashboardPage() {
    const tokenQuery = useApiToken();
    const token = tokenQuery.data;

    const meQuery = useQuery({
        queryKey: ['me', token],
        enabled: !!token,
        queryFn: () => api.getMe(token as string) as Promise<MeResponse>,
    });
    const creditsQuery = useQuery({
        queryKey: ['credits', token],
        enabled: !!token,
        queryFn: () => api.getCredits(token as string) as Promise<{ balance: number }>,
    });
    const charactersQuery = useQuery({
        queryKey: ['characters', token],
        enabled: !!token,
        queryFn: () => api.getCharacters(token as string) as Promise<CharacterListItem[]>,
    });
    const jobsQuery = useQuery({
        queryKey: ['jobs', token],
        enabled: !!token,
        queryFn: () => api.getJobs(token as string) as Promise<JobListItem[]>,
    });

    const jobs = jobsQuery.data || [];
    const completedJobs = jobs.filter((job) => job.status === 'completed').length;
    const failedJobs = jobs.filter((job) => job.status === 'failed').length;

    const stats = [
        {
            name: 'Credits Remaining',
            value: formatCredits(creditsQuery.data?.balance || 0),
            icon: Sparkles,
            color: 'from-purple-500 to-violet-500',
        },
        {
            name: 'Completed Jobs',
            value: String(completedJobs),
            icon: ImageIcon,
            color: 'from-pink-500 to-rose-500',
        },
        {
            name: 'Characters',
            value: String(charactersQuery.data?.length || 0),
            icon: Users,
            color: 'from-blue-500 to-cyan-500',
        },
        {
            name: 'Current Plan',
            value: meQuery.data?.plan.name || 'Free',
            icon: CreditCard,
            color: 'from-green-500 to-emerald-500',
        },
    ];

    const isLoading =
        tokenQuery.isPending ||
        meQuery.isPending ||
        creditsQuery.isPending ||
        charactersQuery.isPending ||
        jobsQuery.isPending;

    return (
        <div className="space-y-8">
            <div className="page-header">
                <h1 className="page-title">Dashboard</h1>
                <p className="page-description">Welcome back! Here&apos;s your content creation overview.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {stats.map((stat) => (
                    <div key={stat.name} className="glass-card p-5 group hover:bg-white/10 transition-all duration-300">
                        <div className="flex items-center justify-between mb-3">
                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${stat.color} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                                <stat.icon className="w-5 h-5 text-white" />
                            </div>
                        </div>
                        <div className="text-2xl font-bold">{isLoading ? '...' : stat.value}</div>
                        <div className="text-sm text-white/40 mt-1">{stat.name}</div>
                    </div>
                ))}
            </div>

            <div>
                <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {quickActions.map((action) => (
                        <Link
                            key={action.name}
                            href={action.href}
                            className="glass-card-hover p-5 group"
                        >
                            <div className="flex items-center justify-between mb-3">
                                <action.icon className="w-6 h-6 text-purple-400 group-hover:text-purple-300 transition-colors" />
                                <ArrowRight className="w-4 h-4 text-white/20 group-hover:text-white/60 group-hover:translate-x-1 transition-all" />
                            </div>
                            <h3 className="font-semibold text-sm mb-1">{action.name}</h3>
                            <p className="text-xs text-white/40">{action.description}</p>
                        </Link>
                    ))}
                </div>
            </div>

            <div>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-semibold">Recent Jobs</h2>
                    {failedJobs > 0 && <span className="text-sm text-red-400">{failedJobs} failed</span>}
                </div>

                {jobs.length === 0 ? (
                    <div className="glass-card overflow-hidden">
                        <div className="p-8 text-center">
                            <Sparkles className="w-12 h-12 text-white/10 mx-auto mb-3" />
                            <p className="text-white/40 text-sm">No jobs yet. Start by generating your first image!</p>
                            <Link href="/dashboard/generate" className="btn-primary text-sm px-5 py-2 mt-4 inline-flex">
                                Generate Image
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {jobs.slice(0, 5).map((job) => (
                            <div key={job.id} className="glass-card-hover p-4 flex items-center gap-4">
                                <div className="flex-shrink-0">
                                    {job.status === 'queued' && <Clock className="w-4 h-4 text-yellow-400" />}
                                    {job.status === 'running' && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
                                    {job.status === 'completed' && <CheckCircle className="w-4 h-4 text-green-400" />}
                                    {job.status === 'failed' && <XCircle className="w-4 h-4 text-red-400" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium capitalize">{job.jobType}</span>
                                        <span className={getStatusBadgeClass(job.status)}>{job.status}</span>
                                    </div>
                                    {job.prompt && (
                                        <p className="text-xs text-white/40 mt-1 truncate">{job.prompt}</p>
                                    )}
                                </div>
                                <div className="text-right flex-shrink-0">
                                    <p className="text-xs text-white/30">{formatRelativeTime(job.createdAt)}</p>
                                    <p className="text-xs text-purple-400">{job.reservedCredits} credits</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
