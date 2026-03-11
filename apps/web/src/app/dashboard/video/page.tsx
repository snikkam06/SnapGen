'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Video, Loader2, RefreshCw, Image as ImageIcon } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

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
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [durationSec, setDurationSec] = useState(5);
  const [motionAmount, setMotionAmount] = useState(5);
  const [cameraControl, setCameraControl] = useState('none');
  const [activeJobId, setActiveJobId] = useState<string | null>(initialJobId);
  const [jobStartedAt, setJobStartedAt] = useState<number | null>(null);
  const [jobTimedOut, setJobTimedOut] = useState(false);
  const tokenQuery = useApiToken();
  const queryClient = useQueryClient();
  const token = tokenQuery.data;

  useEffect(() => {
    setActiveJobId(initialJobId);
  }, [initialJobId]);

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
      if (!token) throw new Error('Authentication token unavailable');
      return api.generateVideo(token, {
        prompt,
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
    return outputs.find((o) => o.mimeType.startsWith('video/'));
  }, [jobQuery.data?.outputs]);

  const isGenerating =
    generateMutation.isPending ||
    jobQuery.data?.status === 'queued' ||
    jobQuery.data?.status === 'running';

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1 className="page-title">Generate Video</h1>
        <p className="page-description">Create AI-generated videos with fal.ai.</p>
      </div>

      <div className="grid lg:grid-cols-[1fr,400px] gap-6">
        {/* Preview */}
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
          ) : (
            <div className="glass-card aspect-video flex flex-col items-center justify-center gap-4">
              <Video className="w-16 h-16 text-white/10" />
              <p className="text-white/30 text-sm">Your generated video will appear here</p>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="space-y-4">
          <div className="glass-card p-4 space-y-4">
            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Prompt</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe your video... e.g., a woman walking on a beach at sunset, cinematic slow motion"
                rows={4}
                className="input-field resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Duration</label>
              <div className="flex gap-2">
                {durations.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setDurationSec(d.value)}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                      durationSec === d.value
                        ? 'bg-purple-600/30 border border-purple-500/50 text-white'
                        : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10',
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Aspect Ratio</label>
              <div className="flex gap-2">
                {aspectRatios.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setAspectRatio(r.value)}
                    className={cn(
                      'px-4 py-2 rounded-lg text-sm font-medium transition-all',
                      aspectRatio === r.value
                        ? 'bg-purple-600/30 border border-purple-500/50 text-white'
                        : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10',
                    )}
                  >
                    {r.label}
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
                onChange={(e) => setMotionAmount(Number(e.target.value))}
                className="w-full accent-purple-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-white/60 mb-2">Camera Control</label>
              <select
                value={cameraControl}
                onChange={(e) => setCameraControl(e.target.value)}
                className="input-field"
              >
                {cameraControls.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

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
                  <Video className="w-5 h-5 mr-2" />
                  Generate Video (25 credits)
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
