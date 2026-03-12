const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001/api';

interface FetchOptions extends RequestInit {
    token?: string;
}

class ApiClient {
    private baseUrl: string;

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    private async request<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
        const { token, ...fetchOptions } = options;

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(fetchOptions.headers as Record<string, string>),
        };

        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
            ...fetchOptions,
            headers,
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'Network error' }));
            throw new Error(error.message || `API Error: ${response.status}`);
        }

        return response.json();
    }

    // Auth
    async syncAuth(token: string) {
        return this.request('/v1/auth/sync', { method: 'POST', token });
    }

    // User
    async getMe(token: string) {
        return this.request('/v1/me', { token });
    }

    async updateMe(token: string, data: { fullName?: string; avatarUrl?: string }) {
        return this.request('/v1/me', { method: 'PATCH', token, body: JSON.stringify(data) });
    }

    // Billing
    async createCheckoutSession(token: string, planCode: string) {
        return this.request('/v1/billing/checkout-session', {
            method: 'POST',
            token,
            body: JSON.stringify({ planCode }),
        });
    }

    async createPortalSession(token: string) {
        return this.request('/v1/billing/portal-session', { method: 'POST', token });
    }

    async getCredits(token: string) {
        return this.request('/v1/billing/credits', { token });
    }

    // Characters
    async getCharacters(token: string) {
        return this.request('/v1/characters', { token });
    }

    async getCharacter(token: string, id: string) {
        return this.request(`/v1/characters/${id}`, { token });
    }

    async createCharacter(token: string, data: { name: string; characterType: string }) {
        return this.request('/v1/characters', { method: 'POST', token, body: JSON.stringify(data) });
    }

    async updateCharacter(token: string, id: string, data: { name?: string }) {
        return this.request(`/v1/characters/${id}`, { method: 'PATCH', token, body: JSON.stringify(data) });
    }

    async deleteCharacter(token: string, id: string) {
        return this.request(`/v1/characters/${id}`, { method: 'DELETE', token });
    }

    async getUploadUrl(token: string, characterId: string, data: { fileName: string; contentType: string; fileSizeBytes: number }) {
        return this.request(`/v1/characters/${characterId}/dataset/upload-url`, {
            method: 'POST',
            token,
            body: JSON.stringify(data),
        });
    }

    async uploadCharacterImage(token: string, characterId: string, file: File) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${this.baseUrl}/v1/characters/${characterId}/dataset/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'Upload failed' }));
            throw new Error(error.message || `Upload failed: ${response.status}`);
        }

        return response.json();
    }

    async trainCharacter(token: string, characterId: string, data: { trainingPreset: string }) {
        return this.request(`/v1/characters/${characterId}/train`, {
            method: 'POST',
            token,
            body: JSON.stringify(data),
        });
    }

    // Generation
    async generateImage(token: string, data: Record<string, unknown>) {
        return this.request('/v1/generations/image', { method: 'POST', token, body: JSON.stringify(data) });
    }

    async generateVideo(token: string, data: Record<string, unknown>) {
        return this.request('/v1/generations/video', { method: 'POST', token, body: JSON.stringify(data) });
    }

    async faceSwapImage(token: string, data: Record<string, unknown>) {
        return this.request('/v1/generations/faceswap-image', { method: 'POST', token, body: JSON.stringify(data) });
    }

    async upscaleImage(token: string, data: Record<string, unknown>) {
        return this.request('/v1/generations/upscale', { method: 'POST', token, body: JSON.stringify(data) });
    }

    // Jobs
    async getJobs(token: string, params?: Record<string, string>) {
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        return this.request(`/v1/jobs${query}`, { token });
    }

    async getJob(token: string, id: string) {
        return this.request(`/v1/jobs/${id}`, { token });
    }

    // Assets
    async getAssets(token: string, params?: Record<string, string>) {
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        return this.request(`/v1/assets${query}`, { token });
    }

    async uploadImageAsset(token: string, file: File) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${this.baseUrl}/v1/assets/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
            },
            body: formData,
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ message: 'Upload failed' }));
            throw new Error(error.message || `Upload failed: ${response.status}`);
        }

        return response.json();
    }

    async deleteAsset(token: string, id: string) {
        return this.request(`/v1/assets/${id}`, { method: 'DELETE', token });
    }

    // Admin
    async adminSearchUsers(token: string, query: string) {
        return this.request(`/v1/admin/users?q=${encodeURIComponent(query)}`, { token });
    }

    async adminGetFailedJobs(token: string) {
        return this.request('/v1/admin/jobs/failed', { token });
    }

    async adminRetryJob(token: string, jobId: string) {
        return this.request(`/v1/admin/jobs/${jobId}/retry`, { method: 'POST', token });
    }

    async adminAdjustCredits(token: string, data: { userId: string; amount: number; reason: string }) {
        return this.request('/v1/admin/credits/adjust', { method: 'POST', token, body: JSON.stringify(data) });
    }

    async adminGetModerationQueue(token: string) {
        return this.request('/v1/admin/moderation', { token });
    }

    async adminModerateAsset(token: string, assetId: string, status: string) {
        return this.request(`/v1/admin/moderation/${assetId}`, { method: 'PATCH', token, body: JSON.stringify({ status }) });
    }
}

export const api = new ApiClient(API_BASE_URL);
