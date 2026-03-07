// ─── AI Provider Adapter Interfaces ──────────────────
// These abstractions allow swapping vendors without changing business logic.

// ─── Image Generation ────────────────────────────────
export interface ImageGenerationInput {
    prompt: string;
    negativePrompt?: string;
    referenceImages?: string[];
    loraModelUrl?: string;
    aspectRatio?: string;
    seed?: number;
    numImages?: number;
    guidance?: number;
    steps?: number;
    settings?: Record<string, unknown>;
}

export interface ImageGenerationAdapter {
    readonly providerName: string;
    createJob(input: ImageGenerationInput): Promise<{
        externalJobId: string;
        status: 'queued' | 'running' | 'completed';
    }>;
    getJob(externalJobId: string): Promise<{
        status: 'queued' | 'running' | 'completed' | 'failed';
        outputs?: Array<{ url: string; mimeType: string }>;
        errorMessage?: string;
    }>;
}

// ─── Video Generation ────────────────────────────────
export interface VideoGenerationInput {
    prompt: string;
    sourceImageUrl?: string;
    aspectRatio?: string;
    durationSec?: number;
    settings?: Record<string, unknown>;
}

export interface VideoGenerationAdapter {
    readonly providerName: string;
    createJob(input: VideoGenerationInput): Promise<{
        externalJobId: string;
        status: 'queued' | 'running' | 'completed';
    }>;
    getJob(externalJobId: string): Promise<{
        status: 'queued' | 'running' | 'completed' | 'failed';
        outputs?: Array<{ url: string; mimeType: string; durationSec?: number }>;
        errorMessage?: string;
    }>;
}

// ─── Face Swap ───────────────────────────────────────
export interface FaceSwapInput {
    sourceFaceUrl: string;
    targetMediaUrl: string;
    mediaType: 'image' | 'video';
}

export interface FaceSwapAdapter {
    readonly providerName: string;
    createJob(input: FaceSwapInput): Promise<{
        externalJobId: string;
        status: 'queued' | 'running' | 'completed';
    }>;
    getJob(externalJobId: string): Promise<{
        status: 'queued' | 'running' | 'completed' | 'failed';
        outputs?: Array<{ url: string; mimeType: string }>;
        errorMessage?: string;
    }>;
}

// ─── Upscale ─────────────────────────────────────────
export interface UpscaleInput {
    imageUrl: string;
    scale?: number;
    mode?: 'realism' | 'quality' | 'detail';
}

export interface UpscaleAdapter {
    readonly providerName: string;
    createJob(input: UpscaleInput): Promise<{
        externalJobId: string;
        status: 'queued' | 'running' | 'completed';
    }>;
    getJob(externalJobId: string): Promise<{
        status: 'queued' | 'running' | 'completed' | 'failed';
        outputs?: Array<{ url: string; mimeType: string; width: number; height: number }>;
        errorMessage?: string;
    }>;
}

// ─── Model Training ─────────────────────────────────
export interface TrainingInput {
    trainingImages: string[];
    instancePrompt: string;
    modelType: 'lora' | 'dreambooth';
    settings?: Record<string, unknown>;
}

export interface TrainingAdapter {
    readonly providerName: string;
    createJob(input: TrainingInput): Promise<{
        externalJobId: string;
        status: 'queued' | 'running' | 'completed';
    }>;
    getJob(externalJobId: string): Promise<{
        status: 'queued' | 'running' | 'completed' | 'failed';
        modelUrl?: string;
        errorMessage?: string;
    }>;
}

interface FalCreateJobResponse {
    request_id?: string;
}

interface FalJobResponse {
    status?: string;
    images?: Array<{ url: string; content_type?: string }>;
}

interface ReplicatePredictionResponse {
    id?: string;
    status?: string;
    output?: string[];
    error?: string;
}

interface GeminiGenerateContentResponse {
    candidates?: Array<{
        finishReason?: string;
        content?: {
            parts?: Array<{
                text?: string;
                inlineData?: {
                    mimeType?: string;
                    data?: string;
                };
                inline_data?: {
                    mime_type?: string;
                    data?: string;
                };
            }>;
        };
    }>;
    promptFeedback?: {
        blockReason?: string;
        safetyRatings?: Array<{
            category?: string;
            probability?: string;
        }>;
    };
    error?: {
        message?: string;
    };
}

