'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Users,
    Plus,
    Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import { getStatusBadgeClass } from '@/lib/utils';

interface Character {
    id: string;
    name: string;
    slug: string;
    characterType: string;
    status: string;
    coverUrl: string | null;
    imageCount: number;
    createdAt: string;
}

export default function CharactersPage() {
    const [searchQuery, setSearchQuery] = useState('');
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [name, setName] = useState('');
    const [characterType, setCharacterType] = useState('real');
    const tokenQuery = useApiToken();
    const queryClient = useQueryClient();
    const token = tokenQuery.data;

    const charactersQuery = useQuery({
        queryKey: ['characters', token],
        enabled: !!token,
        queryFn: () => api.getCharacters(token as string) as Promise<Character[]>,
    });

    const createCharacterMutation = useMutation({
        mutationFn: async () => {
            if (!token) {
                throw new Error('Authentication token unavailable');
            }

            return api.createCharacter(token, { name, characterType });
        },
        onSuccess: async () => {
            setName('');
            setCharacterType('real');
            setShowCreateModal(false);
            toast.success('Character created');
            await queryClient.invalidateQueries({ queryKey: ['characters'] });
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Failed to create character');
        },
    });

    const characters = useMemo(() => {
        const items = charactersQuery.data || [];
        const query = searchQuery.trim().toLowerCase();
        if (!query) {
            return items;
        }

        return items.filter((character) =>
            [character.name, character.slug, character.characterType]
                .some((value) => value.toLowerCase().includes(query)),
        );
    }, [charactersQuery.data, searchQuery]);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="page-header mb-0">
                    <h1 className="page-title">Characters</h1>
                    <p className="page-description">Create and manage your AI characters.</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="btn-primary"
                >
                    <Plus className="w-4 h-4 mr-2" />
                    New Character
                </button>
            </div>

            <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                <input
                    type="text"
                    placeholder="Search characters..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="input-field pl-11"
                />
            </div>

            {charactersQuery.isPending ? (
                <div className="glass-card p-12 text-center text-white/40">Loading characters...</div>
            ) : characters.length === 0 ? (
                <div className="glass-card p-12 text-center">
                    <Users className="w-16 h-16 text-white/10 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No characters yet</h3>
                    <p className="text-white/40 text-sm mb-6 max-w-sm mx-auto">
                        Create your first AI character by uploading reference photos and training a custom model.
                    </p>
                    <button onClick={() => setShowCreateModal(true)} className="btn-primary">
                        <Plus className="w-4 h-4 mr-2" />
                        Create Character
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {characters.map((character) => (
                        <div
                            key={character.id}
                            className="glass-card-hover overflow-hidden group"
                        >
                            <div className="aspect-square bg-white/5 relative overflow-hidden">
                                {character.coverUrl ? (
                                    <img
                                        src={character.coverUrl}
                                        alt={character.name}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center">
                                        <Users className="w-12 h-12 text-white/10" />
                                    </div>
                                )}
                                <div className="absolute top-3 right-3">
                                    <span className={getStatusBadgeClass(character.status)}>
                                        {character.status}
                                    </span>
                                </div>
                            </div>
                            <div className="p-4">
                                <h3 className="font-semibold truncate">{character.name}</h3>
                                <p className="text-sm text-white/40 mt-1">
                                    {character.imageCount} datasets • {character.characterType}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showCreateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="glass-card p-6 w-full max-w-md mx-4 animate-slide-up">
                        <h2 className="text-xl font-bold mb-4">Create New Character</h2>
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                createCharacterMutation.mutate();
                            }}
                            className="space-y-4"
                        >
                            <div>
                                <label className="block text-sm font-medium text-white/60 mb-2">
                                    Character Name
                                </label>
                                <input
                                    type="text"
                                    placeholder="e.g., Sophia"
                                    className="input-field"
                                    required
                                    value={name}
                                    onChange={(event) => setName(event.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-white/60 mb-2">
                                    Character Type
                                </label>
                                <select
                                    className="input-field"
                                    value={characterType}
                                    onChange={(event) => setCharacterType(event.target.value)}
                                >
                                    <option value="real">Real Person (Requires consent)</option>
                                    <option value="fictional">Fictional Character</option>
                                </select>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setShowCreateModal(false)}
                                    className="btn-secondary flex-1"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn-primary flex-1"
                                    disabled={createCharacterMutation.isPending}
                                >
                                    {createCharacterMutation.isPending ? 'Creating...' : 'Create'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
