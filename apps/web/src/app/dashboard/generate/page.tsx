'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Wand2,
  Sparkles,
  Settings2,
  Image as ImageIcon,
  ChevronDown,
  Loader2,
  Download,
  RefreshCw,
  Video,
} from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const stylePacks = [
  { id: 'photorealistic-portrait', name: 'Photorealistic Portrait', cost: 5 },
  { id: 'editorial-fashion', name: 'Editorial Fashion', cost: 8 },
  { id: 'glamour', name: 'Glamour', cost: 10 },
  { id: 'artistic-nude', name: 'Artistic Nude', cost: 12 },
  { id: 'fantasy', name: 'Fantasy', cost: 8 },
  { id: 'cinematic', name: 'Cinematic', cost: 8 },
];

const generationModes = [
  {
    value: 'base',
    label: 'Base',
    description: 'Uses fal.ai for the default image generation flow.',
    maxImages: 8,
  },
  {
    value: 'enhanced',
    label: 'Enhanced',
    description: 'Uses Gemini for stronger prompt rendering and better reference fidelity.',
    maxImages: 4,
  },
] as const;

function getMaxImagesForMode(mode: 'base' | 'enhanced'): number {
  return generationModes.find((entry) => entry.value === mode)?.maxImages ?? 4;
}

const aspectRatios = [
  { value: '1:1', label: '1:1', width: 'w-8', height: 'h-8' },
  { value: '4:5', label: '4:5', width: 'w-7', height: 'h-8' },
  { value: '16:9', label: '16:9', width: 'w-10', height: 'h-6' },
  { value: '9:16', label: '9:16', width: 'w-5', height: 'h-8' },
];

interface Character {
  id: string;
  name: string;
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
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedStyle, setSelectedStyle] = useState(stylePacks[0].id);
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
      toast.success('Image generation started');
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

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Generate Images</h1>
        <p className="page-description">
          Create AI-generated images with either fal.ai base mode or Gemini enhanced mode.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr,400px] gap-6">
        <div className="space-y-4">
          {isGenerating ? (
            <div className="glass-card aspect-square flex flex-col items-center justify-center gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin" />
                <Sparkles className="w-6 h-6 text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
              </div>
              <p className="text-white/40 text-sm">Generating your images...</p>
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
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2">
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
          ) : (
            <div className="glass-card aspect-[4/3] flex flex-col items-center justify-center gap-4">
              <ImageIcon className="w-16 h-16 text-white/10" />
              <p className="text-white/30 text-sm">Your generated images will appear here</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="glass-card p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Prompt</label>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe your image... e.g., editorial portrait in a luxury hotel lobby, dramatic lighting"
                rows={4}
                className="input-field resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">
                Generation Mode
              </label>
              <div className="grid grid-cols-2 gap-2">
                {generationModes.map((mode) => (
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
                ))}
              </div>
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
                Character-based generations prefer fal.ai when it is configured.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Style Pack</label>
              <div className="grid grid-cols-2 gap-2">
                {stylePacks.map((style) => (
                  <button
                    key={style.id}
                    onClick={() => setSelectedStyle(style.id)}
                    className={cn(
                      'px-3 py-2 rounded-lg text-xs font-medium text-left transition-all',
                      selectedStyle === style.id
                        ? 'bg-purple-600/30 border border-purple-500/50 text-white'
                        : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10',
                    )}
                  >
                    <div>{style.name}</div>
                    <div className="text-purple-400 mt-0.5">{style.cost} credits</div>
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
              <p className="mt-2 text-xs text-white/40">
                {generationMode === 'enhanced'
                  ? 'Enhanced mode is capped at 4 images per job because Gemini returns up to 4 outputs.'
                  : 'Base mode supports up to 8 images per job through fal.ai.'}
              </p>
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
                    value={seed}
                    onChange={(event) => setSeed(event.target.value)}
                    placeholder="Random"
                    className="input-field text-sm"
                  />
                </div>
              </div>
            )}

            <button
              onClick={() => generateMutation.mutate()}
              disabled={!prompt.trim() || isGenerating}
              className="btn-primary w-full py-4 text-base animate-pulse-glow"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Wand2 className="w-5 h-5 mr-2" />
                  Generate ({numImages * 5} credits)
                </>
              )}
            </button>

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
