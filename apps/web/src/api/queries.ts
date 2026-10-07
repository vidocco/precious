import type {
  CollectionDto,
  CollectionInput,
  CollectionUpdate,
  CreateUserInput,
  FigureValue,
  ItemDto,
  ItemInput,
  ItemListQuery,
  ItemListResponse,
  ItemUpdate,
  SearchResponse,
  SetupInput,
  SetupStatus,
  TemplateDto,
  TemplateInput,
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

export const useItems = (collectionId: string, query: ItemListQuery) =>
  useQuery({
    queryKey: keys.items(collectionId, query),
    queryFn: () => api.get<ItemListResponse>(`/api/collections/${collectionId}/items${qs({ ...query })}`),
    placeholderData: keepPreviousData,
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
  };
}

export const uploadImage = (file: File) =>
  api.upload<{ id: string; width: number; height: number; color: string }>('/api/images', file);

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
