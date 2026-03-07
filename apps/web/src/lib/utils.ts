import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

export function formatCredits(amount: number): string {
    return new Intl.NumberFormat('en-US').format(amount);
}

export function formatCurrency(cents: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(cents / 100);
}

export function formatDate(date: string | Date): string {
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    }).format(new Date(date));
}

export function formatRelativeTime(date: string | Date): string {
    const now = new Date();
    const then = new Date(date);
    const diffMs = now.getTime() - then.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHr / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(date);
}

export function slugify(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function getStatusColor(status: string): string {
    const colors: Record<string, string> = {
        queued: 'text-yellow-400',
        running: 'text-blue-400',
        completed: 'text-green-400',
        failed: 'text-red-400',
        canceled: 'text-gray-400',
        active: 'text-green-400',
        inactive: 'text-gray-400',
        draft: 'text-yellow-400',
        trained: 'text-green-400',
        training: 'text-blue-400',
    };
    return colors[status] || 'text-gray-400';
}

export function getStatusBadgeClass(status: string): string {
    const classes: Record<string, string> = {
        queued: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
        running: 'bg-blue-400/10 text-blue-400 border-blue-400/20',
        completed: 'bg-green-400/10 text-green-400 border-green-400/20',
        failed: 'bg-red-400/10 text-red-400 border-red-400/20',
        canceled: 'bg-gray-400/10 text-gray-400 border-gray-400/20',
        active: 'bg-green-400/10 text-green-400 border-green-400/20',
        draft: 'bg-yellow-400/10 text-yellow-400 border-yellow-400/20',
        trained: 'bg-purple-400/10 text-purple-400 border-purple-400/20',
    };
    return `inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${classes[status] || 'bg-gray-400/10 text-gray-400 border-gray-400/20'}`;
}
