// ─── Auth ────────────────────────────────────────────
export interface AuthSyncResponse {
    user: {
        id: string;
        email: string;
        fullName: string | null;
        role: string;
        status: string;
    };
}

// ─── User ────────────────────────────────────────────
export interface UserProfile {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
    role: string;
    status: string;
    balance: number;
    plan: {
        code: string;
        name: string;
    };
}

export interface UpdateProfileInput {
    fullName?: string;
    avatarUrl?: string;
}

// ─── Billing ─────────────────────────────────────────
export interface PlanInfo {
    code: string;
    name: string;
    monthlyPriceCents: number;
    monthlyCredits: number;
    features: PlanFeatures;
}

export interface PlanFeatures {
    maxCharacters: number;
    maxImagesPerJob: number;
    videoGeneration: boolean;
    faceSwap: boolean;
    upscale: boolean;
    priorityQueue: boolean;
    apiAccess?: boolean;
    whiteLabel?: boolean;
}

export interface CreditBalance {
    balance: number;
    recentEntries: CreditEntry[];
}

export interface CreditEntry {
    id: string;
    amount: number;
    entryType: string;
    reason: string;
    createdAt: string;
}

export interface CheckoutSessionInput {
    planCode: string;
}

// ─── Characters ──────────────────────────────────────
export interface CharacterListItem {
    id: string;
    name: string;
    slug: string;
    characterType: string;
    status: string;
    coverUrl: string | null;
    createdAt: string;
}

export interface CharacterDetail extends CharacterListItem {
    datasets: DatasetInfo[];
    models: ModelInfo[];
    updatedAt: string;
}

export interface CreateCharacterInput {
    name: string;
    characterType: 'real' | 'fictional';
}

export interface UpdateCharacterInput {
    name?: string;
}

export interface DatasetInfo {
    id: string;
    status: string;
    imageCount: number;
    qualityScore: number | null;
    createdAt: string;
}

export interface ModelInfo {
    id: string;
    provider: string;
    modelType: string;
    versionTag: string;
    status: string;
    createdAt: string;
}

export interface UploadUrlRequest {
    fileName: string;
    contentType: string;
    fileSizeBytes: number;
}

export interface UploadUrlResponse {
    assetId: string;
    uploadUrl: string;
    publicUrl: string | null;
    headers: Record<string, string>;
}

// ─── Generation ──────────────────────────────────────
export type JobType = 'image' | 'video' | 'faceswap-image' | 'faceswap-video' | 'upscale';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled';

export interface ImageGenerationInput {
    characterId?: string;
    stylePackId?: string;
    prompt: string;
    negativePrompt?: string;
    settings?: {
        aspectRatio?: string;
        numImages?: number;
        seed?: number;
        guidance?: number;
    };
}

export interface VideoGenerationInput {
    characterId?: string;
    prompt: string;
    sourceAssetId: string;
    settings?: {
        durationSec?: number;
        aspectRatio?: string;
    };
}

export interface FaceSwapImageInput {
    sourceAssetId: string;
    targetAssetId: string;
}

export interface FaceSwapVideoInput {
    sourceFaceAssetId: string;
    targetVideoAssetId: string;
}

export interface UpscaleInput {
    assetId: string;
    mode?: 'realism' | 'quality' | 'detail';
}

export interface TrainModelInput {
    trainingPreset: string;
}

// ─── Jobs ────────────────────────────────────────────
export interface JobListItem {
    id: string;
    jobType: JobType;
    status: JobStatus;
    prompt: string | null;
    provider: string;
    reservedCredits: number;
    finalCredits: number | null;
    createdAt: string;
    completedAt: string | null;
}

export interface JobDetail extends JobListItem {
    characterId: string | null;
    stylePackId: string | null;
    negativePrompt: string | null;
    settingsJson: Record<string, unknown>;
    externalJobId: string | null;
    errorMessage: string | null;
    startedAt: string | null;
    failedAt: string | null;
    outputs: AssetInfo[];
}

// ─── Assets ──────────────────────────────────────────
export interface AssetInfo {
    id: string;
    kind: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    url: string;
    createdAt: string;
}

// ─── API Response Wrappers ───────────────────────────
export interface ApiResponse<T> {
    data: T;
    message?: string;
}

export interface ApiErrorResponse {
    error: string;
    message: string;
    statusCode: number;
}

export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

// ─── SSE Events ──────────────────────────────────────
export interface JobProgressEvent {
    jobId: string;
    status: JobStatus;
    progress?: number;
    message?: string;
    outputs?: AssetInfo[];
}
