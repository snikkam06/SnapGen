'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  FolderOpen,
  Grid,
  ImageIcon,
  List,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { useApiToken } from '@/hooks/use-api-token';
import { api } from '@/lib/api-client';
import { cn, formatDate, formatRelativeTime } from '@/lib/utils';

const PAGE_SIZE = 24;
const FILTER_OPTIONS = ['all', 'image', 'video', 'generated', 'uploaded'] as const;
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
] as const;

type ViewMode = 'grid' | 'list';
type FilterType = (typeof FILTER_OPTIONS)[number];
type SortType = (typeof SORT_OPTIONS)[number]['value'];

interface GalleryItem {
  id: string;
  kind: string;
  mimeType: string;
  url: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  fileSizeBytes: string;
  durationSec: number | null;
  metadata: {
    originalFileName: string | null;
    uploadSource: string | null;
  };
  sourceJob: {
    id: string;
    jobType: string;
    prompt: string | null;
    createdAt: string;
    characterName: string | null;
    stylePackName: string | null;
  } | null;
}

interface AssetsResponse {
  data: GalleryItem[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  sort?: string;
}

interface GalleryStat {
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
}

export default function GalleryPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sort, setSort] = useState<SortType>('newest');
  const [search, setSearch] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const tokenQuery = useApiToken();
  const queryClient = useQueryClient();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const token = tokenQuery.data;
  const deferredSearch = useDeferredValue(search);

  const assetsQuery = useInfiniteQuery({
    queryKey: ['assets', token, sort, 'gallery'],
    enabled: !!token,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.getAssets(token as string, {
        page: String(pageParam),
        limit: String(PAGE_SIZE),
        sort,
      }) as Promise<AssetsResponse>,
    getNextPageParam: (lastPage) => {
      if (!lastPage.page || !lastPage.totalPages || lastPage.page >= lastPage.totalPages) {
        return undefined;
      }

      return lastPage.page + 1;
    },
  });

  const deleteAssetMutation = useMutation({
    mutationFn: async (assetId: string) => {
      if (!token) {
        throw new Error('Authentication token unavailable');
      }

      return api.deleteAsset(token, assetId);
    },
    onSuccess: async (_response, assetId) => {
      queryClient.setQueriesData<InfiniteData<AssetsResponse, number>>(
        { queryKey: ['assets', token] },
        (current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            pages: current.pages.map((page) => {
              const nextTotal =
                typeof page.total === 'number' ? Math.max(0, page.total - 1) : page.total;

              return {
                ...page,
                data: page.data.filter((asset) => asset.id !== assetId),
                total: nextTotal,
                totalPages:
                  typeof nextTotal === 'number' && page.limit
                    ? Math.ceil(nextTotal / page.limit)
                    : page.totalPages,
              };
            }),
          };
        },
      );
      toast.success('Asset removed');
      await queryClient.invalidateQueries({ queryKey: ['assets', token] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete asset');
    },
  });

  const uploadImageMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!token) {
        throw new Error('Authentication token unavailable');
      }

      return api.uploadImageAsset(token, file) as Promise<GalleryItem>;
    },
    onSuccess: async () => {
      toast.success('Image added to gallery');
      await queryClient.invalidateQueries({ queryKey: ['assets', token] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to upload image');
    },
  });

  const loadedItems = useMemo(
    () => assetsQuery.data?.pages.flatMap((page) => page.data) ?? [],
    [assetsQuery.data],
  );

  const normalizedSearch = deferredSearch.trim().toLowerCase();
  const visibleItems = useMemo(() => {
    return loadedItems.filter((item) => {
      if (!matchesFilter(item, filter)) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return getAssetSearchText(item).includes(normalizedSearch);
    });
  }, [filter, loadedItems, normalizedSearch]);

  const totals = useMemo(() => {
    const latestTimestamp = loadedItems.reduce<number | null>((latest, item) => {
      const timestamp = new Date(item.createdAt).getTime();
      if (!Number.isFinite(timestamp)) {
        return latest;
      }

      return latest === null ? timestamp : Math.max(latest, timestamp);
    }, null);

    return {
      total: assetsQuery.data?.pages[0]?.total ?? loadedItems.length,
      loaded: loadedItems.length,
      images: loadedItems.filter((item) => !isVideoItem(item)).length,
      videos: loadedItems.filter((item) => isVideoItem(item)).length,
      generated: loadedItems.filter((item) => item.kind.startsWith('generated')).length,
      uploaded: loadedItems.filter((item) => item.kind.startsWith('uploaded')).length,
      latestCreatedAt: latestTimestamp ? new Date(latestTimestamp).toISOString() : null,
    };
  }, [assetsQuery.data, loadedItems]);

  const statCards = useMemo<GalleryStat[]>(
    () => [
      {
        label: 'Library size',
        value: String(totals.total),
        helper:
          totals.loaded < totals.total
            ? `${totals.loaded} loaded so far`
            : `${visibleItems.length} currently visible`,
        icon: Sparkles,
      },
      {
        label: 'Images',
        value: String(totals.images),
        helper: `${totals.generated} generated assets`,
        icon: ImageIcon,
      },
      {
        label: 'Videos',
        value: String(totals.videos),
        helper: `${totals.uploaded} uploaded assets`,
        icon: Film,
      },
      {
        label: 'Latest activity',
        value: totals.latestCreatedAt
          ? formatRelativeTime(totals.latestCreatedAt)
          : 'No assets yet',
        helper: totals.latestCreatedAt
          ? formatDate(totals.latestCreatedAt)
          : 'Generate or upload to begin',
        icon: RefreshCw,
      },
    ],
    [totals, visibleItems.length],
  );

  const selectedIndex = selectedAssetId
    ? visibleItems.findIndex((item) => item.id === selectedAssetId)
    : -1;
  const selectedItem = selectedIndex >= 0 ? visibleItems[selectedIndex] : null;

  useEffect(() => {
    if (selectedAssetId && !selectedItem) {
      setSelectedAssetId(null);
    }
  }, [selectedAssetId, selectedItem]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !assetsQuery.hasNextPage) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting || assetsQuery.isFetchingNextPage) {
          return;
        }

        void assetsQuery.fetchNextPage();
      },
      { rootMargin: '320px 0px' },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [assetsQuery.fetchNextPage, assetsQuery.hasNextPage, assetsQuery.isFetchingNextPage]);

  const handleDeleteAsset = async (assetId: string) => {
    if (deleteAssetMutation.isPending) {
      return;
    }

    if (!window.confirm('Delete this asset? This cannot be undone.')) {
      return;
    }

    const currentIndex = visibleItems.findIndex((item) => item.id === assetId);
    const fallbackSelection =
      selectedAssetId === assetId
        ? (visibleItems[currentIndex + 1]?.id ?? visibleItems[currentIndex - 1]?.id ?? null)
        : selectedAssetId;

    await deleteAssetMutation.mutateAsync(assetId);
    setSelectedAssetId(fallbackSelection);
  };

  const handleUploadClick = () => {
    uploadInputRef.current?.click();
  };

  const handleUploadChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    await uploadImageMutation.mutateAsync(file);
  };

  const isInitialLoading = tokenQuery.isPending || assetsQuery.isPending;
  const deletingAssetId = deleteAssetMutation.isPending ? deleteAssetMutation.variables : null;
  const matchingCountLabel =
    normalizedSearch || filter !== 'all'
      ? `${visibleItems.length} matching ${visibleItems.length === 1 ? 'asset' : 'assets'}`
      : `${visibleItems.length} ${visibleItems.length === 1 ? 'asset' : 'assets'} visible`;

  return (
    <div className="space-y-6">
      <input
        ref={uploadInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => void handleUploadChange(event)}
      />

      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Gallery</h1>
          <p className="page-description">
            Search, sort, upload, and manage generated media without hitting a hard 20-item wall.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void assetsQuery.refetch()}
            disabled={isInitialLoading || assetsQuery.isFetchingNextPage}
            className="btn-secondary"
          >
            {assetsQuery.isRefetching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </button>
          <button
            type="button"
            onClick={handleUploadClick}
            disabled={uploadImageMutation.isPending}
            className="btn-primary"
          >
            {uploadImageMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Upload image
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((card) => (
          <div key={card.label} className="glass-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs uppercase tracking-[0.24em] text-white/35">
                {card.label}
              </span>
              <card.icon className="h-4 w-4 text-purple-300" />
            </div>
            <div className="text-2xl font-semibold text-white">{card.value}</div>
            <p className="mt-2 text-sm text-white/45">{card.helper}</p>
          </div>
        ))}
      </div>

      <div className="glass-card p-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <label className="relative block flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by prompt, filename, character, style, or asset type"
                className="input-field pl-11"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
                <span className="text-white/45">Sort</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortType)}
                  className="bg-transparent text-sm text-white focus:outline-none"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} className="bg-[#111]">
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={cn(
                    'rounded-lg p-2 text-white/55 transition-colors hover:text-white',
                    viewMode === 'grid' && 'bg-white/10 text-white',
                  )}
                  aria-label="Grid view"
                >
                  <Grid className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'rounded-lg p-2 text-white/55 transition-colors hover:text-white',
                    viewMode === 'list' && 'bg-white/10 text-white',
                  )}
                  aria-label="List view"
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {FILTER_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                  filter === option
                    ? 'border-purple-400/40 bg-purple-500/20 text-white'
                    : 'border-white/10 bg-white/5 text-white/55 hover:border-white/20 hover:text-white',
                )}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/45">
            <span>{matchingCountLabel}</span>
            <span>
              {totals.loaded < totals.total
                ? `Loaded ${totals.loaded} of ${totals.total}. Scroll or use Load more for older items.`
                : 'Everything available is currently loaded.'}
            </span>
          </div>
        </div>
      </div>

      {isInitialLoading ? (
        <GallerySkeleton viewMode={viewMode} />
      ) : assetsQuery.isError && loadedItems.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <FolderOpen className="mx-auto mb-4 h-16 w-16 text-white/10" />
          <h3 className="text-lg font-semibold text-white">Gallery failed to load</h3>
          <p className="mt-2 text-sm text-white/45">
            {assetsQuery.error instanceof Error
              ? assetsQuery.error.message
              : 'Something went wrong while loading your assets.'}
          </p>
          <button
            type="button"
            onClick={() => void assetsQuery.refetch()}
            className="btn-secondary mt-5"
          >
            Try again
          </button>
        </div>
      ) : loadedItems.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <FolderOpen className="mx-auto mb-4 h-16 w-16 text-white/10" />
          <h3 className="text-lg font-semibold text-white">Your gallery is empty</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm text-white/45">
            Generated images, videos, and uploaded references will appear here. Create something or
            upload an image to build your library.
          </p>
          <button type="button" onClick={handleUploadClick} className="btn-primary mt-5">
            <Upload className="mr-2 h-4 w-4" />
            Upload first image
          </button>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Search className="mx-auto mb-4 h-16 w-16 text-white/10" />
          <h3 className="text-lg font-semibold text-white">No assets match this view</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm text-white/45">
            Clear the search or switch filters. If you expect older items, keep loading more pages.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setFilter('all');
            }}
            className="btn-secondary mt-5"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <>
          <div
            className={cn(
              viewMode === 'grid'
                ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
                : 'space-y-3',
            )}
          >
            {visibleItems.map((item) =>
              viewMode === 'grid' ? (
                <GalleryGridCard
                  key={item.id}
                  item={item}
                  deletingAssetId={deletingAssetId}
                  onSelect={() => setSelectedAssetId(item.id)}
                  onDelete={() => void handleDeleteAsset(item.id)}
                />
              ) : (
                <GalleryListRow
                  key={item.id}
                  item={item}
                  deletingAssetId={deletingAssetId}
                  onSelect={() => setSelectedAssetId(item.id)}
                  onDelete={() => void handleDeleteAsset(item.id)}
                />
              ),
            )}
          </div>

          <div ref={loadMoreRef} className="flex flex-col items-center gap-3 pt-2">
            {assetsQuery.isFetchingNextPage ? (
              <div className="flex items-center gap-2 text-sm text-white/50">
                <Loader2 className="h-4 w-4 animate-spin text-purple-300" />
                Loading more assets...
              </div>
            ) : assetsQuery.hasNextPage ? (
              <button
                type="button"
                onClick={() => void assetsQuery.fetchNextPage()}
                className="btn-secondary"
              >
                Load more
              </button>
            ) : (
              <p className="text-sm text-white/35">You’ve reached the end of the gallery.</p>
            )}
          </div>
        </>
      )}

      {selectedItem ? (
        <GalleryModal
          item={selectedItem}
          selectedIndex={selectedIndex}
          totalItems={visibleItems.length}
          deletingAssetId={deletingAssetId}
          onClose={() => setSelectedAssetId(null)}
          onDelete={() => void handleDeleteAsset(selectedItem.id)}
          onNext={
            selectedIndex < visibleItems.length - 1
              ? () => setSelectedAssetId(visibleItems[selectedIndex + 1]?.id ?? null)
              : undefined
          }
          onPrevious={
            selectedIndex > 0
              ? () => setSelectedAssetId(visibleItems[selectedIndex - 1]?.id ?? null)
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function GalleryGridCard({
  item,
  deletingAssetId,
  onSelect,
  onDelete,
}: {
  item: GalleryItem;
  deletingAssetId: string | null;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const isDeleting = deletingAssetId === item.id;

  return (
    <article className="glass-card overflow-hidden transition-transform duration-300 hover:-translate-y-1">
      <div className="relative aspect-[4/3] overflow-hidden bg-black/30">
        <button type="button" onClick={onSelect} className="group block h-full w-full text-left">
          <GalleryPreview
            item={item}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />

          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
            <span className="rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white/80 backdrop-blur-sm">
              {getAssetBadgeLabel(item)}
            </span>
            <span className="rounded-full border border-white/10 bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white/65 backdrop-blur-sm">
              {getAssetMetrics(item)}
            </span>
          </div>

          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/10 to-transparent opacity-95" />

          <div className="absolute inset-x-0 bottom-0 p-4">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{getAssetTitle(item)}</p>
                <p className="mt-1 truncate text-xs text-white/55">{getAssetSubtitle(item)}</p>
              </div>
              <div className="w-20" />
            </div>
          </div>
        </button>

        <div className="absolute bottom-4 right-4 flex items-center gap-2">
          <a
            href={item.url}
            download
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/10 bg-black/45 p-2 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/65"
            aria-label="Download asset"
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="rounded-full border border-red-400/20 bg-black/45 p-2 text-red-300 backdrop-blur-sm transition-colors hover:bg-black/65 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Delete asset"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

function GalleryListRow({
  item,
  deletingAssetId,
  onSelect,
  onDelete,
}: {
  item: GalleryItem;
  deletingAssetId: string | null;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const isDeleting = deletingAssetId === item.id;

  return (
    <article className="glass-card p-3">
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <button
          type="button"
          onClick={onSelect}
          className="flex flex-1 items-center gap-4 text-left transition-opacity hover:opacity-100 md:min-w-0"
        >
          <div className="h-20 w-24 flex-shrink-0 overflow-hidden rounded-2xl bg-black/30">
            <GalleryPreview item={item} className="h-full w-full object-cover" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-white">{getAssetTitle(item)}</p>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/55">
                {getAssetBadgeLabel(item)}
              </span>
            </div>
            <p className="mt-1 truncate text-sm text-white/50">{getAssetSubtitle(item)}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/40">
              <span>{getAssetMetrics(item)}</span>
              <span>{formatFileSize(item.fileSizeBytes)}</span>
              <span>{formatRelativeTime(item.createdAt)}</span>
              {item.sourceJob?.characterName ? <span>{item.sourceJob.characterName}</span> : null}
              {item.sourceJob?.stylePackName ? <span>{item.sourceJob.stylePackName}</span> : null}
            </div>
          </div>
        </button>

        <div className="flex items-center gap-2 md:self-stretch">
          <a
            href={item.url}
            download
            target="_blank"
            rel="noreferrer"
            className="btn-secondary px-4 py-2"
          >
            <Download className="mr-2 h-4 w-4" />
            Download
          </a>
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="btn-secondary px-4 py-2 text-red-200 hover:text-red-100"
          >
            {isDeleting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-2 h-4 w-4" />
            )}
            Delete
          </button>
        </div>
      </div>
    </article>
  );
}

function GalleryModal({
  item,
  selectedIndex,
  totalItems,
  deletingAssetId,
  onClose,
  onDelete,
  onNext,
  onPrevious,
}: {
  item: GalleryItem;
  selectedIndex: number;
  totalItems: number;
  deletingAssetId: string | null;
  onClose: () => void;
  onDelete: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
}) {
  const isDeleting = deletingAssetId === item.id;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }

      if (event.key === 'ArrowRight') {
        onNext?.();
      }

      if (event.key === 'ArrowLeft') {
        onPrevious?.();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, onNext, onPrevious]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md sm:p-6"
      onClick={onClose}
    >
      <div
        className="relative grid max-h-[calc(100vh-2rem)] w-full max-w-6xl overflow-hidden rounded-[28px] border border-white/10 bg-[#090909] shadow-2xl shadow-black/50 lg:grid-cols-[minmax(0,1fr)_360px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative flex min-h-[45vh] items-center justify-center overflow-hidden bg-black/55 p-6">
          {onPrevious ? (
            <button
              type="button"
              onClick={onPrevious}
              className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/10 bg-black/50 p-2 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70"
              aria-label="Previous asset"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}

          {onNext ? (
            <button
              type="button"
              onClick={onNext}
              className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/10 bg-black/50 p-2 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/70"
              aria-label="Next asset"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="absolute right-4 top-4 z-10 rounded-full border border-white/10 bg-black/50 p-2 text-white/70 backdrop-blur-sm transition-colors hover:bg-black/70 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>

          {isVideoItem(item) ? (
            <video
              src={item.url}
              controls
              autoPlay
              loop
              playsInline
              className="max-h-[72vh] max-w-full rounded-2xl object-contain"
            />
          ) : (
            <img
              src={item.url}
              alt={getAssetTitle(item)}
              className="max-h-[72vh] max-w-full rounded-2xl object-contain"
            />
          )}
        </div>

        <div className="flex flex-col overflow-y-auto border-t border-white/10 bg-white/[0.03] p-6 lg:border-l lg:border-t-0">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-white/35">
                {selectedIndex + 1} of {totalItems}
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">{getAssetTitle(item)}</h2>
              <p className="mt-1 text-sm text-white/45">{getAssetSubtitle(item)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <InfoCard label="Created" value={formatDate(item.createdAt)} />
            <InfoCard label="Relative" value={formatRelativeTime(item.createdAt)} />
            <InfoCard label="Type" value={getAssetBadgeLabel(item)} />
            <InfoCard label="Metrics" value={getAssetMetrics(item)} />
            <InfoCard label="File size" value={formatFileSize(item.fileSizeBytes)} />
            <InfoCard label="Duration" value={formatDuration(item.durationSec)} />
          </div>

          {item.sourceJob?.prompt ? (
            <div className="mt-6">
              <p className="text-xs uppercase tracking-[0.24em] text-white/35">Prompt</p>
              <p className="mt-3 rounded-2xl border border-white/10 bg-black/30 p-4 text-sm leading-6 text-white/80">
                {item.sourceJob.prompt}
              </p>
            </div>
          ) : null}

          <div className="mt-6 space-y-3">
            <MetadataRow
              label="Filename"
              value={item.metadata.originalFileName || 'Not available'}
            />
            <MetadataRow label="Character" value={item.sourceJob?.characterName || 'Not linked'} />
            <MetadataRow label="Style pack" value={item.sourceJob?.stylePackName || 'Not linked'} />
            <MetadataRow
              label="Job type"
              value={formatKind(item.sourceJob?.jobType || item.kind)}
            />
          </div>

          <div className="mt-8 flex flex-col gap-3">
            <a href={item.url} download target="_blank" rel="noreferrer" className="btn-primary">
              <Download className="mr-2 h-4 w-4" />
              Download asset
            </a>
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              className="btn-secondary justify-center text-red-200 hover:text-red-100"
            >
              {isDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete asset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GalleryPreview({ item, className }: { item: GalleryItem; className: string }) {
  if (isVideoItem(item)) {
    return <video src={item.url} muted playsInline preload="metadata" className={className} />;
  }

  return <img src={item.url} alt={getAssetTitle(item)} className={className} />;
}

function GallerySkeleton({ viewMode }: { viewMode: ViewMode }) {
  return (
    <div
      className={cn(
        viewMode === 'grid'
          ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
          : 'space-y-3',
      )}
    >
      {Array.from({ length: viewMode === 'grid' ? 8 : 5 }, (_, index) =>
        viewMode === 'grid' ? (
          <div key={index} className="glass-card overflow-hidden">
            <div className="skeleton aspect-[4/3] w-full" />
            <div className="space-y-3 p-4">
              <div className="skeleton h-4 w-2/3 rounded-full" />
              <div className="skeleton h-3 w-full rounded-full" />
            </div>
          </div>
        ) : (
          <div key={index} className="glass-card p-3">
            <div className="flex gap-4">
              <div className="skeleton h-20 w-24 rounded-2xl" />
              <div className="flex-1 space-y-3 py-2">
                <div className="skeleton h-4 w-1/3 rounded-full" />
                <div className="skeleton h-3 w-3/4 rounded-full" />
                <div className="skeleton h-3 w-2/3 rounded-full" />
              </div>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <p className="text-xs uppercase tracking-[0.18em] text-white/35">{label}</p>
      <p className="mt-2 text-sm font-medium text-white/85">{value}</p>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 pb-3 text-sm last:border-b-0 last:pb-0">
      <span className="text-white/35">{label}</span>
      <span className="max-w-[65%] text-right text-white/75">{value}</span>
    </div>
  );
}

function isVideoItem(item: GalleryItem) {
  return item.mimeType.startsWith('video/') || item.kind.includes('video');
}

function matchesFilter(item: GalleryItem, filter: FilterType) {
  switch (filter) {
    case 'all':
      return true;
    case 'image':
      return !isVideoItem(item);
    case 'video':
      return isVideoItem(item);
    case 'generated':
      return item.kind.startsWith('generated');
    case 'uploaded':
      return item.kind.startsWith('uploaded');
    default:
      return true;
  }
}

function getAssetSearchText(item: GalleryItem) {
  return [
    item.kind,
    item.mimeType,
    item.metadata.originalFileName,
    item.metadata.uploadSource,
    item.sourceJob?.prompt,
    item.sourceJob?.characterName,
    item.sourceJob?.stylePackName,
    item.sourceJob?.jobType,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function getAssetTitle(item: GalleryItem) {
  return item.metadata.originalFileName || formatKind(item.kind);
}

function getAssetSubtitle(item: GalleryItem) {
  if (item.sourceJob?.prompt) {
    return item.sourceJob.prompt;
  }

  if (item.sourceJob?.characterName) {
    return item.sourceJob.characterName;
  }

  return item.mimeType;
}

function getAssetBadgeLabel(item: GalleryItem) {
  if (item.kind.startsWith('uploaded')) {
    return 'Upload';
  }

  if (isVideoItem(item)) {
    return 'Video';
  }

  return 'Generated image';
}

function getAssetMetrics(item: GalleryItem) {
  const resolution =
    item.width && item.height
      ? `${item.width}x${item.height}`
      : isVideoItem(item)
        ? 'Video'
        : 'Image';

  if (item.durationSec) {
    return `${resolution} • ${formatDuration(item.durationSec)}`;
  }

  return resolution;
}

function formatKind(value: string) {
  return value.replace(/[-_]/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatFileSize(bytes: string) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) {
    return 'Unknown';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let current = size;

  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024;
    unitIndex += 1;
  }

  return `${current >= 10 || unitIndex === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[unitIndex]}`;
}

function formatDuration(durationSec: number | null) {
  if (!durationSec || durationSec <= 0) {
    return 'N/A';
  }

  const totalSeconds = Math.round(durationSec);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds}s`;
}