// ─── Fal.ai Implementation ──────────────────────────
export class FalImageAdapter implements ImageGenerationAdapter {
    readonly providerName = 'fal';
    private apiKey: string;
    private baseUrl = 'https://fal.run';

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async createJob(input: ImageGenerationInput): Promise<{
        externalJobId: string;
        status: 'queued' | 'running' | 'completed';
    }> {
        const response = await fetch(`${this.baseUrl}/fal-ai/flux/dev`, {
            method: 'POST',
            headers: {
                Authorization: `Key ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: input.prompt,
                negative_prompt: input.negativePrompt,
                image_size: this.mapAspectRatio(input.aspectRatio),
                num_images: input.numImages ?? 1,
                seed: input.seed,
                guidance_scale: input.guidance ?? 7.0,
                num_inference_steps: input.steps ?? 30,
                loras: input.loraModelUrl
                    ? [{ path: input.loraModelUrl, scale: 0.8 }]
                    : undefined,
                enable_safety_checker: false,
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Fal API error: ${response.status} - ${error}`);
        }

        const data = (await response.json()) as FalCreateJobResponse;
        return {
            externalJobId: data.request_id ?? `fal-${Date.now()}`,
            status: 'completed' as const,
        };
    }

    async getJob(externalJobId: string): Promise<{
        status: 'queued' | 'running' | 'completed' | 'failed';
        outputs?: Array<{ url: string; mimeType: string }>;
        errorMessage?: string;
    }> {
        const response = await fetch(
            `${this.baseUrl}/fal-ai/flux/dev/requests/${externalJobId}/status`,
            {
                headers: { Authorization: `Key ${this.apiKey}` },
            },
        );

        if (!response.ok) {
            return { status: 'failed' as const, errorMessage: 'Failed to fetch job status' };
        }

        const data = (await response.json()) as FalJobResponse;
        return {
            status: this.mapStatus(data.status),
            outputs: data.images?.map((img) => ({
                url: img.url,
                mimeType: img.content_type || 'image/png',
            })),
        };
    }

    private mapAspectRatio(ratio?: string): string {
        const map: Record<string, string> = {
            '1:1': 'square_hd',
            '4:5': 'portrait_4_3',
            '16:9': 'landscape_16_9',
            '9:16': 'portrait_16_9',
        };
        return map[ratio || '1:1'] || 'square_hd';
    }

    private mapStatus(status?: string): 'queued' | 'running' | 'completed' | 'failed' {
        const statusMap: Record<string, 'queued' | 'running' | 'completed' | 'failed'> = {
            IN_QUEUE: 'queued',
            IN_PROGRESS: 'running',
            COMPLETED: 'completed',
            FAILED: 'failed',
        };
        return statusMap[status ?? ''] || 'queued';
    }
}

// ─── Replicate Implementation ────────────────────────
export class ReplicateImageAdapter implements ImageGenerationAdapter {
    readonly providerName = 'replicate';
    private apiKey: string;
    private baseUrl = 'https://api.replicate.com/v1';

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async createJob(input: ImageGenerationInput): Promise<{
        externalJobId: string;
        status: 'queued' | 'running' | 'completed';
    }> {
        const response = await fetch(`${this.baseUrl}/predictions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'black-forest-labs/flux-schnell',
                input: {
                    prompt: input.prompt,
                    negative_prompt: input.negativePrompt,
                    num_outputs: input.numImages ?? 1,
                    aspect_ratio: input.aspectRatio || '1:1',
                    seed: input.seed,
                    guidance: input.guidance ?? 7.0,
                    num_inference_steps: input.steps ?? 4,
                    disable_safety_checker: true,
                },
            }),
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Replicate API error: ${response.status} - ${error}`);
        }

        const data = (await response.json()) as ReplicatePredictionResponse;
        const status = this.mapStatus(data.status);

        if (status === 'failed') {
            throw new Error(data.error || 'Replicate job failed to start');
        }

        return {
            externalJobId: data.id ?? `replicate-${Date.now()}`,
            status,
        };
    }

    async getJob(externalJobId: string): Promise<{
        status: 'queued' | 'running' | 'completed' | 'failed';
        outputs?: Array<{ url: string; mimeType: string }>;
        errorMessage?: string;
    }> {
        const response = await fetch(`${this.baseUrl}/predictions/${externalJobId}`, {
            headers: { Authorization: `Bearer ${this.apiKey}` },
        });

        if (!response.ok) {
            return { status: 'failed' as const, errorMessage: 'Failed to fetch job status' };
        }

        const data = (await response.json()) as ReplicatePredictionResponse;
        return {
            status: this.mapStatus(data.status),
            outputs: data.output?.map((url: string) => ({
                url,
                mimeType: 'image/webp',
            })),
            errorMessage: data.error,
        };
    }

    private mapStatus(status?: string): 'queued' | 'running' | 'completed' | 'failed' {
        const statusMap: Record<string, 'queued' | 'running' | 'completed' | 'failed'> = {
            starting: 'queued',
            processing: 'running',
            succeeded: 'completed',
            failed: 'failed',
            canceled: 'failed',
        };
        return statusMap[status ?? ''] || 'queued';
    }
}

