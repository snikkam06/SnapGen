'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import { cn, formatDate } from '@/lib/utils';

const aspectRatios = [
  { value: '9:16', label: '9:16' },
  { value: '16:9', label: '16:9' },
  { value: '1:1', label: '1:1' },
];

const durations = [
  { value: 5, label: '5s' },
  { value: 10, label: '10s' },
];

const cameraControls = [
  { value: 'none', label: 'None' },
  { value: 'zoom_in', label: 'Zoom In' },
  { value: 'zoom_out', label: 'Zoom Out' },
  { value: 'pan_left', label: 'Pan Left' },
  { value: 'pan_right', label: 'Pan Right' },
  { value: 'tilt_up', label: 'Tilt Up' },
  { value: 'tilt_down', label: 'Tilt Down' },
];

type VideoMode = 'text' | 'image';
type SourceMode = 'feed' | 'upload';

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
  kind?: string;
  url: string;
  mimeType: string;
}

interface JobDetail {
  id: string;
  status: string;
  errorMessage: string | null;
  outputs: JobOutput[];
}

export default function VideoPage() {
  return (
    <Suspense
      fallback={
        <div className="page-header">
          <h1 className="page-title">Generate Video</h1>
        </div>
      }
    >
      <VideoPageContent />
    </Suspense>
  );
}

