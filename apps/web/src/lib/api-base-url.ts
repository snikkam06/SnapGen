function stripWrappingQuotes(value: string): string {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1);
    }

    return value;
}

function normalizeBaseUrl(value?: string): string | undefined {
    if (!value) {
        return undefined;
    }

    const normalized = stripWrappingQuotes(value.trim()).replace(/\/+$/, '');
    return normalized || undefined;
}

export function getBrowserApiBaseUrl(): string {
    return normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL) || '/api';
}

export function getServerApiBaseUrl(): string {
    const publicBaseUrl = normalizeBaseUrl(process.env.NEXT_PUBLIC_API_BASE_URL);
    if (publicBaseUrl) {
        return publicBaseUrl;
    }

    const serverUrl = normalizeBaseUrl(process.env.API_SERVER_URL);
    return serverUrl ? `${serverUrl}/api` : 'http://localhost:3001/api';
}

export function getApiBaseUrl(): string {
    return typeof window !== 'undefined' ? getBrowserApiBaseUrl() : getServerApiBaseUrl();
}