// ─── Google Gemini Implementation ───────────────────
export class GoogleImageAdapter implements ImageGenerationAdapter {
    readonly providerName = 'google';
    private apiKey: string;
    private baseUrl =
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';
    private static completedJobs = new Map<
        string,
        {
            status: 'completed' | 'failed';
            outputs?: Array<{ url: string; mimeType: string }>;
            errorMessage?: string;
        }
    >();

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async createJob(input: ImageGenerationInput): Promise<{
        externalJobId: string;
        status: 'queued' | 'running' | 'completed';
    }> {
        if (!this.apiKey) {
            throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY is required for Google image generation');
        }

        const requestCount = Math.max(1, Math.min(input.numImages ?? 1, 4));
        const outputs = (
            await Promise.all(
                Array.from({ length: requestCount }, async () => this.generateImages(input)),
            )
        ).flat();

        if (!outputs.length) {
            throw new Error('Google Gemini returned no image outputs');
        }

        const externalJobId = `google-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        GoogleImageAdapter.completedJobs.set(externalJobId, {
            status: 'completed',
            outputs,
        });

        return {
            externalJobId,
            status: 'completed',
        };
    }

    async getJob(externalJobId: string): Promise<{
        status: 'queued' | 'running' | 'completed' | 'failed';
        outputs?: Array<{ url: string; mimeType: string }>;
        errorMessage?: string;
    }> {
        const completedJob = GoogleImageAdapter.completedJobs.get(externalJobId);
        if (!completedJob) {
            return {
                status: 'failed',
                errorMessage: 'Google image job result is unavailable',
            };
        }

        return completedJob;
    }

    private async generateImages(
        input: ImageGenerationInput,
    ): Promise<Array<{ url: string; mimeType: string }>> {
        const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
                'x-goog-api-key': this.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: this.buildPrompt(input.prompt, input.negativePrompt) }],
                    },
                ],
                generationConfig: {
                    responseModalities: ['IMAGE'],
                    imageConfig: {
                        aspectRatio: this.normalizeAspectRatio(input.aspectRatio),
                    },
                },
            }),
        });

        const payload = (await response.json()) as GeminiGenerateContentResponse;
        if (!response.ok) {
            throw new Error(
                payload.error?.message ||
                    `Google Gemini API error: ${response.status} ${response.statusText}`,
            );
        }

        const outputs = this.extractOutputs(payload);
        if (!outputs.length) {
            throw new Error(this.extractErrorMessage(payload));
        }

        return outputs;
    }

    private buildPrompt(prompt: string, negativePrompt?: string): string {
        if (!negativePrompt?.trim()) {
            return prompt;
        }

        return `${prompt}\n\nAvoid: ${negativePrompt.trim()}`;
    }

    private normalizeAspectRatio(ratio?: string): string {
        const allowedRatios = new Set([
            '1:1',
            '1:4',
            '1:8',
            '3:4',
            '4:3',
            '9:16',
            '16:9',
            '21:9',
        ]);

        if (!ratio || !allowedRatios.has(ratio)) {
            return '1:1';
        }

        return ratio;
    }

    private extractOutputs(
        payload: GeminiGenerateContentResponse,
    ): Array<{ url: string; mimeType: string }> {
        const parts =
            payload.candidates?.flatMap((candidate) => candidate.content?.parts ?? []) ?? [];

        return parts
            .map((part) => {
                const inlineData = part.inlineData || part.inline_data;
                const mimeType =
                    part.inlineData?.mimeType || part.inline_data?.mime_type || 'image/png';
                const data = inlineData?.data;

                if (!data) {
                    return null;
                }

                return {
                    url: `data:${mimeType};base64,${data}`,
                    mimeType,
                };
            })
            .filter((output): output is { url: string; mimeType: string } => output !== null);
    }

    private extractErrorMessage(payload: GeminiGenerateContentResponse): string {
        if (payload.error?.message) {
            return payload.error.message;
        }

        if (payload.promptFeedback?.blockReason) {
            return `Google Gemini blocked the prompt: ${payload.promptFeedback.blockReason}`;
        }

        const finishReason = payload.candidates?.find((candidate) => candidate.finishReason)?.finishReason;
        if (finishReason && finishReason !== 'STOP') {
            return `Google Gemini did not return an image: ${finishReason}`;
        }

        return 'Google Gemini returned no image outputs';
    }
}

// ─── Mock adapter for development ────────────────────
export class MockImageAdapter implements ImageGenerationAdapter {
    readonly providerName = 'mock';

    async createJob(input: ImageGenerationInput): Promise<{
        externalJobId: string;
        status: 'queued' | 'running' | 'completed';
    }> {
        console.log('[MockImageAdapter] Creating job:', input.prompt);
        return {
            externalJobId: `mock-${Date.now()}`,
            status: 'completed' as const,
        };
    }

    async getJob(externalJobId: string): Promise<{
        status: 'queued' | 'running' | 'completed' | 'failed';
        outputs?: Array<{ url: string; mimeType: string }>;
        errorMessage?: string;
    }> {
        return {
            status: 'completed' as const,
            outputs: [
                {
                    url: `https://picsum.photos/seed/${externalJobId}/1024/1024`,
                    mimeType: 'image/jpeg',
                },
            ],
        };
    }
}

// ─── Provider Factory ────────────────────────────────
export function createImageAdapter(provider: string, apiKey: string): ImageGenerationAdapter {
    switch (provider) {
        case 'google':
        case 'gemini':
            return new GoogleImageAdapter(apiKey);
        case 'fal':
            return new FalImageAdapter(apiKey);
        case 'replicate':
            return new ReplicateImageAdapter(apiKey);
        case 'mock':
            return new MockImageAdapter();
        default:
            throw new Error(`Unknown image provider: ${provider}`);
    }
}
