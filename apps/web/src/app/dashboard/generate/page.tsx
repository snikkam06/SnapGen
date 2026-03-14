'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronDown,
  Download,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RefreshCw,
  Settings2,
  Sparkles,
  Upload,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import { cn, formatDate } from '@/lib/utils';

const generationModes = [
  {
    value: 'base',
    label: 'Base',
    description: 'Uses fal.ai Seedream 4.5 for text and image-to-image generation.',
    maxImages: 8,
  },
  {
    value: 'enhanced',
    label: 'Enhanced',
    description: 'Gemini-backed generation with stronger reference fidelity.',
    maxImages: 4,
  },
] as const;

const aspectRatios = [
  { value: '1:1', label: '1:1', width: 'w-8', height: 'h-8' },
  { value: '4:5', label: '4:5', width: 'w-7', height: 'h-8' },
  { value: '16:9', label: '16:9', width: 'w-10', height: 'h-6' },
  { value: '9:16', label: '9:16', width: 'w-5', height: 'h-8' },
];

type ImageMode = 'text' | 'edit';
type SourceMode = 'feed' | 'upload';

function getMaxImagesForMode(mode: 'base' | 'enhanced'): number {
  return generationModes.find((entry) => entry.value === mode)?.maxImages ?? 4;
}

interface Character {
  id: string;
  name: string;
}

