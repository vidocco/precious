import type {
  BackupStatus,
  CollectionDto,
  CollectionInput,
  CollectionUpdate,
  ComputedStatus,
  CreateUserInput,
  EndpointDto,
  EndpointInput,
  FigureValue,
  FillResult,
  FormulaTryInput,
  FormulaTryResult,
  HistoryPoint,
  ItemBatchUpdate,
  ItemDto,
  ItemHistoryPoint,
  ItemInput,
  ItemListQuery,
  ItemListResponse,
  ItemUpdate,
  LookupFillInput,
  LookupSearchResponse,
  PresetDto,
  RefreshInput,
  RefreshResult,
  RemoteImageInput,
  RunRequest,
  RunResult,
  SearchResponse,
  SecretsUpdate,
  SetupInput,
  SetupStatus,
  SourceDto,
  SourceInput,
  TemplateDto,
  TemplateInput,
  TryBindingsInput,
  TryBindingsResult,
  UpdateUserInput,
  UserDto,
} from '@precious/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, api } from './client.ts';

export interface RecentItem extends ItemDto {
  collection: { id: string; name: string; accent: string };
}

export interface PublicCollection {
  collection: { name: string; accent: string; ownerName: string; accessionPrefix: string };
  template: TemplateDto;
  items: ItemDto[];
}

export const keys = {
  setup: ['setup'] as const,
  me: ['me'] as const,
  users: ['users'] as const,
  templates: ['templates'] as const,
  template: (id: string) => ['templates', id] as const,
  collections: ['collections'] as const,
  collection: (id: string) => ['collections', id] as const,
  figures: (id: string) => ['collections', id, 'figures'] as const,
  items: (id: string, q: ItemListQuery) => ['collections', id, 'items', q] as const,
  item: (id: string) => ['items', id] as const,
  recent: ['items', 'recent'] as const,
  search: (q: string) => ['search', q] as const,
  public: (slug: string) => ['public', slug] as const,
};

function qs(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') continue;
    if (Array.isArray(v)) for (const x of v) sp.append(k, String(x));
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ---------------------------------------------------------------- session

export const useSetupStatus = () =>
  useQuery({ queryKey: keys.setup, queryFn: () => api.get<SetupStatus>('/api/setup') });

export const useMe = () =>
  useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.get<UserDto>('/api/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 60_000,
  });

export function useSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetupInput) => api.post<UserDto>('/api/setup', input),
    onSuccess: () => qc.resetQueries({ queryKey: keys.setup }),
  });
}

// ---------------------------------------------------------------- users

export const useUsers = () => useQuery({ queryKey: keys.users, queryFn: () => api.get<UserDto[]>('/api/users') });

export function useUserMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: keys.users });
  return {
    create: useMutation({ mutationFn: (i: CreateUserInput) => api.post<UserDto>('/api/users', i), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, ...i }: UpdateUserInput & { id: string }) => api.patch<UserDto>(`/api/users/${id}`, i),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.del(`/api/users/${id}`), onSuccess: done }),
  };
}

// ---------------------------------------------------------------- templates

export const useTemplates = () =>
  useQuery({ queryKey: keys.templates, queryFn: () => api.get<TemplateDto[]>('/api/templates') });

export const useTemplate = (id: string | undefined) =>
  useQuery({
    queryKey: keys.template(id ?? ''),
    queryFn: () => api.get<TemplateDto>(`/api/templates/${id}`),
    enabled: !!id,
  });

export function useTemplateMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: keys.templates });
  return {
    create: useMutation({
      mutationFn: (t: TemplateInput) => api.post<TemplateDto>('/api/templates', t),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...t }: TemplateInput & { id: string }) => api.put<TemplateDto>(`/api/templates/${id}`, t),
      onSuccess: () => {
        done();
        // Layout changes show up on every collection using the template.
        qc.invalidateQueries({ queryKey: keys.collections });
      },
    }),
    remove: useMutation({ mutationFn: (id: string) => api.del(`/api/templates/${id}`), onSuccess: done }),
  };
}

// ---------------------------------------------------------------- collections

export const useCollections = () =>
  useQuery({ queryKey: keys.collections, queryFn: () => api.get<CollectionDto[]>('/api/collections') });

export const useCollection = (id: string) =>
  useQuery({
    queryKey: keys.collection(id),
    queryFn: () => api.get<CollectionDto>(`/api/collections/${id}`),
    enabled: !!id,
  });

export const useFigures = (id: string) =>
  useQuery({ queryKey: keys.figures(id), queryFn: () => api.get<FigureValue[]>(`/api/collections/${id}/figures`) });

export function useCollectionMutations() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: keys.collections });
    qc.invalidateQueries({ queryKey: keys.templates });
  };
  return {
    create: useMutation({
      mutationFn: (c: CollectionInput) => api.post<CollectionDto>('/api/collections', c),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...c }: CollectionUpdate & { id: string }) =>
        api.patch<CollectionDto>(`/api/collections/${id}`, c),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.del(`/api/collections/${id}`), onSuccess: done }),
  };
}

