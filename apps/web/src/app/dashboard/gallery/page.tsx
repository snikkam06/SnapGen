'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderOpen, Grid, List, Download, Trash2, X } from 'lucide-react';
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
    onSuccess: async () => {
      toast.success('Asset removed');
      await queryClient.invalidateQueries({ queryKey: ['assets'] });
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
        <div className="glass-card p-12 text-center text-white/40">Loading assets...</div>
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
                'glass-card overflow-hidden group cursor-pointer',
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
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="p-1.5 rounded bg-black/40 backdrop-blur-sm hover:bg-black/60"
                      >
                        <Download className="w-3 h-3" />
                      </a>
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteAssetMutation.mutate(item.id);
                        }}
                        className="p-1.5 rounded bg-black/40 backdrop-blur-sm hover:bg-black/60"
                      >
                        <Trash2 className="w-3 h-3 text-red-400" />
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
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedItem && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-8"
          onClick={() => setSelectedItem(null)}
        >
          <button className="absolute top-4 right-4 p-2 text-white/60 hover:text-white">
            <X className="w-6 h-6" />
          </button>
          {isVideoItem(selectedItem) ? (
            <video
              src={selectedItem.url}
              controls
              autoPlay
              loop
              playsInline
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <img
              src={selectedItem.url}
              alt="Full size"
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={(event) => event.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}