interface AssetItem {
  id: string;
  kind: string;
  mimeType: string;
  url: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

interface AssetsResponse {
  data: AssetItem[];
}

interface JobOutput {
  id: string;
  url: string;
  mimeType: string;
}

interface JobDetail {
  id: string;
  status: string;
  errorMessage: string | null;
  outputs: JobOutput[];
}

export default function GeneratePage() {
  return (
    <Suspense
      fallback={
        <div className="page-header">
          <h1 className="page-title">Generate Images</h1>
        </div>
      }
    >
      <GeneratePageContent />
    </Suspense>
  );
}

function GeneratePageContent() {
  const searchParams = useSearchParams();
  const initialJobId = searchParams.get('job');
  const initialCharacterId = searchParams.get('characterId');
  const initialSourceAssetId = searchParams.get('sourceAssetId');
  const [imageMode, setImageMode] = useState<ImageMode>(initialSourceAssetId ? 'edit' : 'text');
  const [sourceMode, setSourceMode] = useState<SourceMode>(initialSourceAssetId ? 'feed' : 'feed');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedCharacterId, setSelectedCharacterId] = useState(initialCharacterId || '');
  const [generationMode, setGenerationMode] = useState<'base' | 'enhanced'>('base');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [numImages, setNumImages] = useState(4);
  const [guidance, setGuidance] = useState(7.0);
  const [seed, setSeed] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(initialJobId);
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null);
  const [jobTimedOut, setJobTimedOut] = useState(false);
  const [selectedFeedAssetId, setSelectedFeedAssetId] = useState<string | null>(
    initialSourceAssetId,
  );
  const [uploadedAsset, setUploadedAsset] = useState<AssetItem | null>(null);
  const [uploadedPreview, setUploadedPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tokenQuery = useApiToken();
  const queryClient = useQueryClient();
  const token = tokenQuery.data;

  useEffect(() => {
    setActiveJobId(initialJobId);
  }, [initialJobId]);

  useEffect(() => {
    setSelectedCharacterId(initialCharacterId || '');
  }, [initialCharacterId]);

  useEffect(() => {
    if (!initialSourceAssetId) {
      return;
    }

    setImageMode('edit');
    setSourceMode('feed');
    setSelectedFeedAssetId(initialSourceAssetId);
  }, [initialSourceAssetId]);

  useEffect(() => {
    const nextMaxImages = getMaxImagesForMode(generationMode);
    if (numImages > nextMaxImages) {
      setNumImages(nextMaxImages);
    }
  }, [generationMode, numImages]);

  const charactersQuery = useQuery({
    queryKey: ['characters', token],
    enabled: !!token,
    queryFn: () => api.getCharacters(token as string) as Promise<Character[]>,
  });

  const assetsQuery = useQuery({
    queryKey: ['assets', token, 'image-sources'],
    enabled: !!token && imageMode === 'edit',
    queryFn: () => api.getAssets(token as string, { limit: '60' }) as Promise<AssetsResponse>,
  });

  const sourceAssets = useMemo(() => {
    const assets = assetsQuery.data?.data || [];
    return assets.filter(
      (asset) => asset.mimeType.startsWith('image/') && asset.kind !== 'dataset-image',
    );
  }, [assetsQuery.data]);

  const selectedFeedAsset = useMemo(
    () => sourceAssets.find((asset) => asset.id === selectedFeedAssetId) || null,
    [selectedFeedAssetId, sourceAssets],
  );

  const activeSourceAssetId =
    imageMode === 'edit'
      ? sourceMode === 'feed'
        ? selectedFeedAssetId
        : uploadedAsset?.id || null
      : null;

  const activeSourcePreview =
    imageMode === 'edit'
      ? sourceMode === 'feed'
        ? selectedFeedAsset?.url || null
        : uploadedPreview || uploadedAsset?.url || null
      : null;

  const activeSourceMeta =
    imageMode === 'edit'
      ? sourceMode === 'feed'
        ? selectedFeedAsset
        : uploadedAsset
      : null;

  const jobQuery = useQuery({
    queryKey: ['job', token, activeJobId],
    enabled: !!token && !!activeJobId,
    refetchInterval: (query) => {
      const status = (query.state.data as JobDetail | undefined)?.status;
      if (status === 'completed' || status === 'failed') return false;
      if (jobStartedAt && Date.now() - jobStartedAt > 5 * 60 * 1000) {
        setJobTimedOut(true);
        return false;
      }
      return 4000;
    },
    queryFn: () => api.getJob(token as string, activeJobId as string) as Promise<JobDetail>,
  });

  const uploadSourceMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!token) throw new Error('Authentication token unavailable');
      return api.uploadImageAsset(token, file) as Promise<AssetItem>;
    },
    onSuccess: async (asset) => {
      setUploadedAsset(asset);
      setUploadedPreview(asset.url);
      toast.success('Source image uploaded');
      await queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (error) => {
      setUploadedAsset(null);
      setUploadedPreview(null);
      toast.error(error instanceof Error ? error.message : 'Failed to upload source image');
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!token) {
        throw new Error('Authentication token unavailable');
      }

      return api.generateImage(token, {
        characterId: selectedCharacterId || undefined,
        mode: generationMode,
        prompt,
        negativePrompt: negativePrompt || undefined,
        sourceAssetId: imageMode === 'edit' ? activeSourceAssetId || undefined : undefined,
        settings: {
          aspectRatio,
          numImages,
          guidance,
          ...(seed ? { seed: Number(seed) } : {}),
        },
      }) as Promise<{ id: string }>;
    },
    onSuccess: async (job) => {
      setActiveJobId(job.id);
      setJobStartedAt(Date.now());
      setJobTimedOut(false);
      toast.success(imageMode === 'edit' ? 'Image edit started' : 'Image generation started');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['jobs'] }),
        queryClient.invalidateQueries({ queryKey: ['assets'] }),
      ]);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to start generation');
    },
  });

  const generatedImages = useMemo(() => jobQuery.data?.outputs || [], [jobQuery.data?.outputs]);
  const isGenerating =
    generateMutation.isPending ||
    jobQuery.data?.status === 'queued' ||
    jobQuery.data?.status === 'running';
  const maxImages = getMaxImagesForMode(generationMode);
  const canGenerate = Boolean(prompt.trim()) && (imageMode === 'text' || Boolean(activeSourceAssetId));

  const handleSelectFeedAsset = (assetId: string) => {
    setImageMode('edit');
    setSourceMode('feed');
    setSelectedFeedAssetId(assetId);
    setActiveJobId(null);
    setJobTimedOut(false);
  };

  const handleUploadFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      toast.error('Please upload a JPEG, PNG, or WebP image');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      toast.error('File size must be under 50MB');
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      setUploadedPreview(loadEvent.target?.result as string);
      setUploadedAsset(null);
      setImageMode('edit');
      setSourceMode('upload');
      setActiveJobId(null);
      setJobTimedOut(false);
      uploadSourceMutation.mutate(file);
    };
    reader.onerror = () => {
      toast.error('Failed to read file');
    };
    reader.readAsDataURL(file);
  };

  const clearUploadedSource = () => {
    setUploadedAsset(null);
    setUploadedPreview(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Generate Images</h1>
        <p className="page-description">
          Create from text, or edit one of your generated images and uploaded references.
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleUploadFile}
        className="hidden"
      />

      <div className="grid lg:grid-cols-[1fr,420px] gap-6">
        <div className="space-y-4">
          {isGenerating ? (
            <div className="glass-card aspect-square flex flex-col items-center justify-center gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin" />
                <Sparkles className="w-6 h-6 text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <p className="text-white/40 text-sm">
                {imageMode === 'edit' ? 'Editing your image...' : 'Generating your images...'}
              </p>
            </div>
          ) : jobTimedOut ? (
            <div className="glass-card aspect-[4/3] flex flex-col items-center justify-center gap-4 px-8 text-center">
              <ImageIcon className="w-16 h-16 text-yellow-400/40" />
              <p className="text-white/70 text-sm">
                Generation timed out after 5 minutes. The job may still be processing in the
                background.
              </p>
              <button
                onClick={() => {
                  setJobTimedOut(false);
                  setJobStartedAt(Date.now());
                  void jobQuery.refetch();
                }}
                className="btn-secondary text-sm"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry Polling
              </button>
            </div>
          ) : jobQuery.data?.status === 'failed' ? (
            <div className="glass-card aspect-[4/3] flex flex-col items-center justify-center gap-4 px-8 text-center">
              <ImageIcon className="w-16 h-16 text-red-400/40" />
              <p className="text-white/70 text-sm">
                {jobQuery.data.errorMessage || 'Generation failed'}
              </p>
            </div>
          ) : generatedImages.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {generatedImages.map((image) => (
                <div
                  key={image.id}
                  className="glass-card overflow-hidden group relative aspect-square"
                >
                  <img src={image.url} alt="Generated" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/dashboard/generate?sourceAssetId=${image.id}`}
                        className="btn-ghost px-3 py-2 bg-black/40 backdrop-blur-sm rounded-lg text-xs font-medium"
                      >
                        <Pencil className="w-4 h-4 mr-1.5" />
                        Edit
                      </Link>
                      <Link
                        href={`/dashboard/video?sourceAssetId=${image.id}`}
                        className="btn-ghost px-3 py-2 bg-black/40 backdrop-blur-sm rounded-lg text-xs font-medium"
                      >
                        <Video className="w-4 h-4 mr-1.5" />
                        Animate
                      </Link>
                      <a
                        href={image.url}
                        target="_blank"
                        rel="noreferrer"
                        className="btn-ghost p-2 bg-black/40 backdrop-blur-sm rounded-lg"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : imageMode === 'edit' && activeSourcePreview ? (
            <div className="glass-card overflow-hidden">
              <div className="aspect-[4/3] bg-black/40 flex items-center justify-center p-4">
                <img
                  src={activeSourcePreview}
                  alt="Selected source"
                  className="max-w-full max-h-full object-contain rounded-xl"
                />
              </div>
              <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">Editing source image</p>
                  <p className="text-xs text-white/45 truncate">
                    {activeSourceMeta
                      ? `${activeSourceMeta.kind} • ${formatDate(activeSourceMeta.createdAt)}`
                      : 'Ready for prompt-guided edits'}
                  </p>
                </div>
                {uploadSourceMutation.isPending && sourceMode === 'upload' ? (
                  <div className="flex items-center gap-2 text-xs text-white/50">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Uploading...
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-green-300">
                    <CheckCircle2 className="w-4 h-4" />
                    Ready
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="glass-card aspect-[4/3] flex flex-col items-center justify-center gap-4">
              <ImageIcon className="w-16 h-16 text-white/10" />
              <p className="text-white/30 text-sm">
                {imageMode === 'edit'
                  ? 'Choose an image to edit'
                  : 'Your generated images will appear here'}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="glass-card p-4 space-y-5">
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">
                Generation Type
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setImageMode('text')}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                    imageMode === 'text'
                      ? 'bg-purple-600/30 border-purple-500/50 text-white'
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10',
                  )}
                >
                  Text to Image
                </button>
                <button
                  onClick={() => setImageMode('edit')}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                    imageMode === 'edit'
                      ? 'bg-purple-600/30 border-purple-500/50 text-white'
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10',
                  )}
                >
                  Edit Image
                </button>
              </div>
            </div>

            {imageMode === 'edit' && (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-white/60">Source Image</label>
                    <span className="text-xs text-white/35">Required</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setSourceMode('feed')}
                      className={cn(
                        'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                        sourceMode === 'feed'
                          ? 'bg-purple-600/30 border-purple-500/50 text-white'
                          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10',
                      )}
                    >
                      From Feed
                    </button>
                    <button
                      onClick={() => setSourceMode('upload')}
                      className={cn(
                        'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                        sourceMode === 'upload'
                          ? 'bg-purple-600/30 border-purple-500/50 text-white'
                          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10',
                      )}
                    >
                      Upload
                    </button>
                  </div>
                </div>

                {sourceMode === 'feed' ? (
                  assetsQuery.isPending ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/45">
                      Loading your images...
                    </div>
                  ) : sourceAssets.length > 0 ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
                        {sourceAssets.map((asset) => {
                          const isSelected = asset.id === selectedFeedAssetId;

                          return (
                            <button
                              key={asset.id}
                              onClick={() => handleSelectFeedAsset(asset.id)}
                              className={cn(
                                'group relative aspect-square overflow-hidden rounded-xl border transition-all',
                                isSelected
                                  ? 'border-purple-400 shadow-[0_0_0_1px_rgba(168,85,247,0.45)]'
                                  : 'border-white/10 hover:border-white/25',
                              )}
                            >
                              <img
                                src={asset.url}
                                alt="Source option"
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                              />
                              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-2 text-left">
                                <p className="text-[11px] text-white/75 truncate">{asset.kind}</p>
                                <p className="text-[10px] text-white/45">
                                  {formatDate(asset.createdAt)}
                                </p>
                              </div>
                              {isSelected && (
                                <div className="absolute top-2 right-2 rounded-full bg-black/70 p-1">
                                  <CheckCircle2 className="w-4 h-4 text-green-300" />
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-white/40">
                        Pick a generated or uploaded image, then describe the changes you want.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-white/55 space-y-3">
                      <p>No feed images yet. Generate one first or upload your own.</p>
                      <button
                        onClick={() => setImageMode('text')}
                        className="btn-secondary inline-flex text-sm"
                      >
                        Generate Images
                      </button>
                    </div>
                  )
                ) : (
                  <div className="space-y-3">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-4 text-left transition-colors hover:bg-white/[0.05]"
                    >
                      {uploadedPreview ? (
                        <div className="space-y-3">
                          <div className="aspect-[4/3] overflow-hidden rounded-xl bg-black/40 flex items-center justify-center">
                            <img
                              src={uploadedPreview}
                              alt="Uploaded source"
                              className="max-w-full max-h-full object-contain"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white">Uploaded source image</p>
                              <p className="text-xs text-white/40">
                                {uploadSourceMutation.isPending
                                  ? 'Uploading image...'
                                  : 'Click to replace this image'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {uploadedPreview && !uploadSourceMutation.isPending && (
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    clearUploadedSource();
                                  }}
                                  className="rounded-lg border border-white/10 bg-black/30 p-2 text-white/60 hover:text-white"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                              <div className="rounded-lg border border-white/10 bg-black/30 p-2 text-white/75">
                                {uploadSourceMutation.isPending ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Upload className="w-4 h-4" />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="rounded-xl bg-white/5 p-3">
                            <Upload className="w-5 h-5 text-white/60" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">
                              Upload a source image
                            </p>
                            <p className="text-xs text-white/40">
                              JPEG, PNG, or WebP up to 50MB
                            </p>
                          </div>
                        </div>
                      )}
                    </button>
                    <p className="text-xs text-white/40">
                      Uploaded images are saved to your feed so you can reuse them later.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-white/60">
                  {imageMode === 'edit' ? 'Edit Prompt' : 'Prompt'}
                </label>
                <span className="text-xs text-white/35">Required</span>
              </div>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  imageMode === 'edit'
                    ? 'Describe the changes you want... e.g., change the pose, add dramatic lighting, keep the same subject'
                    : 'Describe your image... e.g., editorial portrait in a luxury hotel lobby, dramatic lighting'
                }
                rows={4}
                className="input-field resize-none"
              />
              <p className="mt-2 text-xs text-white/40">
                {imageMode === 'edit'
                  ? 'Editing uses the selected source image as the visual reference and your prompt as the change request.'
                  : 'Use prompt text alone to generate a fresh image set.'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">
                Generation Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                {generationModes.map((mode) => {
                  return (
                    <button
                      key={mode.value}
                      onClick={() => setGenerationMode(mode.value)}
                      className={cn(
                        'rounded-lg border px-3 py-3 text-left transition-all',
                        generationMode === mode.value
                          ? 'bg-purple-600/30 border-purple-500/50 text-white'
                          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10',
                      )}
                    >
                      <div className="text-sm font-medium">{mode.label}</div>
                      <div className="mt-1 text-xs text-white/50">{mode.description}</div>
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-white/40">
                {imageMode === 'edit'
                  ? generationMode === 'base'
                    ? 'Base edit mode uses fal.ai Seedream 4.5 image-to-image with your selected source image.'
                    : 'Enhanced edit mode uses Gemini reference-guided generation.'
                  : generationMode === 'enhanced'
                    ? 'Enhanced mode is capped at 4 images per job because Gemini returns up to 4 outputs.'
                    : 'Base mode supports up to 8 images per job through fal.ai Seedream 4.5.'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Character</label>
              <select
                className="input-field"
                value={selectedCharacterId}
                onChange={(event) => setSelectedCharacterId(event.target.value)}
              >
                <option value="">No character selected</option>
                {(charactersQuery.data || []).map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-white/40">
                Character references stack with edit mode when you want to push closer to a saved
                character identity.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Aspect Ratio</label>
              <div className="flex gap-2">
                {aspectRatios.map((ratio) => (
                  <button
                    key={ratio.value}
                    onClick={() => setAspectRatio(ratio.value)}
                    className={cn(
                      'flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-xs transition-all',
                      aspectRatio === ratio.value
                        ? 'bg-purple-600/30 border border-purple-500/50 text-white'
                        : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10',
                    )}
                  >
                    <div
                      className={cn(ratio.width, ratio.height, 'border border-current rounded-sm')}
                    />
                    <span>{ratio.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">
                Number of Images: {numImages}
              </label>
              <input
                type="range"
                min="1"
                max={maxImages}
                value={numImages}
                onChange={(event) => setNumImages(Number(event.target.value))}
                className="w-full accent-purple-500"
              />
            </div>

            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-white/40 hover:text-white/60 transition-colors"
            >
              <Settings2 className="w-4 h-4" />
              Advanced Settings
              <ChevronDown
                className={cn('w-4 h-4 transition-transform', showAdvanced && 'rotate-180')}
              />
            </button>

            {showAdvanced && (
              <div className="space-y-3 pt-2 border-t border-white/5">
                <div>
                  <label className="block text-sm font-medium text-white/60 mb-2">
                    Negative Prompt
                  </label>
                  <textarea
                    value={negativePrompt}
                    onChange={(event) => setNegativePrompt(event.target.value)}
                    placeholder="What to avoid... e.g., blurry, deformed, low quality"
                    rows={2}
                    className="input-field resize-none text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/60 mb-2">
                    Guidance Scale: {guidance}
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    step="0.5"
                    value={guidance}
                    onChange={(event) => setGuidance(Number(event.target.value))}
                    className="w-full accent-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/60 mb-2">
                    Seed (optional)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={seed}
                    onChange={(event) => setSeed(event.target.value)}
                    onKeyDown={(event) => {
                      if (['-', '.', 'e', 'E'].includes(event.key)) event.preventDefault();
                    }}
                    placeholder="Random"
                    className="input-field text-sm"
                  />
                </div>
              </div>
            )}

            <button
              onClick={() => generateMutation.mutate()}
              disabled={!canGenerate || isGenerating || uploadSourceMutation.isPending}
              className={cn(
                'btn-primary w-full py-4 text-base',
                canGenerate && !isGenerating && !uploadSourceMutation.isPending && 'animate-pulse-glow',
              )}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  {imageMode === 'edit' ? 'Editing...' : 'Generating...'}
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5 mr-2" />
                  {imageMode === 'edit'
                    ? `Edit Image (${numImages * 5} credits)`
                    : `Generate (${numImages * 5} credits)`}
                </>
              )}
            </button>

            {imageMode === 'edit' && sourceMode === 'feed' && !selectedFeedAssetId && (
              <p className="text-xs text-center text-white/40">
                Select an image from your feed before editing.
              </p>
            )}

            {imageMode === 'edit' && sourceMode === 'upload' && !uploadedAsset && (
              <p className="text-xs text-center text-white/40">
                Upload an image before editing.
              </p>
            )}

            {activeJobId && (
              <button onClick={() => void jobQuery.refetch()} className="btn-secondary w-full">
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh Current Job
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
