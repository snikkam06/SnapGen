'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowLeft,
    Upload,
    Cpu,
    Sparkles,
    Users,
    Loader2,
    Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import { getStatusBadgeClass } from '@/lib/utils';

interface Dataset {
    id: string;
    status: string;
    imageCount: number;
    qualityScore: number | null;
    createdAt: string;
}

interface Model {
    id: string;
    provider: string;
    modelType: string;
    versionTag: string;
    status: string;
    createdAt: string;
}

interface CharacterDetail {
    id: string;
    name: string;
    slug: string;
    characterType: string;
    status: string;
    coverUrl: string | null;
    createdAt: string;
    updatedAt: string;
    datasets: Dataset[];
    models: Model[];
}

export default function CharacterDetailPage() {
    const params = useParams();
    const router = useRouter();
    const characterId = params.id as string;
    const tokenQuery = useApiToken();
    const queryClient = useQueryClient();
    const token = tokenQuery.data;

    const characterQuery = useQuery({
        queryKey: ['character', token, characterId],
        enabled: !!token && !!characterId,
        queryFn: () => api.getCharacter(token as string, characterId) as Promise<CharacterDetail>,
    });

    const trainMutation = useMutation({
        mutationFn: async () => {
            if (!token) throw new Error('Authentication token unavailable');
            return api.trainCharacter(token, characterId, { trainingPreset: 'default' });
        },
        onSuccess: async () => {
            toast.success('Model training started');
            await queryClient.invalidateQueries({ queryKey: ['character', token, characterId] });
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Failed to start training');
        },
    });

    const uploadMutation = useMutation({
        mutationFn: async (files: File[]) => {
            if (!token) throw new Error('Authentication token unavailable');
            for (const file of files) {
                await api.uploadCharacterImage(token, characterId, file);
            }
        },
        onSuccess: async () => {
            toast.success('Images uploaded');
            await queryClient.invalidateQueries({ queryKey: ['character', token, characterId] });
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Upload failed');
        },
    });

    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    const deleteMutation = useMutation({
        mutationFn: async () => {
            if (!token) throw new Error('Authentication token unavailable');
            return api.deleteCharacter(token, characterId);
        },
        onSuccess: async () => {
            toast.success('Character deleted');
            await queryClient.invalidateQueries({ queryKey: ['characters'] });
            router.push('/dashboard/characters');
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Failed to delete character');
        },
    });

    const character = characterQuery.data;
    const totalImages = character?.datasets.reduce((sum, d) => sum + d.imageCount, 0) ?? 0;

    if (characterQuery.isPending) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-white/30" />
            </div>
        );
    }

    if (!character) {
        return (
            <div className="glass-card p-12 text-center">
                <Users className="w-12 h-12 text-white/10 mx-auto mb-3" />
                <p className="text-white/40">Character not found</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <button onClick={() => router.push('/dashboard/characters')} className="btn-ghost p-2">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex-1">
                    <h1 className="page-title">{character.name}</h1>
                    <p className="text-sm text-white/40">
                        {character.characterType} &middot; {totalImages} images &middot;{' '}
                        <span className={getStatusBadgeClass(character.status)}>{character.status}</span>
                    </p>
                </div>
                <div className="flex gap-2">
                    <label className="btn-secondary cursor-pointer">
                        <Upload className="w-4 h-4 mr-2" />
                        Upload Images
                        <input
                            type="file"
                            accept="image/*"
                            multiple
                            className="hidden"
                            onChange={(e) => {
                                const files = Array.from(e.target.files || []);
                                if (files.length > 0) uploadMutation.mutate(files);
                                e.currentTarget.value = '';
                            }}
                        />
                    </label>
                    {totalImages > 0 && (
                        <button
                            onClick={() => trainMutation.mutate()}
                            disabled={trainMutation.isPending}
                            className="btn-secondary"
                        >
                            <Cpu className="w-4 h-4 mr-2" />
                            {trainMutation.isPending ? 'Training...' : 'Train Model'}
                        </button>
                    )}
                    <Link
                        href={`/dashboard/generate?characterId=${character.id}`}
                        className="btn-primary"
                    >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Generate with Character
                    </Link>
                    <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="btn-secondary px-3 text-red-400 hover:text-red-300 hover:border-red-500/30"
                        title="Delete character"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Datasets */}
            <div className="glass-card p-6">
                <h2 className="text-lg font-semibold mb-4">Datasets</h2>
                {character.datasets.length === 0 ? (
                    <p className="text-white/40 text-sm">No datasets yet. Upload reference images to get started.</p>
                ) : (
                    <div className="space-y-2">
                        {character.datasets.map((dataset) => (
                            <div key={dataset.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                                <div>
                                    <span className="text-sm font-medium">{dataset.imageCount} images</span>
                                    <span className="text-xs text-white/40 ml-3">
                                        {new Date(dataset.createdAt).toLocaleDateString()}
                                    </span>
                                </div>
                                <div className="flex items-center gap-3">
                                    {dataset.qualityScore != null && (
                                        <span className="text-xs text-white/40">
                                            Quality: {dataset.qualityScore.toFixed(1)}
                                        </span>
                                    )}
                                    <span className={getStatusBadgeClass(dataset.status)}>
                                        {dataset.status}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Models */}
            <div className="glass-card p-6">
                <h2 className="text-lg font-semibold mb-4">Models</h2>
                {character.models.length === 0 ? (
                    <p className="text-white/40 text-sm">No models trained yet. Upload images and train a model.</p>
                ) : (
                    <div className="space-y-2">
                        {character.models.map((model) => (
                            <div key={model.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                                <div>
                                    <span className="text-sm font-medium">{model.versionTag}</span>
                                    <span className="text-xs text-white/40 ml-3">
                                        {model.provider} &middot; {model.modelType}
                                    </span>
                                </div>
                                <span className={getStatusBadgeClass(model.status)}>
                                    {model.status}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {showDeleteConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="glass-card p-6 w-full max-w-md mx-4 animate-slide-up">
                        <h2 className="text-xl font-bold mb-2">Delete Character</h2>
                        <p className="text-sm text-white/50 mb-6">
                            Are you sure you want to delete <strong className="text-white">{character.name}</strong>? This will remove the character and all associated datasets and models. This action cannot be undone.
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowDeleteConfirm(false)}
                                className="btn-secondary flex-1"
                                disabled={deleteMutation.isPending}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => deleteMutation.mutate()}
                                disabled={deleteMutation.isPending}
                                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
                            >
                                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
