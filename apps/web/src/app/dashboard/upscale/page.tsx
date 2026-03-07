'use client';

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpCircle, Upload, Loader2, Download, Info, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const modes = [
    { value: 'realism', label: 'Realism', description: 'Enhance photorealism' },
    { value: 'quality', label: 'Quality', description: 'Maximum detail preservation' },
    { value: 'detail', label: 'Detail', description: 'Sharpen fine details' },
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

export default function UpscalePage() {
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [mode, setMode] = useState('realism');
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const tokenQuery = useApiToken();
    const queryClient = useQueryClient();
    const token = tokenQuery.data;

    const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
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
        reader.onload = (e) => {
            setImagePreview(e.target?.result as string);
            setActiveJobId(null);
        };
        reader.onerror = () => {
            toast.error('Failed to read file');
        };
        reader.readAsDataURL(file);
    }, []);

    const handleClearImage = useCallback(() => {
        setImagePreview(null);
        setActiveJobId(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, []);

    const jobQuery = useQuery({
        queryKey: ['job', token, activeJobId],
        enabled: !!token && !!activeJobId,
        refetchInterval: (query) => {
            const status = (query.state.data as JobDetail | undefined)?.status;
            return status === 'completed' || status === 'failed' ? false : 4000;
        },
        queryFn: () => api.getJob(token as string, activeJobId as string) as Promise<JobDetail>,
    });

    const upscaleMutation = useMutation({
        mutationFn: async () => {
            if (!token) {
                throw new Error('Authentication token unavailable');
            }
            if (!imagePreview) {
                throw new Error('No image selected');
            }

            // Use a placeholder asset ID since we don't have real R2 uploads yet
            const assetId = 'placeholder-asset-' + Date.now();

            return api.upscaleImage(token, { assetId, mode }) as Promise<{ id: string }>;
        },
        onSuccess: async (job) => {
            setActiveJobId(job.id);
            toast.success('Upscale job started');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['jobs'] }),
                queryClient.invalidateQueries({ queryKey: ['assets'] }),
            ]);
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Failed to start upscale');
        },
    });

    const isProcessing =
        upscaleMutation.isPending ||
        jobQuery.data?.status === 'queued' ||
        jobQuery.data?.status === 'running';

    const resultImage = jobQuery.data?.status === 'completed' && jobQuery.data.outputs.length > 0
        ? jobQuery.data.outputs[0]
        : null;

    return (
        <div className="space-y-6">
            <div className="page-header">
                <h1 className="page-title">Upscale</h1>
                <p className="page-description">Enhance image resolution with AI super-resolution.</p>
            </div>

            <div className="glass-card p-4 flex items-start gap-3 border-green-500/20">
                <Info className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-white/70">
                    Upload an image to upscale it by 4x. Works best with generated images. Cost: 3 credits.
                </p>
            </div>

            {/* Hidden File Input */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleFileSelect}
                className="hidden"
            />

            {/* Upload Area */}
            <div
                className="glass-card aspect-video max-w-2xl mx-auto flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-white/10 transition-colors relative"
                onClick={() => fileInputRef.current?.click()}
            >
                {imagePreview ? (
                    <>
                        <img src={imagePreview} alt="To upscale" className="max-w-full max-h-full object-contain rounded-lg" />
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleClearImage();
                            }}
                            className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/50 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/70 transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </>
                ) : (
                    <>
                        <Upload className="w-12 h-12 text-white/20" />
                        <p className="text-sm text-white/30">Click to upload an image to upscale</p>
                        <p className="text-xs text-white/20">Supports JPEG, PNG, WebP up to 50MB</p>
                    </>
                )}
            </div>

            {/* Mode Selection */}
            <div className="flex gap-3 justify-center">
                {modes.map((m) => (
                    <button
                        key={m.value}
                        onClick={() => setMode(m.value)}
                        className={cn(
                            'px-5 py-3 rounded-xl text-sm transition-all',
                            mode === m.value
                                ? 'bg-purple-600/30 border border-purple-500/50 text-white'
                                : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10',
                        )}
                    >
                        <div className="font-medium">{m.label}</div>
                        <div className="text-xs text-white/40 mt-0.5">{m.description}</div>
                    </button>
                ))}
            </div>

            {/* Upscale Button */}
            <div className="flex justify-center">
                <button
                    onClick={() => upscaleMutation.mutate()}
                    disabled={!imagePreview || isProcessing}
                    className="btn-primary px-10 py-4 text-base"
                >
                    {isProcessing ? (
                        <>
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            Upscaling...
                        </>
                    ) : (
                        <>
                            <ArrowUpCircle className="w-5 h-5 mr-2" />
                            Upscale 4x (3 credits)
                        </>
                    )}
                </button>
            </div>

            {/* Processing Indicator */}
            {isProcessing && (
                <div className="glass-card max-w-2xl mx-auto flex flex-col items-center justify-center gap-4 py-12">
                    <div className="relative">
                        <div className="w-16 h-16 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin" />
                        <Sparkles className="w-6 h-6 text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>
                    <p className="text-white/40 text-sm">Upscaling your image...</p>
                </div>
            )}

            {/* Error State */}
            {jobQuery.data?.status === 'failed' && (
                <div className="glass-card max-w-2xl mx-auto flex flex-col items-center justify-center gap-4 py-12 px-8 text-center">
                    <p className="text-red-400 text-sm">
                        {jobQuery.data.errorMessage || 'Upscale failed. Please try again.'}
                    </p>
                </div>
            )}

            {/* Result */}
            {resultImage && (
                <div className="space-y-3 max-w-4xl mx-auto">
                    <div className="flex items-center justify-between">
                        <h3 className="font-semibold">Upscaled Result</h3>
                        <a
                            href={resultImage.url}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-secondary text-sm"
                        >
                            <Download className="w-4 h-4 mr-2" />
                            Download
                        </a>
                    </div>
                    <div className="glass-card overflow-hidden">
                        <img src={resultImage.url} alt="Upscaled result" className="w-full" />
                    </div>
                </div>
            )}
        </div>
    );
}
