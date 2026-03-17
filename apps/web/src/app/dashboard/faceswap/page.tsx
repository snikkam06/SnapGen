'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Layers,
    Upload,
    Image as ImageIcon,
    Loader2,
    Info,
    Download,
    Sparkles,
    RefreshCw,
    X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';

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

interface UploadedAsset {
    id: string;
    previewUrl: string;
}

export default function FaceSwapPage() {
    const [sourceAsset, setSourceAsset] = useState<UploadedAsset | null>(null);
    const [targetAsset, setTargetAsset] = useState<UploadedAsset | null>(null);
    const [activeJobId, setActiveJobId] = useState<string | null>(null);

    const sourceInputRef = useRef<HTMLInputElement>(null);
    const targetInputRef = useRef<HTMLInputElement>(null);

    const tokenQuery = useApiToken();
    const queryClient = useQueryClient();
    const token = tokenQuery.data;

    const jobQuery = useQuery({
        queryKey: ['job', token, activeJobId],
        enabled: !!token && !!activeJobId,
        refetchInterval: (query) => {
            const status = (query.state.data as JobDetail | undefined)?.status;
            return status === 'completed' || status === 'failed' ? false : 30000; // Fallback polling; SSE provides real-time updates
        },
        queryFn: () => api.getJob(token as string, activeJobId as string) as Promise<JobDetail>,
    });

    const uploadMutation = useMutation({
        mutationFn: async ({ file, target }: { file: File; target: 'source' | 'target' }) => {
            if (!token) throw new Error('Authentication token unavailable');
            const result = await api.uploadImageAsset(token, file) as { id: string; url: string };
            return { ...result, target };
        },
        onSuccess: (result) => {
            const previewUrl = result.url;
            if (result.target === 'source') {
                setSourceAsset({ id: result.id, previewUrl });
            } else {
                setTargetAsset({ id: result.id, previewUrl });
            }
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Failed to upload image');
        },
    });

    const faceSwapMutation = useMutation({
        mutationFn: async () => {
            if (!token) throw new Error('Authentication token unavailable');
            if (!sourceAsset || !targetAsset) throw new Error('Please upload both images');

            return api.faceSwapImage(token, {
                sourceAssetId: sourceAsset.id,
                targetAssetId: targetAsset.id,
            }) as Promise<{ id: string }>;
        },
        onSuccess: async (job) => {
            setActiveJobId(job.id);
            toast.success('Face swap started');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['jobs'] }),
                queryClient.invalidateQueries({ queryKey: ['assets'] }),
            ]);
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Failed to start face swap');
        },
    });

    const isUploading = uploadMutation.isPending;
    const isProcessing =
        faceSwapMutation.isPending ||
        jobQuery.data?.status === 'queued' ||
        jobQuery.data?.status === 'running';

    const resultImages = jobQuery.data?.outputs || [];

    const handleFileSelect = (
        event: React.ChangeEvent<HTMLInputElement>,
        target: 'source' | 'target',
    ) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            toast.error('Please select an image file');
            return;
        }

        if (file.size > 50 * 1024 * 1024) {
            toast.error('Image must be under 50MB');
            return;
        }

        uploadMutation.mutate({ file, target });
    };

    const clearSource = () => {
        setSourceAsset(null);
        if (sourceInputRef.current) sourceInputRef.current.value = '';
    };

    const clearTarget = () => {
        setTargetAsset(null);
        if (targetInputRef.current) targetInputRef.current.value = '';
    };

    return (
        <div className="space-y-6">
            <div className="page-header">
                <h1 className="page-title">Face Swap</h1>
                <p className="page-description">Seamlessly swap faces in images.</p>
            </div>

            <div className="glass-card p-4 flex items-start gap-3 border-purple-500/20">
                <Info className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                <div>
                    <p className="text-sm text-white/70">
                        Upload a source face and a target image. The AI will replace the face in the target
                        with the source face while maintaining natural proportions and lighting.
                    </p>
                    <p className="text-xs text-white/40 mt-1">Cost: 10 credits per swap</p>
                </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
                {/* Source Face */}
                <div className="space-y-3">
                    <h3 className="font-semibold text-sm text-white/70">Source Face</h3>
                    <input
                        ref={sourceInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => handleFileSelect(e, 'source')}
                    />
                    <div
                        className="glass-card aspect-square flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-white/10 transition-colors relative"
                        onClick={() => !isUploading && sourceInputRef.current?.click()}
                    >
                        {sourceAsset ? (
                            <>
                                <img src={sourceAsset.previewUrl} alt="Source" className="w-full h-full object-cover rounded-xl" />
                                <button
                                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 transition-colors"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        clearSource();
                                    }}
                                >
                                    <X className="w-4 h-4 text-white/70" />
                                </button>
                            </>
                        ) : isUploading && uploadMutation.variables?.target === 'source' ? (
                            <>
                                <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
                                <p className="text-sm text-white/30">Uploading...</p>
                            </>
                        ) : (
                            <>
                                <Upload className="w-10 h-10 text-white/20" />
                                <p className="text-sm text-white/30">Click to upload source face</p>
                            </>
                        )}
                    </div>
                </div>

                {/* Target Image */}
                <div className="space-y-3">
                    <h3 className="font-semibold text-sm text-white/70">Target Image</h3>
                    <input
                        ref={targetInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => handleFileSelect(e, 'target')}
                    />
                    <div
                        className="glass-card aspect-square flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-white/10 transition-colors relative"
                        onClick={() => !isUploading && targetInputRef.current?.click()}
                    >
                        {targetAsset ? (
                            <>
                                <img src={targetAsset.previewUrl} alt="Target" className="w-full h-full object-cover rounded-xl" />
                                <button
                                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-black/80 transition-colors"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        clearTarget();
                                    }}
                                >
                                    <X className="w-4 h-4 text-white/70" />
                                </button>
                            </>
                        ) : isUploading && uploadMutation.variables?.target === 'target' ? (
                            <>
                                <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
                                <p className="text-sm text-white/30">Uploading...</p>
                            </>
                        ) : (
                            <>
                                <Upload className="w-10 h-10 text-white/20" />
                                <p className="text-sm text-white/30">Click to upload target image</p>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Swap Button */}
            <div className="flex justify-center gap-3">
                <button
                    onClick={() => faceSwapMutation.mutate()}
                    disabled={!sourceAsset || !targetAsset || isProcessing || isUploading}
                    className="btn-primary px-10 py-4 text-base"
                >
                    {isProcessing ? (
                        <>
                            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                            Processing...
                        </>
                    ) : (
                        <>
                            <Layers className="w-5 h-5 mr-2" />
                            Swap Faces (10 credits)
                        </>
                    )}
                </button>

                {activeJobId && (
                    <button
                        onClick={() => void jobQuery.refetch()}
                        className="btn-secondary px-4 py-4"
                    >
                        <RefreshCw className="w-5 h-5" />
                    </button>
                )}
            </div>

            {/* Processing State */}
            {isProcessing && (
                <div className="glass-card aspect-video max-w-md mx-auto flex flex-col items-center justify-center gap-4">
                    <div className="relative">
                        <div className="w-16 h-16 rounded-full border-2 border-purple-500/30 border-t-purple-500 animate-spin" />
                        <Sparkles className="w-6 h-6 text-purple-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                    </div>
                    <p className="text-white/40 text-sm">Swapping faces...</p>
                </div>
            )}

            {/* Error State */}
            {jobQuery.data?.status === 'failed' && (
                <div className="glass-card aspect-video max-w-md mx-auto flex flex-col items-center justify-center gap-4 px-8 text-center">
                    <ImageIcon className="w-16 h-16 text-red-400/40" />
                    <p className="text-white/70 text-sm">
                        {jobQuery.data.errorMessage || 'Face swap failed'}
                    </p>
                </div>
            )}

            {/* Result */}
            {!isProcessing && resultImages.length > 0 && (
                <div className="space-y-3">
                    <h3 className="font-semibold">Result</h3>
                    {resultImages.map((image) => (
                        <div key={image.id} className="glass-card overflow-hidden max-w-md mx-auto group relative">
                            <img src={image.url} alt="Result" className="w-full" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2">
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
            )}
        </div>
    );
}
