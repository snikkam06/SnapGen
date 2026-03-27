'use client';
/* eslint-disable @next/next/no-img-element */

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

const characterOrientations = [
  { value: 'image', label: 'Match Source Image' },
  { value: 'video', label: 'Match Reference Video' },
];

const JOB_STATUS_FALLBACK_POLL_MS = 5000;
const JOB_STATUS_TIMEOUT_MS = 15 * 60 * 1000;
const MOTION_CONTROL_CREDITS_PER_SECOND = {
  withAudio: 38,
  withoutAudio: 26,
} as const;
const MAX_REFERENCE_VIDEO_DURATION_SEC = 10;

type VideoMode = 'text' | 'image';
type SourceMode = 'feed' | 'upload';
type VideoWorkflow = 'standard' | 'motion-control';
type CharacterOrientation = 'image' | 'video';

interface AssetItem {
  id: string;
  kind: string;
  mimeType: string;
  url: string;
  width: number | null;
  height: number | null;
  durationSec?: number | null;
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
  const [videoWorkflow, setVideoWorkflow] = useState<VideoWorkflow>('standard');
  const [videoMode, setVideoMode] = useState<VideoMode>(initialSourceAssetId ? 'image' : 'text');
  const [sourceMode, setSourceMode] = useState<SourceMode>('feed');
  const [referenceVideoMode, setReferenceVideoMode] = useState<SourceMode>('feed');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [durationSec, setDurationSec] = useState(5);
  const [motionAmount, setMotionAmount] = useState(5);
  const [cameraControl, setCameraControl] = useState('none');
  const [characterOrientation, setCharacterOrientation] =
    useState<CharacterOrientation>('image');
  const [keepOriginalSound, setKeepOriginalSound] = useState(true);
  const [activeJobId, setActiveJobId] = useState<string | null>(initialJobId);
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null);
  const [jobTimedOut, setJobTimedOut] = useState(false);
  const [selectedFeedAssetId, setSelectedFeedAssetId] = useState<string | null>(
    initialSourceAssetId,
  );
  const [selectedReferenceVideoAssetId, setSelectedReferenceVideoAssetId] = useState<string | null>(
    null,
  );
  const [uploadedSourceAsset, setUploadedSourceAsset] = useState<AssetItem | null>(null);
  const [uploadedSourcePreview, setUploadedSourcePreview] = useState<string | null>(null);
  const [uploadedReferenceVideoAsset, setUploadedReferenceVideoAsset] =
    useState<AssetItem | null>(null);
  const [uploadedReferenceVideoPreview, setUploadedReferenceVideoPreview] = useState<string | null>(
    null,
  );
  const [uploadedReferenceVideoDurationSec, setUploadedReferenceVideoDurationSec] =
    useState<number | null>(null);
  const [resolvedReferenceVideoDurationSec, setResolvedReferenceVideoDurationSec] =
    useState<number | null>(null);
  const [isResolvingReferenceVideoDuration, setIsResolvingReferenceVideoDuration] =
    useState(false);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const referenceVideoInputRef = useRef<HTMLInputElement>(null);
  const tokenQuery = useApiToken();
  const queryClient = useQueryClient();
  const { getToken, isReady, userId } = tokenQuery;

  const requiresSourceImage = videoWorkflow === 'motion-control' || videoMode === 'image';
  const requiresReferenceVideo = videoWorkflow === 'motion-control';

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

  useEffect(() => {
    const previewUrl = uploadedReferenceVideoPreview;
    return () => {
      if (previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [uploadedReferenceVideoPreview]);

  const assetsQuery = useQuery({
    queryKey: ['assets', userId, 'video-sources'],
    enabled: isReady && (requiresSourceImage || requiresReferenceVideo),
    queryFn: () => api.getAssets(getToken, { limit: '60' }) as Promise<AssetsResponse>,
  });

  const sourceAssets = useMemo(() => {
    const assets = assetsQuery.data?.data || [];
    return assets.filter(
      (asset) => asset.mimeType.startsWith('image/') && asset.kind !== 'dataset-image',
    );
  }, [assetsQuery.data]);

  const referenceVideoAssets = useMemo(() => {
    const assets = assetsQuery.data?.data || [];
    return assets.filter((asset) => asset.mimeType.startsWith('video/'));
  }, [assetsQuery.data]);

  const selectedFeedAsset = useMemo(
    () => sourceAssets.find((asset) => asset.id === selectedFeedAssetId) || null,
    [selectedFeedAssetId, sourceAssets],
  );

  const selectedReferenceVideoAsset = useMemo(
    () => referenceVideoAssets.find((asset) => asset.id === selectedReferenceVideoAssetId) || null,
    [referenceVideoAssets, selectedReferenceVideoAssetId],
  );

  const activeSourceAssetId = requiresSourceImage
    ? sourceMode === 'feed'
      ? selectedFeedAssetId
      : uploadedSourceAsset?.id || null
    : null;

  const activeSourcePreview = requiresSourceImage
    ? sourceMode === 'feed'
      ? selectedFeedAsset?.url || null
      : uploadedSourcePreview || uploadedSourceAsset?.url || null
    : null;

  const activeSourceMeta = requiresSourceImage
    ? sourceMode === 'feed'
      ? selectedFeedAsset
      : uploadedSourceAsset
    : null;

  const activeReferenceVideoAssetId = requiresReferenceVideo
    ? referenceVideoMode === 'feed'
      ? selectedReferenceVideoAssetId
      : uploadedReferenceVideoAsset?.id || null
    : null;

  const activeReferenceVideoPreview = requiresReferenceVideo
    ? referenceVideoMode === 'feed'
      ? selectedReferenceVideoAsset?.url || null
      : uploadedReferenceVideoPreview || uploadedReferenceVideoAsset?.url || null
    : null;

  const activeReferenceVideoMeta = requiresReferenceVideo
    ? referenceVideoMode === 'feed'
      ? selectedReferenceVideoAsset
      : uploadedReferenceVideoAsset
    : null;

  const activeReferenceVideoDurationSec = requiresReferenceVideo
    ? typeof activeReferenceVideoMeta?.durationSec === 'number' && activeReferenceVideoMeta.durationSec > 0
      ? activeReferenceVideoMeta.durationSec
      : referenceVideoMode === 'upload'
        ? uploadedReferenceVideoDurationSec ?? resolvedReferenceVideoDurationSec
        : resolvedReferenceVideoDurationSec
    : null;

  useEffect(() => {
    if (!requiresReferenceVideo) {
      setResolvedReferenceVideoDurationSec(null);
      setIsResolvingReferenceVideoDuration(false);
      return;
    }

    if (
      typeof activeReferenceVideoMeta?.durationSec === 'number'
      && activeReferenceVideoMeta.durationSec > 0
    ) {
      setResolvedReferenceVideoDurationSec(activeReferenceVideoMeta.durationSec);
      setIsResolvingReferenceVideoDuration(false);
      return;
    }

    if (
      referenceVideoMode === 'upload'
      && typeof uploadedReferenceVideoDurationSec === 'number'
      && uploadedReferenceVideoDurationSec > 0
    ) {
      setResolvedReferenceVideoDurationSec(uploadedReferenceVideoDurationSec);
      setIsResolvingReferenceVideoDuration(false);
      return;
    }

    if (!activeReferenceVideoPreview) {
      setResolvedReferenceVideoDurationSec(null);
      setIsResolvingReferenceVideoDuration(false);
      return;
    }

    let isCancelled = false;
    setIsResolvingReferenceVideoDuration(true);
    setResolvedReferenceVideoDurationSec(null);

    void resolveVideoDurationSec(activeReferenceVideoPreview)
      .then((resolvedDurationSec) => {
        if (!isCancelled) {
          setResolvedReferenceVideoDurationSec(resolvedDurationSec);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setResolvedReferenceVideoDurationSec(null);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsResolvingReferenceVideoDuration(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [
    activeReferenceVideoMeta?.durationSec,
    activeReferenceVideoPreview,
    referenceVideoMode,
    requiresReferenceVideo,
    uploadedReferenceVideoDurationSec,
  ]);

  const jobQuery = useQuery({
    queryKey: ['job', userId, activeJobId],
    enabled: isReady && !!activeJobId,
    refetchInterval: (query) => {
      const status = (query.state.data as JobDetail | undefined)?.status;
      if (status === 'completed' || status === 'failed') return false;
      if (jobStartedAt && Date.now() - jobStartedAt > JOB_STATUS_TIMEOUT_MS) {
        setJobTimedOut(true);
        return false;
      }
      return JOB_STATUS_FALLBACK_POLL_MS;
    },
    queryFn: () => api.getJob(getToken, activeJobId as string) as Promise<JobDetail>,
  });

  const uploadSourceMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!isReady) throw new Error('Authentication token unavailable');
      return api.uploadImageAsset(getToken, file) as Promise<AssetItem>;
    },
    onSuccess: async (asset) => {
      setUploadedSourceAsset(asset);
      setUploadedSourcePreview(asset.url);
      toast.success('Source image uploaded');
      await queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (error) => {
      setUploadedSourceAsset(null);
      setUploadedSourcePreview(null);
      toast.error(error instanceof Error ? error.message : 'Failed to upload source image');
    },
  });

  const uploadReferenceVideoMutation = useMutation({
    mutationFn: async (variables: { file: File; durationSec: number }) => {
      if (!isReady) throw new Error('Authentication token unavailable');
      return api.uploadVideoAsset(getToken, variables.file, {
        durationSec: variables.durationSec,
      }) as Promise<AssetItem>;
    },
    onSuccess: async (asset, variables) => {
      setUploadedReferenceVideoAsset(asset);
      setUploadedReferenceVideoPreview(asset.url);
      setUploadedReferenceVideoDurationSec(asset.durationSec ?? variables.durationSec);
      toast.success('Reference video uploaded');
      await queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (error) => {
      if (uploadedReferenceVideoPreview?.startsWith('blob:')) {
        URL.revokeObjectURL(uploadedReferenceVideoPreview);
      }

      setUploadedReferenceVideoAsset(null);
      setUploadedReferenceVideoPreview(null);
      setUploadedReferenceVideoDurationSec(null);
      toast.error(error instanceof Error ? error.message : 'Failed to upload reference video');
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!isReady) throw new Error('Authentication token unavailable');
      return api.generateVideo(getToken, {
        prompt: prompt.trim(),
        sourceAssetId: activeSourceAssetId || undefined,
        referenceVideoAssetId: activeReferenceVideoAssetId || undefined,
        settings: {
          workflow: videoWorkflow,
          ...(videoWorkflow === 'motion-control'
            ? {
                referenceVideoDurationSec: activeReferenceVideoDurationSec || undefined,
                characterOrientation,
                keepOriginalSound,
              }
            : {
                aspectRatio,
                durationSec,
                motionAmount,
                cameraControl: cameraControl !== 'none' ? cameraControl : undefined,
              }),
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
  const isUploadingSource = uploadSourceMutation.isPending;
  const isUploadingReferenceVideo = uploadReferenceVideoMutation.isPending;
  const hasImageToVideoDirection = Boolean(prompt.trim()) || cameraControl !== 'none';
  const isReferenceVideoTooLong =
    typeof activeReferenceVideoDurationSec === 'number'
    && activeReferenceVideoDurationSec > MAX_REFERENCE_VIDEO_DURATION_SEC;
  const motionControlCredits =
    typeof activeReferenceVideoDurationSec === 'number' && activeReferenceVideoDurationSec > 0
      ? calculateMotionControlCredits(activeReferenceVideoDurationSec, keepOriginalSound)
      : null;
  const canGenerate =
    videoWorkflow === 'motion-control'
      ? Boolean(
          activeSourceAssetId
          && activeReferenceVideoAssetId
          && motionControlCredits
          && !isReferenceVideoTooLong,
        )
      : videoMode === 'text'
        ? Boolean(prompt.trim())
        : Boolean(activeSourceAssetId && hasImageToVideoDirection);

  const handleSelectFeedAsset = (assetId: string) => {
    setVideoMode('image');
    setSourceMode('feed');
    setSelectedFeedAssetId(assetId);
    setActiveJobId(null);
    setJobTimedOut(false);
  };

  const handleSelectReferenceVideoAsset = (assetId: string) => {
    setReferenceVideoMode('feed');
    setSelectedReferenceVideoAssetId(assetId);
    setActiveJobId(null);
    setJobTimedOut(false);
  };

  const handleUploadSourceFile = (event: React.ChangeEvent<HTMLInputElement>) => {
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
      setUploadedSourcePreview(loadEvent.target?.result as string);
      setUploadedSourceAsset(null);
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

  const handleUploadReferenceVideoFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const validTypes = ['video/mp4', 'video/webm'];
    if (!validTypes.includes(file.type)) {
      toast.error('Please upload an MP4 or WebM video');
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      toast.error('File size must be under 50MB');
      return;
    }

    const previewUrl = URL.createObjectURL(file);

    try {
      const resolvedDurationSec = await resolveVideoDurationSec(previewUrl);
      if (resolvedDurationSec > MAX_REFERENCE_VIDEO_DURATION_SEC) {
        throw new Error('Reference videos must be 10 seconds or shorter');
      }

      if (uploadedReferenceVideoPreview?.startsWith('blob:')) {
        URL.revokeObjectURL(uploadedReferenceVideoPreview);
      }

      setUploadedReferenceVideoPreview(previewUrl);
      setUploadedReferenceVideoDurationSec(resolvedDurationSec);
      setUploadedReferenceVideoAsset(null);
      setReferenceVideoMode('upload');
      setActiveJobId(null);
      setJobTimedOut(false);
      uploadReferenceVideoMutation.mutate({ file, durationSec: resolvedDurationSec });
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      if (referenceVideoInputRef.current) {
        referenceVideoInputRef.current.value = '';
      }
      toast.error(error instanceof Error ? error.message : 'Failed to read video duration');
    }
  };

  const clearUploadedSource = () => {
    setUploadedSourceAsset(null);
    setUploadedSourcePreview(null);
    if (imageFileInputRef.current) {
      imageFileInputRef.current.value = '';
    }
  };

  const clearUploadedReferenceVideo = () => {
    if (uploadedReferenceVideoPreview?.startsWith('blob:')) {
      URL.revokeObjectURL(uploadedReferenceVideoPreview);
    }

    setUploadedReferenceVideoAsset(null);
    setUploadedReferenceVideoPreview(null);
    setUploadedReferenceVideoDurationSec(null);
    if (referenceVideoInputRef.current) {
      referenceVideoInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Generate Video</h1>
        <p className="page-description">
          Create standard text or image-driven clips, or transfer motion from a reference video
          onto a source image with Kling Motion Control.
        </p>
      </div>

      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleUploadSourceFile}
        className="hidden"
      />

      <input
        ref={referenceVideoInputRef}
        type="file"
        accept="video/mp4,video/webm"
        onChange={handleUploadReferenceVideoFile}
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
                Generation timed out after 15 minutes. The job may still be processing.
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
          ) : videoWorkflow === 'motion-control' && (activeSourcePreview || activeReferenceVideoPreview) ? (
            <div className="glass-card overflow-hidden">
              <div className="grid gap-3 p-4 md:grid-cols-2">
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                  <div className="aspect-[4/3] flex items-center justify-center bg-black/40 p-4">
                    {activeSourcePreview ? (
                      <img
                        src={activeSourcePreview}
                        alt="Selected source"
                        className="max-w-full max-h-full object-contain rounded-xl"
                      />
                    ) : (
                      <p className="text-sm text-white/30">Choose a source image</p>
                    )}
                  </div>
                  <div className="border-t border-white/10 px-4 py-3">
                    <p className="text-sm font-medium text-white">Source image</p>
                    <p className="text-xs text-white/45 truncate">
                      {activeSourceMeta
                        ? `${activeSourceMeta.kind} • ${formatDate(activeSourceMeta.createdAt)}`
                        : 'Required for motion control'}
                    </p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/30">
                  <div className="aspect-[4/3] bg-black flex items-center justify-center">
                    {activeReferenceVideoPreview ? (
                      <video
                        src={activeReferenceVideoPreview}
                        muted
                        loop
                        autoPlay
                        playsInline
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <p className="text-sm text-white/30">Choose a reference video</p>
                    )}
                  </div>
                  <div className="border-t border-white/10 px-4 py-3">
                    <p className="text-sm font-medium text-white">Reference video</p>
                    <p className="text-xs text-white/45 truncate">
                      {activeReferenceVideoMeta
                        ? `${activeReferenceVideoMeta.kind} • ${formatDate(activeReferenceVideoMeta.createdAt)}`
                        : 'Required for motion control'}
                    </p>
                  </div>
                </div>
              </div>
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
                {isUploadingSource && sourceMode === 'upload' ? (
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
                {videoWorkflow === 'motion-control'
                  ? 'Choose a source image and reference video'
                  : videoMode === 'image'
                    ? 'Choose a source image to animate'
                    : 'Your generated video will appear here'}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="glass-card p-4 space-y-5">
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Workflow</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setVideoWorkflow('standard')}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                    videoWorkflow === 'standard'
                      ? 'bg-purple-600/30 border-purple-500/50 text-white'
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10',
                  )}
                >
                  Standard Video
                </button>
                <button
                  onClick={() => setVideoWorkflow('motion-control')}
                  className={cn(
                    'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                    videoWorkflow === 'motion-control'
                      ? 'bg-purple-600/30 border-purple-500/50 text-white'
                      : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10',
                  )}
                >
                  Kling Motion Control
                </button>
              </div>
            </div>

            {videoWorkflow === 'standard' && (
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
            )}

            {requiresSourceImage && (
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
                        Pick any generated or previously uploaded image to use as the character
                        source.
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
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => imageFileInputRef.current?.click()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          imageFileInputRef.current?.click();
                        }
                      }}
                      className="w-full cursor-pointer rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-4 text-left transition-colors hover:bg-white/[0.05]"
                    >
                      {uploadedSourcePreview ? (
                        <div className="space-y-3">
                          <div className="aspect-[4/3] overflow-hidden rounded-xl bg-black/40 flex items-center justify-center">
                            <img
                              src={uploadedSourcePreview}
                              alt="Uploaded source"
                              className="max-w-full max-h-full object-contain"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white">Uploaded source image</p>
                              <p className="text-xs text-white/40">
                                {isUploadingSource
                                  ? 'Uploading image...'
                                  : 'Click to replace this image'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {uploadedSourcePreview && !isUploadingSource && (
                                <button
                                  type="button"
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
                                {isUploadingSource ? (
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
                            <p className="text-sm font-medium text-white">Upload a source image</p>
                            <p className="text-xs text-white/40">
                              JPEG, PNG, or WebP up to 50MB
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-white/40">
                      Uploaded images are saved to your feed so you can reuse them later.
                    </p>
                  </div>
                )}
              </div>
            )}

            {requiresReferenceVideo && (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-sm font-medium text-white/60">
                      Reference Video
                    </label>
                    <span className="text-xs text-white/35">Required</span>
                  </div>
                  <p className="mb-3 text-xs text-white/40">
                    Reference videos must be 10 seconds or shorter.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setReferenceVideoMode('feed')}
                      className={cn(
                        'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                        referenceVideoMode === 'feed'
                          ? 'bg-purple-600/30 border-purple-500/50 text-white'
                          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10',
                      )}
                    >
                      From Feed
                    </button>
                    <button
                      onClick={() => setReferenceVideoMode('upload')}
                      className={cn(
                        'rounded-xl border px-4 py-3 text-sm font-medium transition-all',
                        referenceVideoMode === 'upload'
                          ? 'bg-purple-600/30 border-purple-500/50 text-white'
                          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10',
                      )}
                    >
                      Upload
                    </button>
                  </div>
                </div>

                {referenceVideoMode === 'feed' ? (
                  assetsQuery.isPending ? (
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-white/45">
                      Loading your videos...
                    </div>
                  ) : referenceVideoAssets.length > 0 ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 max-h-72 overflow-y-auto pr-1">
                        {referenceVideoAssets.map((asset) => {
                          const isSelected = asset.id === selectedReferenceVideoAssetId;

                          return (
                            <button
                              key={asset.id}
                              onClick={() => handleSelectReferenceVideoAsset(asset.id)}
                              className={cn(
                                'group overflow-hidden rounded-xl border text-left transition-all',
                                isSelected
                                  ? 'border-purple-400 shadow-[0_0_0_1px_rgba(168,85,247,0.45)]'
                                  : 'border-white/10 hover:border-white/25',
                              )}
                            >
                              <div className="aspect-video bg-black">
                                <video
                                  src={asset.url}
                                  muted
                                  playsInline
                                  preload="metadata"
                                  className="h-full w-full object-cover"
                                />
                              </div>
                              <div className="px-3 py-3">
                                <p className="text-sm text-white truncate">{asset.kind}</p>
                                <p className="text-xs text-white/45">
                                  {formatDate(asset.createdAt)}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs text-white/40">
                        Select the motion reference clip to transfer onto your source image.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-5 text-sm text-white/55 space-y-3">
                      <p>No videos in your feed yet. Upload a motion reference or generate one first.</p>
                      <button
                        onClick={() => referenceVideoInputRef.current?.click()}
                        className="btn-secondary inline-flex text-sm"
                      >
                        Upload Video
                      </button>
                    </div>
                  )
                ) : (
                  <div className="space-y-3">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => referenceVideoInputRef.current?.click()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          referenceVideoInputRef.current?.click();
                        }
                      }}
                      className="w-full cursor-pointer rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-4 text-left transition-colors hover:bg-white/[0.05]"
                    >
                      {uploadedReferenceVideoPreview ? (
                        <div className="space-y-3">
                          <div className="aspect-video overflow-hidden rounded-xl bg-black">
                            <video
                              src={uploadedReferenceVideoPreview}
                              muted
                              loop
                              autoPlay
                              playsInline
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-white">
                                Uploaded reference video
                              </p>
                              <p className="text-xs text-white/40">
                                {isUploadingReferenceVideo
                                  ? 'Uploading video...'
                                  : 'Click to replace this video'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              {uploadedReferenceVideoPreview && !isUploadingReferenceVideo && (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    clearUploadedReferenceVideo();
                                  }}
                                  className="rounded-lg border border-white/10 bg-black/30 p-2 text-white/60 hover:text-white"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              )}
                              <div className="rounded-lg border border-white/10 bg-black/30 p-2 text-white/75">
                                {isUploadingReferenceVideo ? (
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
                              Upload a reference video
                            </p>
                            <p className="text-xs text-white/40">
                              MP4 or WebM up to 50MB
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-white/40">
                      Uploaded videos are saved to your feed for reuse in future motion-control jobs.
                    </p>
                  </div>
                )}

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-white/60">Motion control cost</span>
                    <span className="font-medium text-white">
                      {motionControlCredits ? `${motionControlCredits} credits` : 'Waiting for duration'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-white/40">
                    Motion control is billed at 38 credits/sec with original sound, or 26
                    credits/sec without it.
                  </p>
                  {typeof activeReferenceVideoDurationSec === 'number' && activeReferenceVideoDurationSec > 0 && (
                    <p className="mt-2 text-xs text-white/45">
                      Reference duration: {formatDurationLabel(activeReferenceVideoDurationSec)}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-white/60">
                  {videoWorkflow === 'standard' && videoMode === 'text' ? 'Prompt' : 'Motion Prompt'}
                </label>
                <span className="text-xs text-white/35">
                  {videoWorkflow === 'motion-control'
                    ? 'Optional'
                    : videoMode === 'text'
                      ? 'Required'
                      : 'Prompt or camera'}
                </span>
              </div>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={
                  videoWorkflow === 'motion-control'
                    ? 'Optional: add style direction or action emphasis on top of the transferred motion'
                    : videoMode === 'text'
                      ? 'Describe your video... e.g., cinematic slow motion, golden sunset, shallow depth of field'
                      : 'Optional: describe motion, camera movement, or timing cues for the selected image'
                }
                rows={4}
                className="input-field resize-none"
              />
              <p className="mt-2 text-xs text-white/40">
                {videoWorkflow === 'motion-control'
                  ? 'Leave this blank to transfer the reference motion as-is, or add direction to shape the output.'
                  : videoMode === 'text'
                    ? 'Use text alone to create the full scene.'
                    : 'Add a motion prompt here, or use camera control below to supply the direction.'}
              </p>
            </div>

            {videoWorkflow === 'standard' ? (
              <>
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
                  <label className="block text-sm font-medium text-white/60 mb-2">
                    Aspect Ratio
                  </label>
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
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-white/60 mb-2">
                    Character Orientation
                  </label>
                  <select
                    value={characterOrientation}
                    onChange={(event) =>
                      setCharacterOrientation(event.target.value as CharacterOrientation)
                    }
                    className="input-field"
                  >
                    {characterOrientations.map((orientation) => (
                      <option key={orientation.value} value={orientation.value}>
                        {orientation.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-xs text-white/40">
                    Match the source image orientation for camera-led motion, or match the
                    reference video orientation for more complex body motion.
                  </p>
                </div>

                <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={keepOriginalSound}
                    onChange={(event) => setKeepOriginalSound(event.target.checked)}
                    className="mt-1 h-4 w-4 accent-purple-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-white">Keep original sound</span>
                    <span className="block text-xs text-white/40">
                      Preserve the audio track from the reference video when the model supports it.
                    </span>
                  </span>
                </label>
              </>
            )}

            <button
              onClick={() => generateMutation.mutate()}
              disabled={!canGenerate || isGenerating || isUploadingSource || isUploadingReferenceVideo}
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
                  {`Generate Video (${
                    videoWorkflow === 'motion-control'
                      ? motionControlCredits
                        ? `${motionControlCredits} credits`
                        : '...'
                      : '25 credits'
                  })`}
                </>
              )}
            </button>

            {requiresSourceImage && sourceMode === 'feed' && !selectedFeedAssetId && (
              <p className="text-xs text-center text-white/40">
                Select a source image from your feed before generating.
              </p>
            )}

            {requiresSourceImage && sourceMode === 'upload' && !uploadedSourceAsset && (
              <p className="text-xs text-center text-white/40">
                Upload a source image before generating.
              </p>
            )}

            {videoWorkflow === 'standard' && videoMode === 'image' && activeSourceAssetId && !hasImageToVideoDirection && (
              <p className="text-xs text-center text-white/40">
                Add a motion prompt or choose a camera control before generating.
              </p>
            )}

            {requiresReferenceVideo && referenceVideoMode === 'feed' && !selectedReferenceVideoAssetId && (
              <p className="text-xs text-center text-white/40">
                Select a reference video from your feed before generating.
              </p>
            )}

            {requiresReferenceVideo && referenceVideoMode === 'upload' && !uploadedReferenceVideoAsset && (
              <p className="text-xs text-center text-white/40">
                Upload a reference video before generating.
              </p>
            )}

            {videoWorkflow === 'motion-control' && isResolvingReferenceVideoDuration && (
              <p className="text-xs text-center text-white/40">
                Reading reference video duration to calculate credits.
              </p>
            )}

            {videoWorkflow === 'motion-control' && activeReferenceVideoAssetId && !motionControlCredits && !isResolvingReferenceVideoDuration && (
              <p className="text-xs text-center text-white/40">
                We could not determine the reference video length yet.
              </p>
            )}

            {videoWorkflow === 'motion-control' && isReferenceVideoTooLong && (
              <p className="text-xs text-center text-red-300">
                Reference videos must be 10 seconds or shorter.
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

function calculateMotionControlCredits(durationSec: number, keepOriginalSound: boolean): number {
  const perSecondRate = keepOriginalSound
    ? MOTION_CONTROL_CREDITS_PER_SECOND.withAudio
    : MOTION_CONTROL_CREDITS_PER_SECOND.withoutAudio;

  return Math.max(1, Math.ceil(durationSec)) * perSecondRate;
}

function formatDurationLabel(durationSec: number): string {
  const roundedDuration = Math.max(0.1, Math.round(durationSec * 10) / 10);
  return `${roundedDuration}s`;
}

async function resolveVideoDurationSec(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out while reading video duration'));
    }, 15000);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
    };

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const durationSec = Number(video.duration);
      cleanup();

      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        reject(new Error('Could not determine video duration'));
        return;
      }

      resolve(durationSec);
    };
    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to load video metadata'));
    };
    video.src = url;
  });
}
