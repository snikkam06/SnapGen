import { getApiBaseUrl } from './api-base-url';

const API_BASE_URL = getApiBaseUrl();

type TokenSource = string | (() => Promise<string | null>);

interface FetchOptions extends RequestInit {
    token?: TokenSource;
}

class ApiClient {
    private baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    private async resolveToken(tokenSource?: TokenSource): Promise<string | undefined> {
        if (!tokenSource) {
            return undefined;
        }

        if (typeof tokenSource === 'string') {
            return tokenSource;
        }

        const token = await tokenSource();
        if (!token) {
            throw new Error('Authentication token unavailable');
        }

        return token;
    }

    private buildHeaders(
        token: string | undefined,
        headersInit?: HeadersInit,
    ): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(headersInit as Record<string, string>),
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        return headers;
    }

    private async request<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
        const { token: tokenSource, ...fetchOptions } = options;
        let token = await this.resolveToken(tokenSource);

        let response = await fetch(`${this.baseUrl}${endpoint}`, {
            ...fetchOptions,
            headers: this.buildHeaders(token, fetchOptions.headers),
        });

        if (response.status === 401 && typeof tokenSource === 'function') {
            const refreshedToken = await this.resolveToken(tokenSource);
            if (refreshedToken && refreshedToken !== token) {
                token = refreshedToken;
                response = await fetch(`${this.baseUrl}${endpoint}`, {
                    ...fetchOptions,
                    headers: this.buildHeaders(token, fetchOptions.headers),
                });
            }
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'Network error' }));
            throw new Error(error.message || `API Error: ${response.status}`);
        }

        return response.json();
    }

    // Auth
    async syncAuth(token: TokenSource) {
        return this.request('/v1/auth/sync', { method: 'POST', token });
    }

    // User
    async getMe(token: TokenSource) {
        return this.request('/v1/me', { token });
    }

    async updateMe(token: TokenSource, data: { fullName?: string; avatarUrl?: string }) {
        return this.request('/v1/me', { method: 'PATCH', token, body: JSON.stringify(data) });
    }

    // Billing
    async createCheckoutSession(token: TokenSource, planCode: string) {
        return this.request('/v1/billing/checkout-session', {
            method: 'POST',
            token,
            body: JSON.stringify({ planCode }),
        });
    }

    async createPortalSession(token: TokenSource) {
        return this.request('/v1/billing/portal-session', { method: 'POST', token });
    }

    async getCredits(token: TokenSource) {
        return this.request('/v1/billing/credits', { token });
    }

    // Characters
    async getCharacters(token: TokenSource) {
        return this.request('/v1/characters', { token });
    }

    async getCharacter(token: TokenSource, id: string) {
        return this.request(`/v1/characters/${id}`, { token });
    }

    async createCharacter(token: TokenSource, data: { name: string; characterType: string }) {
        return this.request('/v1/characters', { method: 'POST', token, body: JSON.stringify(data) });
    }

    async updateCharacter(token: TokenSource, id: string, data: { name?: string }) {
        return this.request(`/v1/characters/${id}`, { method: 'PATCH', token, body: JSON.stringify(data) });
    }

    async deleteCharacter(token: TokenSource, id: string) {
        return this.request(`/v1/characters/${id}`, { method: 'DELETE', token });
    }

    async getUploadUrl(token: TokenSource, characterId: string, data: { fileName: string; contentType: string; fileSizeBytes: number }) {
        return this.request(`/v1/characters/${characterId}/dataset/upload-url`, {
            method: 'POST',
            token,
            body: JSON.stringify(data),
        });
    }

    async uploadCharacterImage(token: TokenSource, characterId: string, file: File) {
        const formData = new FormData();
        formData.append('file', file);
        const resolvedToken = await this.resolveToken(token);

        const response = await fetch(`${this.baseUrl}/v1/characters/${characterId}/dataset/upload`, {
            method: 'POST',
            headers: {
                ...(resolvedToken ? { Authorization: `Bearer ${resolvedToken}` } : {}),
            },
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'Upload failed' }));
            throw new Error(error.message || `Upload failed: ${response.status}`);
        }

        return response.json();
    }

    async trainCharacter(token: TokenSource, characterId: string, data: { trainingPreset: string }) {
        return this.request(`/v1/characters/${characterId}/train`, {
            method: 'POST',
            token,
            body: JSON.stringify(data),
        });
    }

    // Generation
    async generateImage(token: TokenSource, data: Record<string, unknown>) {
        return this.request('/v1/generations/image', { method: 'POST', token, body: JSON.stringify(data) });
    }

    async generateVideo(token: TokenSource, data: Record<string, unknown>) {
        return this.request('/v1/generations/video', { method: 'POST', token, body: JSON.stringify(data) });
    }

    async faceSwapImage(token: TokenSource, data: Record<string, unknown>) {
        return this.request('/v1/generations/faceswap-image', { method: 'POST', token, body: JSON.stringify(data) });
    }

    // Jobs
    async getJobs(token: TokenSource, params?: Record<string, string>) {
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        return this.request(`/v1/jobs${query}`, { token });
    }

    async getJob(token: TokenSource, id: string) {
        return this.request(`/v1/jobs/${id}`, { token });
    }

    // Assets
    async getAssets(token: TokenSource, params?: Record<string, string>) {
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        return this.request(`/v1/assets${query}`, { token });
    }

    async uploadImageAsset(token: TokenSource, file: File) {
        return this.uploadAsset(token, file);
    }

    async uploadVideoAsset(token: TokenSource, file: File) {
        return this.uploadAsset(token, file);
    }

    async uploadAsset(token: TokenSource, file: File) {
        const formData = new FormData();
        formData.append('file', file);
        const resolvedToken = await this.resolveToken(token);

        const response = await fetch(`${this.baseUrl}/v1/assets/upload`, {
            method: 'POST',
            headers: {
                ...(resolvedToken ? { Authorization: `Bearer ${resolvedToken}` } : {}),
            },
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'Upload failed' }));
            throw new Error(error.message || `Upload failed: ${response.status}`);
        }

        return response.json();
    }

    async deleteAsset(token: TokenSource, id: string) {
        return this.request(`/v1/assets/${id}`, { method: 'DELETE', token });
    }

    // Admin
    async adminSearchUsers(token: TokenSource, query: string) {
        return this.request(`/v1/admin/users?q=${encodeURIComponent(query)}`, { token });
    }

    async adminGetFailedJobs(token: TokenSource) {
        return this.request('/v1/admin/jobs/failed', { token });
    }

    async adminRetryJob(token: TokenSource, jobId: string) {
        return this.request(`/v1/admin/jobs/${jobId}/retry`, { method: 'POST', token });
    }

    async adminAdjustCredits(token: TokenSource, data: { userId: string; amount: number; reason: string }) {
        return this.request('/v1/admin/credits/adjust', { method: 'POST', token, body: JSON.stringify(data) });
    }

    async adminGetModerationQueue(token: TokenSource) {
        return this.request('/v1/admin/moderation', { token });
    }

    async adminModerateAsset(token: TokenSource, assetId: string, status: string) {
        return this.request(`/v1/admin/moderation/${assetId}`, { method: 'PATCH', token, body: JSON.stringify({ status }) });
    }
}

export const api = new ApiClient(API_BASE_URL);
