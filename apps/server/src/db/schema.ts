import type { FieldMeta, TemplateData } from '@precious/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------- auth (Better Auth)

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role').notNull().default('member'),
  ...timestamps,
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  ...timestamps,
});

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  ...timestamps,
});

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ...timestamps,
});

// ---------------------------------------------------------------- templates

export const templates = pgTable('templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  icon: text('icon').notNull().default('grid'),
  accessionPrefix: text('accession_prefix').notNull().default('IT'),
  fields: jsonb('fields').$type<TemplateData['fields']>().notNull().default([]),
  card: jsonb('card').$type<TemplateData['card']>().notNull(),
  itemLayout: jsonb('item_layout').$type<TemplateData['itemLayout']>().notNull(),
  header: jsonb('header').$type<TemplateData['header']>().notNull(),
  /** Shelf sizing rules arrive with the shelf view. */
  shelf: jsonb('shelf'),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  version: integer('version').notNull().default(1),
  ...timestamps,
});

// ---------------------------------------------------------------- collections

export const visibility = pgEnum('visibility', ['private', 'household', 'public']);
export const editAccess = pgEnum('edit_access', ['owner', 'household']);

export const collections = pgTable(
  'collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'restrict' }),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    accent: text('accent').notNull().default('ultramarine'),
    icon: text('icon').notNull().default('grid'),
    accessionPrefix: text('accession_prefix').notNull(),
    accessionNext: integer('accession_next').notNull().default(1),
    defaultView: text('default_view').notNull().default('wall'),
    visibility: visibility('visibility').notNull().default('household'),
    publicSlug: text('public_slug').unique(),
    editAccess: editAccess('edit_access').notNull().default('owner'),
    ...timestamps,
  },
  (t) => [index('collections_owner_idx').on(t.ownerId), index('collections_template_idx').on(t.templateId)],
);

// ---------------------------------------------------------------- images

export const images = pgTable('images', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: text('owner_id').references(() => user.id, { onDelete: 'set null' }),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  color: text('color'),
  mime: text('mime').notNull(),
  bytes: integer('bytes').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- items

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: uuid('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    accessionNo: integer('accession_no').notNull(),
    title: text('title').notNull(),
    coverImageId: uuid('cover_image_id').references(() => images.id, { onDelete: 'set null' }),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    fieldMeta: jsonb('field_meta').$type<Record<string, FieldMeta>>().notNull().default({}),
    externalRefs: jsonb('external_refs').$type<Record<string, string>>().notNull().default({}),
    /** Lower-cased, accent-free text of every searchable value, rebuilt on each write. */
    searchText: text('search_text').notNull().default(''),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('items_collection_accession_idx').on(t.collectionId, t.accessionNo),
    index('items_collection_title_idx').on(t.collectionId, t.title),
    index('items_collection_created_idx').on(t.collectionId, t.createdAt),
    index('items_data_idx').using('gin', t.data),
    index('items_search_trgm_idx').using('gin', sql`${t.searchText} gin_trgm_ops`),
  ],
);
