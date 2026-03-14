'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Grid, List, Download, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import { cn, formatDate } from '@/lib/utils';

type ViewMode = 'grid' | 'list';
type FilterType = 'all' | 'image' | 'video';

interface GalleryItem {
  id: string;
  kind: string;
  mimeType: string;
  url: string;
  width: number | null;
  height: number | null;
  createdAt: string;
}

interface AssetsResponse {
  data: GalleryItem[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
}

export default function GalleryPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const tokenQuery = useApiToken();
  const queryClient = useQueryClient();
  const token = tokenQuery.data;

  const assetsQuery = useQuery({
    queryKey: ['assets', token],
    enabled: !!token,
    queryFn: () => api.getAssets(token as string) as Promise<AssetsResponse>,
  });

  const deleteAssetMutation = useMutation({
    mutationFn: async (assetId: string) => {
      if (!token) {
        throw new Error('Authentication token unavailable');
      }

      return api.deleteAsset(token, assetId);
    },
    onSuccess: async (_response, assetId) => {
      queryClient.setQueryData<AssetsResponse | undefined>(['assets', token], (current) => {
        if (!current) {
          return current;
        }

        const remainingItems = current.data.filter((asset) => asset.id !== assetId);

        return {
          ...current,
          data: remainingItems,
          total: typeof current.total === 'number' ? Math.max(0, current.total - 1) : current.total,
        };
      });
      setSelectedItem((current) => (current?.id === assetId ? null : current));
      toast.success('Asset removed');
      await queryClient.invalidateQueries({ queryKey: ['assets', token] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete asset');
    },
  });

  const items = useMemo(() => {
    const assets = assetsQuery.data?.data || [];
    if (filter === 'all') {
      return assets;
    }

    return assets.filter((asset) =>
      filter === 'image' ? asset.kind.includes('image') : asset.kind.includes('video'),
    );
  }, [assetsQuery.data, filter]);

  const isVideoItem = (item: GalleryItem) =>
    item.mimeType.startsWith('video/') || item.kind.includes('video');

  const handleDeleteAsset = async (assetId: string) => {
    if (deleteAssetMutation.isPending) {
      return;
    }

    if (!window.confirm('Delete this asset? This cannot be undone.')) {
      return;
    }

    await deleteAssetMutation.mutateAsync(assetId);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Gallery</h1>
          <p className="page-description">Browse all your generated content.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 glass-card p-1">
            {(['all', 'image', 'video'] as FilterType[]).map((entry) => (
              <button
                key={entry}
                onClick={() => setFilter(entry)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize',
                  filter === entry ? 'bg-purple-600 text-white' : 'text-white/50 hover:text-white',
                )}
              >
                {entry}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 glass-card p-1">
            <button
              onClick={() => setViewMode('grid')}
              className={cn('p-1.5 rounded', viewMode === 'grid' ? 'bg-white/10' : '')}
            >
              <Grid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={cn('p-1.5 rounded', viewMode === 'list' ? 'bg-white/10' : '')}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {assetsQuery.isPending ? (
        <div className="glass-card p-12 flex flex-col items-center justify-center gap-3 text-white/40">
          <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
          <span>Loading assets...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <FolderOpen className="w-16 h-16 text-white/10 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">Your gallery is empty</h3>
          <p className="text-white/40 text-sm">
            Generated images and videos will appear here. Start by generating your first image!
          </p>
        </div>
      ) : (
        <div
          className={cn(
            viewMode === 'grid'
              ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3'
              : 'space-y-2',
          )}
        >
          {items.map((item) => (
            <div
              key={item.id}
              onClick={() => setSelectedItem(item)}
              className={cn(
                'glass-card overflow-hidden group cursor-pointer relative',
                viewMode === 'grid' ? 'aspect-square' : 'flex items-center gap-4 p-3',
              )}
            >
              {viewMode === 'grid' ? (
                <>
                  {isVideoItem(item) ? (
                    <video
                      src={item.url}
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <img
                      src={item.url}
                      alt="Generated"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="absolute bottom-2 left-2 right-2 flex gap-1.5">
                      <a
                        href={item.url}
                        download
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="p-1.5 rounded bg-black/40 backdrop-blur-sm hover:bg-black/60"
                        aria-label="Download"
                      >
                        <Download className="w-3 h-3" />
                      </a>
                      <button
                        type="button"
                        disabled={deleteAssetMutation.isPending}
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDeleteAsset(item.id);
                        }}
                        className="p-1.5 rounded bg-black/40 backdrop-blur-sm hover:bg-black/60 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label="Delete"
                      >
                        {deleteAssetMutation.isPending && deleteAssetMutation.variables === item.id ? (
                          <Loader2 className="w-3 h-3 animate-spin text-red-400" />
                        ) : (
                          <Trash2 className="w-3 h-3 text-red-400" />
                        )}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0">
                    {isVideoItem(item) ? (
                      <video
                        src={item.url}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img src={item.url} alt="Generated" className="w-full h-full object-cover" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.kind}</p>
                    <p className="text-xs text-white/40">
                      {item.width ?? '?'}x{item.height ?? '?'}
                    </p>
                  </div>
                  <p className="text-xs text-white/30">{formatDate(item.createdAt)}</p>
                  <div className="flex items-center gap-1.5">
                    <a
                      href={item.url}
                      download
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                      className="p-2 rounded bg-black/30 backdrop-blur-sm hover:bg-black/50"
                      aria-label="Download"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                    <button
                      type="button"
                      disabled={deleteAssetMutation.isPending}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDeleteAsset(item.id);
                      }}
                      className="p-2 rounded bg-black/30 backdrop-blur-sm hover:bg-black/50 disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label="Delete"
                    >
                      {deleteAssetMutation.isPending && deleteAssetMutation.variables === item.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-red-400" />
                      ) : (
                        <Trash2 className="w-4 h-4 text-red-400" />
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedItem && (
        <GalleryModal
          item={selectedItem}
          isVideo={isVideoItem(selectedItem)}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}

function GalleryModal({
  item,
  isVideo,
  onClose,
}: {
  item: GalleryItem;
  isVideo: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-8"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 p-2 text-white/60 hover:text-white"
        aria-label="Close"
      >
        <X className="w-6 h-6" />
      </button>
      {isVideo ? (
        <video
          src={item.url}
          controls
          autoPlay
          loop
          playsInline
          className="max-w-full max-h-full object-contain rounded-lg"
          onClick={(event) => event.stopPropagation()}
        />
      ) : (
        <img
          src={item.url}
          alt="Full size"
          className="max-w-full max-h-full object-contain rounded-lg"
          onClick={(event) => event.stopPropagation()}
        />
      )}
    </div>
  );
}