// ---------------------------------------------------------------- items

export const useItems = (collectionId: string, query: ItemListQuery, enabled = true) =>
  useQuery({
    queryKey: keys.items(collectionId, query),
    queryFn: () => api.get<ItemListResponse>(`/api/collections/${collectionId}/items${qs({ ...query })}`),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useItem = (id: string) =>
  useQuery({ queryKey: keys.item(id), queryFn: () => api.get<ItemDto>(`/api/items/${id}`), enabled: !!id });

export const useRecentItems = () =>
  useQuery({ queryKey: keys.recent, queryFn: () => api.get<RecentItem[]>('/api/items/recent?limit=12') });

export function useItemMutations() {
  const qc = useQueryClient();
  const done = (item?: ItemDto, deletedId?: string) => {
    qc.invalidateQueries({ queryKey: keys.collections });
    // A deleted item's own page is still mounted for a moment; don't refetch it into a 404.
    qc.invalidateQueries({ queryKey: ['items'], predicate: (q) => !deletedId || q.queryKey[1] !== deletedId });
    qc.invalidateQueries({ queryKey: ['search'] });
    if (item) qc.setQueryData(keys.item(item.id), item);
  };
  return {
    create: useMutation({
      mutationFn: ({ collectionId, ...i }: ItemInput & { collectionId: string }) =>
        api.post<ItemDto>(`/api/collections/${collectionId}/items`, i),
      onSuccess: (item) => done(item),
    }),
    update: useMutation({
      mutationFn: ({ id, ...i }: ItemUpdate & { id: string }) => api.patch<ItemDto>(`/api/items/${id}`, i),
      onSuccess: (item) => done(item),
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del(`/api/items/${id}`),
      onSuccess: (_r, id) => done(undefined, id),
    }),
    /** Several items of a collection at once: all saved, or none. */
    updateMany: useMutation({
      mutationFn: ({ collectionId, items }: ItemBatchUpdate & { collectionId: string }) =>
        api.patch<{ items: ItemDto[] }>(`/api/collections/${collectionId}/items`, { items }),
      onSuccess: (r) => {
        done();
        for (const item of r.items) qc.setQueryData(keys.item(item.id), item);
      },
    }),
  };
}

export const uploadImage = (file: File) =>
  api.upload<{ id: string; width: number; height: number; color: string }>('/api/images', file);

// ---------------------------------------------------------------- search-to-add

/** Searches one of the collection template's data sources (debounce the query first). */
export const useLookupSearch = (collectionId: string, provider: string | undefined, query: string) =>
  useQuery({
    queryKey: ['lookup', collectionId, provider, query],
    queryFn: () =>
      api.post<LookupSearchResponse>(`/api/collections/${collectionId}/lookup/search`, { provider, query }),
    enabled: !!provider && query.trim().length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    retry: false,
  });

export function useLookupMutations() {
  return {
    fill: useMutation({
      mutationFn: ({ collectionId, ...input }: LookupFillInput & { collectionId: string }) =>
        api.post<FillResult>(`/api/collections/${collectionId}/lookup/fill`, input),
    }),
    refresh: useMutation({
      mutationFn: ({ id, ...input }: RefreshInput & { id: string }) =>
        api.post<RefreshResult>(`/api/items/${id}/refresh`, input),
    }),
    tryBindings: useMutation({
      mutationFn: (input: TryBindingsInput) => api.post<TryBindingsResult>('/api/templates/try', input),
    }),
  };
}

export const importRemoteImage = (input: RemoteImageInput) =>
  api.post<{ id: string; width: number; height: number; color: string | null }>('/api/images/remote', input);

// ---------------------------------------------------------------- values kept up to date

export const useComputedStatus = (templateId: string | undefined) =>
  useQuery({
    queryKey: ['computed', templateId],
    queryFn: () => api.get<ComputedStatus[]>(`/api/templates/${templateId}/computed`),
    enabled: !!templateId,
    refetchInterval: 15_000,
  });

export const useItemHistory = (itemId: string, field: string | undefined) =>
  useQuery({
    queryKey: ['items', itemId, 'history', field],
    queryFn: () => api.get<ItemHistoryPoint[]>(`/api/items/${itemId}/history${qs({ field })}`),
    enabled: !!field,
  });

export const useCollectionHistory = (collectionId: string, field: string | undefined, days = 90) =>
  useQuery({
    queryKey: ['collections', collectionId, 'history', field, days],
    queryFn: () =>
      api.get<HistoryPoint[]>(`/api/collections/${collectionId}/history${qs({ field, days: String(days) })}`),
    enabled: !!field,
  });

export function useComputedMutations() {
  const qc = useQueryClient();
  return {
    runField: useMutation({
      mutationFn: ({ templateId, field }: { templateId: string; field: string }) =>
        api.post<ComputedStatus[]>(`/api/templates/${templateId}/computed/${field}/run`),
      onSuccess: (status, { templateId }) => qc.setQueryData(['computed', templateId], status),
    }),
    computeItem: useMutation({
      mutationFn: (itemId: string) =>
        api.post<{ item: ItemDto; updated: string[]; failed: { field: string; message: string }[]; skipped: string[] }>(
          `/api/items/${itemId}/compute`,
        ),
      onSuccess: (r) => {
        qc.setQueryData(keys.item(r.item.id), r.item);
        qc.invalidateQueries({ queryKey: ['items', r.item.id, 'history'] });
        qc.invalidateQueries({ queryKey: keys.collections });
      },
    }),
  };
}

export const tryFormula = (input: FormulaTryInput) => api.post<FormulaTryResult>('/api/formula/try', input);

// ---------------------------------------------------------------- server

export const useBackups = () =>
  useQuery({ queryKey: ['backups'], queryFn: () => api.get<BackupStatus>('/api/server/backups') });

export function useBackupNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BackupStatus>('/api/server/backups'),
    onSuccess: (status) => qc.setQueryData(['backups'], status),
    onError: () => qc.invalidateQueries({ queryKey: ['backups'] }),
  });
}

