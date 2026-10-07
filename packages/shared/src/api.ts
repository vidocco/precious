import { z } from 'zod';
import type { TemplateData } from './template.ts';

/** Request bodies and response shapes shared by the server and the web app. */

// ---------------------------------------------------------------- users

export const ROLES = ['admin', 'member'] as const;
export type Role = (typeof ROLES)[number];

export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(128);

export const setupInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
});
export type SetupInput = z.infer<typeof setupInputSchema>;

export const createUserInputSchema = setupInputSchema.extend({ role: z.enum(ROLES).default('member') });
export type CreateUserInput = z.input<typeof createUserInputSchema>;

export const updateUserInputSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  role: z.enum(ROLES).optional(),
  password: passwordSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface SetupStatus {
  needsSetup: boolean;
}

// ---------------------------------------------------------------- templates

export interface TemplateDto extends TemplateData {
  id: string;
  createdBy: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** Collections using this template that the viewer can see. */
  usage: { id: string; name: string; ownerName: string }[];
  canEdit: boolean;
}

// ---------------------------------------------------------------- collections

export const VISIBILITIES = ['private', 'household', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const EDIT_ACCESS = ['owner', 'household'] as const;
export type EditAccess = (typeof EDIT_ACCESS)[number];
export const ACCENTS = ['ultramarine', 'teal', 'moss', 'saffron', 'oxblood', 'plum'] as const;
export type Accent = (typeof ACCENTS)[number];
export const VIEWS = ['wall', 'table'] as const;
export type View = (typeof VIEWS)[number];

export const collectionInputSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  accent: z.enum(ACCENTS).default('ultramarine'),
  icon: z.string().max(32).default('grid'),
  accessionPrefix: z
    .string()
    .regex(/^[A-Z0-9]{1,4}$/, 'Up to 4 capital letters or digits')
    .optional(),
  defaultView: z.enum(VIEWS).default('wall'),
  visibility: z.enum(VISIBILITIES).default('household'),
  editAccess: z.enum(EDIT_ACCESS).default('owner'),
});
export type CollectionInput = z.input<typeof collectionInputSchema>;

export const collectionUpdateSchema = collectionInputSchema.partial().omit({ templateId: true });
export type CollectionUpdate = z.input<typeof collectionUpdateSchema>;

export interface CollectionDto {
  id: string;
  templateId: string;
  ownerId: string;
  ownerName: string;
  name: string;
  accent: Accent;
  icon: string;
  accessionPrefix: string;
  defaultView: View;
  visibility: Visibility;
  publicSlug: string | null;
  editAccess: EditAccess;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

export interface FigureValue {
  id: string;
  label: string;
  value: number | null;
  /** How to format: count, or the summed field's type. */
  format: 'count' | 'number' | 'money' | 'duration' | 'rating';
  currency?: string;
  unit?: string;
}

// ---------------------------------------------------------------- items

export const itemInputSchema = z.object({
  title: z.string().trim().min(1, 'Give it a title').max(300),
  coverImageId: z.string().uuid().nullable().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type ItemInput = z.input<typeof itemInputSchema>;

export const itemUpdateSchema = itemInputSchema.partial();
export type ItemUpdate = z.input<typeof itemUpdateSchema>;

export interface FieldMeta {
  source: 'user' | string;
  locked?: boolean;
  by?: string;
  at?: string;
}

export interface CoverDto {
  id: string;
  width: number;
  height: number;
  color: string | null;
}

export interface ItemDto {
  id: string;
  collectionId: string;
  accessionNo: number;
  accession: string;
  title: string;
  cover: CoverDto | null;
  data: Record<string, unknown>;
  fieldMeta: Record<string, FieldMeta>;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export const SORT_DIRS = ['asc', 'desc'] as const;

export const itemListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  /** `$title`, `$added`, `$accession` or a field id. */
  sort: z.string().max(40).default('$added'),
  dir: z.enum(SORT_DIRS).default('desc'),
  /** Filters as `fieldId:value`, repeatable. */
  filter: z.union([z.string(), z.array(z.string())]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(60),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ItemListQuery = z.input<typeof itemListQuerySchema>;

export interface ItemMatch {
  label: string;
  /** Snippet with the matched part wrapped in « and ». */
  snippet: string;
}

export interface ItemListResponse {
  items: (ItemDto & { match?: ItemMatch })[];
  total: number;
}

// ---------------------------------------------------------------- search

export interface SearchHit {
  item: ItemDto;
  match: ItemMatch;
}

export interface SearchGroup {
  collection: Pick<CollectionDto, 'id' | 'name' | 'accent'>;
  total: number;
  hits: SearchHit[];
}

export interface SearchResponse {
  q: string;
  total: number;
  groups: SearchGroup[];
}

// ---------------------------------------------------------------- errors

export interface ApiError {
  error: string;
  message: string;
  issues?: { path: string; message: string }[];
}
