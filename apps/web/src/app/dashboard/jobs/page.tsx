'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Sparkles,
    Clock,
    CheckCircle,
    XCircle,
    Loader2,
    Eye,
    RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import { cn, getStatusBadgeClass, formatRelativeTime } from '@/lib/utils';

type JobFilter = 'all' | 'queued' | 'running' | 'completed' | 'failed';

interface Job {
    id: string;
    jobType: string;
    status: string;
    prompt: string | null;
    provider: string;
    reservedCredits: number;
    createdAt: string;
}

export default function JobsPage() {
    const [filter, setFilter] = useState<JobFilter>('all');
    const tokenQuery = useApiToken();
    const token = tokenQuery.data;

    const jobsQuery = useQuery({
        queryKey: ['jobs', token, filter],
        enabled: !!token,
        refetchInterval: 5000,
        queryFn: () =>
            api.getJobs(
                token as string,
                filter === 'all' ? undefined : { status: filter },
            ) as Promise<Job[]>,
    });

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'queued':
                return <Clock className="w-4 h-4 text-yellow-400" />;
            case 'running':
                return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
            case 'completed':
                return <CheckCircle className="w-4 h-4 text-green-400" />;
            case 'failed':
                return <XCircle className="w-4 h-4 text-red-400" />;
            default:
                return <Clock className="w-4 h-4 text-gray-400" />;
        }
    };

    const jobs = jobsQuery.data || [];

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="page-header mb-0">
                    <h1 className="page-title">Jobs</h1>
                    <p className="page-description">Track your generation jobs and their status.</p>
                </div>
                <button className="btn-ghost" onClick={() => void jobsQuery.refetch()}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Refresh
                </button>
            </div>

            <div className="flex items-center gap-1 glass-card p-1 w-fit">
                {(['all', 'queued', 'running', 'completed', 'failed'] as JobFilter[]).map((entry) => (
                    <button
                        key={entry}
                        onClick={() => setFilter(entry)}
                        className={cn(
                            'px-4 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize',
                            filter === entry ? 'bg-purple-600 text-white' : 'text-white/50 hover:text-white',
                        )}
                    >
                        {entry}
                    </button>
                ))}
            </div>

            {jobsQuery.isPending ? (
                <div className="glass-card p-12 text-center text-white/40">Loading jobs...</div>
            ) : jobs.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <Sparkles className="w-16 h-16 text-white/10 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No jobs yet</h3>
                    <p className="text-white/40 text-sm">
                        When you generate images or videos, your jobs will appear here.
                    </p>
                </div>
            ) : (
                <div className="space-y-2">
                    {jobs.map((job) => (
                        <div key={job.id} className="glass-card-hover p-4 flex items-center gap-4">
                            <div className="flex-shrink-0">{getStatusIcon(job.status)}</div>
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
                            <Link href={`/dashboard/generate?job=${job.id}`} className="btn-ghost p-2">
                                <Eye className="w-4 h-4" />
                            </Link>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