// ---------------------------------------------------------------- search & public

export const useSearch = (q: string) =>
  useQuery({
    queryKey: keys.search(q),
    queryFn: () => api.get<SearchResponse>(`/api/search${qs({ q })}`),
    enabled: q.trim().length >= 2,
    placeholderData: keepPreviousData,
  });

export const usePublicCollection = (slug: string) =>
  useQuery({ queryKey: keys.public(slug), queryFn: () => api.get<PublicCollection>(`/api/public/${slug}`) });

// ---------------------------------------------------------------- data sources

export const sourceKeys = {
  all: ['sources'] as const,
  one: (id: string) => ['sources', id] as const,
  presets: ['presets'] as const,
};

export const useSources = () =>
  useQuery({ queryKey: sourceKeys.all, queryFn: () => api.get<SourceDto[]>('/api/sources') });

export const useSource = (id: string) =>
  useQuery({ queryKey: sourceKeys.one(id), queryFn: () => api.get<SourceDto>(`/api/sources/${id}`), enabled: !!id });

export const usePresets = () =>
  useQuery({
    queryKey: sourceKeys.presets,
    queryFn: () => api.get<PresetDto[]>('/api/recipes/presets'),
    staleTime: Infinity,
  });

export interface InstalledRecipe {
  source: SourceDto;
  missingSecrets: string[];
}

export function useSourceMutations() {
  const qc = useQueryClient();
  const done = (s?: SourceDto) => {
    qc.invalidateQueries({ queryKey: sourceKeys.all });
    if (s) qc.setQueryData(sourceKeys.one(s.id), s);
  };
  return {
    create: useMutation({ mutationFn: (s: SourceInput) => api.post<SourceDto>('/api/sources', s), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, ...s }: SourceInput & { id: string }) => api.put<SourceDto>(`/api/sources/${id}`, s),
      onSuccess: done,
    }),
    setSecrets: useMutation({
      mutationFn: ({ id, secrets }: { id: string; secrets: SecretsUpdate }) =>
        api.put<SourceDto>(`/api/sources/${id}/secrets`, secrets),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.del(`/api/sources/${id}`),
      onSuccess: (_r, id) => {
        qc.removeQueries({ queryKey: sourceKeys.one(id) });
        qc.invalidateQueries({ queryKey: sourceKeys.all });
      },
    }),
    importRecipe: useMutation({
      mutationFn: (recipe: unknown) => api.post<InstalledRecipe>('/api/sources/import', recipe),
      onSuccess: (r) => done(r.source),
    }),
    installPreset: useMutation({
      mutationFn: (key: string) => api.post<InstalledRecipe>(`/api/recipes/presets/${key}/install`),
      onSuccess: (r) => done(r.source),
    }),
  };
}

export function useEndpointMutations(sourceId: string) {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: sourceKeys.one(sourceId) });
    qc.invalidateQueries({ queryKey: sourceKeys.all });
  };
  return {
    create: useMutation({
      mutationFn: (e: EndpointInput) => api.post<EndpointDto>(`/api/sources/${sourceId}/endpoints`, e),
      onSuccess: done,
    }),
    update: useMutation({
      mutationFn: ({ id, ...e }: EndpointInput & { id: string }) => api.put<EndpointDto>(`/api/endpoints/${id}`, e),
      onSuccess: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api.del(`/api/endpoints/${id}`), onSuccess: done }),
    run: useMutation({
      mutationFn: (r: RunRequest) => api.post<RunResult>(`/api/sources/${sourceId}/run`, r),
      // Runs update the source's last call.
      onSuccess: () => qc.invalidateQueries({ queryKey: sourceKeys.all }),
    }),
  };
}

/** Downloads a source as a recipe file. */
export async function downloadRecipe(source: Pick<SourceDto, 'id' | 'name'>) {
  const recipe = await api.get<unknown>(`/api/sources/${source.id}/export`);
  const blob = new Blob([JSON.stringify(recipe, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${source.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'source'}.precious.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