function VideoPageContent() {
  const searchParams = useSearchParams();
  const initialJobId = searchParams.get('job');
  const initialSourceAssetId = searchParams.get('sourceAssetId');
  const [videoMode, setVideoMode] = useState<VideoMode>(initialSourceAssetId ? 'image' : 'text');
  const [sourceMode, setSourceMode] = useState<SourceMode>(initialSourceAssetId ? 'feed' : 'feed');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [durationSec, setDurationSec] = useState(5);
  const [motionAmount, setMotionAmount] = useState(5);
  const [cameraControl, setCameraControl] = useState('none');
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
    if (!initialSourceAssetId) {
      return;
    }

    setVideoMode('image');
    setSourceMode('feed');
    setSelectedFeedAssetId(initialSourceAssetId);
  }, [initialSourceAssetId]);

  const assetsQuery = useQuery({
    queryKey: ['assets', token, 'video-sources'],
    enabled: !!token && videoMode === 'image',
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
    videoMode === 'image'
      ? sourceMode === 'feed'
        ? selectedFeedAssetId
        : uploadedAsset?.id || null
      : null;

  const activeSourcePreview =
    videoMode === 'image'
      ? sourceMode === 'feed'
        ? selectedFeedAsset?.url || null
        : uploadedPreview || uploadedAsset?.url || null
      : null;

  const activeSourceMeta =
    videoMode === 'image'
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
      if (!token) throw new Error('Authentication token unavailable');
      return api.generateVideo(token, {
        prompt: prompt.trim(),
        sourceAssetId: videoMode === 'image' ? activeSourceAssetId || undefined : undefined,
        settings: {
          aspectRatio,
          durationSec,
          motionAmount,
          cameraControl: cameraControl !== 'none' ? cameraControl : undefined,
        },
      }) as Promise<{ id: string }>;
    },
    onSuccess: async (job) => {
      setActiveJobId(job.id);
      setJobStartedAt(Date.now());
      setJobTimedOut(false);
      toast.success('Video generation started');
      await queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to start video generation');
    },
  });

  const videoOutput = useMemo(() => {
    const outputs = jobQuery.data?.outputs || [];
    return outputs.find((output) => output.mimeType.startsWith('video/'));
  }, [jobQuery.data?.outputs]);

  const isGenerating =
    generateMutation.isPending ||
    jobQuery.data?.status === 'queued' ||
    jobQuery.data?.status === 'running';
  const canGenerate =
    videoMode === 'text' ? Boolean(prompt.trim()) : Boolean(activeSourceAssetId);

  const handleSelectFeedAsset = (assetId: string) => {
    setVideoMode('image');
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
      setVideoMode('image');
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
        <h1 className="page-title">Generate Video</h1>
        <p className="page-description">
          Keep text-to-video, or animate one of your images from the feed or an upload.
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
            <div className="glass-card aspect-video flex flex-col items-center justify-center gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin" />
                <Video className="w-6 h-6 text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <p className="text-white/40 text-sm">Generating your video...</p>
            </div>
          ) : jobTimedOut ? (
            <div className="glass-card aspect-video flex flex-col items-center justify-center gap-4 px-8 text-center">
              <ImageIcon className="w-16 h-16 text-yellow-400/40" />
              <p className="text-white/70 text-sm">
                Generation timed out after 5 minutes. The job may still be processing.
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
            <div className="glass-card aspect-video flex flex-col items-center justify-center gap-4 px-8 text-center">
              <Video className="w-16 h-16 text-red-400/40" />
              <p className="text-white/70 text-sm">
                {jobQuery.data.errorMessage || 'Video generation failed'}
              </p>
            </div>
          ) : videoOutput ? (
            <div className="glass-card overflow-hidden">
              <video
                src={videoOutput.url}
                controls
                autoPlay
                loop
                className="w-full aspect-video object-contain bg-black"
              />
            </div>
          ) : activeSourcePreview ? (
            <div className="glass-card overflow-hidden">
              <div className="aspect-video bg-black/40 flex items-center justify-center p-4">
                <img
                  src={activeSourcePreview}
                  alt="Selected source"
                  className="max-w-full max-h-full object-contain rounded-xl"
                />
              </div>
              <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">Selected source image</p>
                  <p className="text-xs text-white/45 truncate">
                    {activeSourceMeta
                      ? `${activeSourceMeta.kind} • ${formatDate(activeSourceMeta.createdAt)}`
                      : 'Ready for image-to-video generation'}
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
            <div className="glass-card aspect-video flex flex-col items-center justify-center gap-4">
              <Video className="w-16 h-16 text-white/10" />
              <p className="text-white/30 text-sm">
                {videoMode === 'image'
                  ? 'Choose a source image to animate'
                  : 'Your generated video will appear here'}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="glass-card p-4 space-y-5">
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">
                Generation Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setVideoMode('text')}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                    videoMode === 'text'
                      ? 'bg-purple-600/30 border-purple-500/50 text-white'
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10',
                  )}
                >
                  Text to Video
                </button>
                <button
                  onClick={() => setVideoMode('image')}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                    videoMode === 'image'
                      ? 'bg-purple-600/30 border-purple-500/50 text-white'
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10',
                  )}
                >
                  Image to Video
                </button>
              </div>
            </div>

            {videoMode === 'image' && (
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
                        Pick any generated or previously uploaded image to animate.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-white/55 space-y-3">
                      <p>No feed images yet. Generate an image first or upload your own.</p>
                      <Link href="/dashboard/generate" className="btn-secondary inline-flex text-sm">
                        Generate Images
                      </Link>
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
                  {videoMode === 'text' ? 'Prompt' : 'Motion Prompt'}
                </label>
                <span className="text-xs text-white/35">
                  {videoMode === 'text' ? 'Required' : 'Optional'}
                </span>
              </div>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  videoMode === 'text'
                    ? 'Describe your video... e.g., cinematic slow motion, golden sunset, shallow depth of field'
                    : 'Optional: describe motion, camera movement, or timing cues for the selected image'
                }
                rows={4}
                className="input-field resize-none"
              />
              <p className="mt-2 text-xs text-white/40">
                {videoMode === 'text'
                  ? 'Use text alone to create the full scene.'
                  : 'Leave this blank if you just want the image animated without extra direction.'}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Duration</label>
              <div className="flex gap-2">
                {durations.map((duration) => (
                  <button
                    key={duration.value}
                    onClick={() => setDurationSec(duration.value)}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                      durationSec === duration.value
                        ? 'bg-purple-600/30 border border-purple-500/50 text-white'
                        : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10',
                    )}
                  >
                    {duration.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Aspect Ratio</label>
              <div className="flex gap-2">
                {aspectRatios.map((ratio) => (
                  <button
                    key={ratio.value}
                    onClick={() => setAspectRatio(ratio.value)}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                      aspectRatio === ratio.value
                        ? 'bg-purple-600/30 border border-purple-500/50 text-white'
                        : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10',
                    )}
                  >
                    {ratio.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">
                Motion Amount: {motionAmount}
              </label>
              <input
                type="range"
                min="0"
                max="10"
                value={motionAmount}
                onChange={(event) => setMotionAmount(Number(event.target.value))}
                className="w-full accent-purple-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">
                Camera Control
              </label>
              <select
                value={cameraControl}
                onChange={(event) => setCameraControl(event.target.value)}
                className="input-field"
              >
                {cameraControls.map((control) => (
                  <option key={control.value} value={control.value}>
                    {control.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => generateMutation.mutate()}
              disabled={!canGenerate || isGenerating || uploadSourceMutation.isPending}
              className="btn-primary w-full py-4 text-base animate-pulse-glow"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Video className="w-5 h-5 mr-2" />
                  Generate Video (25 credits)
                </>
              )}
            </button>

            {videoMode === 'image' && sourceMode === 'feed' && !selectedFeedAssetId && (
              <p className="text-xs text-center text-white/40">
                Select an image from your feed before generating.
              </p>
            )}

            {videoMode === 'image' && sourceMode === 'upload' && !uploadedAsset && (
              <p className="text-xs text-center text-white/40">
                Upload an image before generating.
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
