import type { SetupStatus, UserDto } from '@precious/shared';
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { ApiError, api } from '../api/client.ts';
import { keys } from '../api/queries.ts';
import { LoginPage } from '../features/auth/LoginPage.tsx';
import { SetupPage } from '../features/auth/SetupPage.tsx';
import { CollectionFormPage } from '../features/collections/CollectionFormPage.tsx';
import { CollectionPage } from '../features/collections/CollectionPage.tsx';
import { DataLayout, ImportExportPage } from '../features/data/DataLayout.tsx';
import { CollectionsIndexPage, HomePage } from '../features/home/HomePage.tsx';
import { ItemFormPage } from '../features/items/ItemFormPage.tsx';
import { ItemPage } from '../features/items/ItemPage.tsx';
import { PublicCollectionPage, PublicItemPage } from '../features/public/PublicPages.tsx';
import { ServerPage } from '../features/server/ServerPage.tsx';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';
import { AppShell } from '../features/shell/AppShell.tsx';
import { SearchPage } from '../features/shell/SearchPage.tsx';
import { EndpointPage } from '../features/sources/EndpointPage.tsx';
import { SourcePage } from '../features/sources/SourcePage.tsx';
import { SourcesListPage } from '../features/sources/SourcesListPage.tsx';
import { TemplateEditorPage } from '../features/templates/TemplateEditorPage.tsx';
import { TemplatesListPage } from '../features/templates/TemplatesListPage.tsx';

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: () => (
    <div className="grid min-h-[50vh] place-items-center text-ink-muted">That page doesn’t exist.</div>
  ),
});

async function needsSetup(qc: QueryClient) {
  const status = await qc.ensureQueryData({ queryKey: keys.setup, queryFn: () => api.get<SetupStatus>('/api/setup') });
  return status.needsSetup;
}

async function currentUser(qc: QueryClient) {
  return qc.ensureQueryData({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api.get<UserDto>('/api/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  beforeLoad: async ({ context }) => {
    if (!(await needsSetup(context.queryClient))) throw redirect({ to: '/' });
  },
  component: SetupPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: async ({ context }) => {
    if (await needsSetup(context.queryClient)) throw redirect({ to: '/setup' });
    if (await currentUser(context.queryClient)) throw redirect({ to: '/' });
  },
  component: LoginPage,
});

const publicRoute = createRoute({ getParentRoute: () => rootRoute, path: '/p/$slug', component: PublicCollectionPage });
const publicItemRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$slug/$itemId',
  component: PublicItemPage,
});

/** Everything behind sign-in shares the top bar. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    if (await needsSetup(context.queryClient)) throw redirect({ to: '/setup' });
    const me = await currentUser(context.queryClient);
    if (!me) throw redirect({ to: '/login', search: { redirect: location.href } });
  },
  component: AppShell,
});

const child = <P extends string>(path: P, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => appRoute, path, component });

const homeRoute = child('/', HomePage);
const collectionsRoute = child('/collections', CollectionsIndexPage);
const newCollectionRoute = child('/collections/new', () => <CollectionFormPage mode="create" />);
const collectionRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/c/$collectionId',
  validateSearch: z.object({
    q: z.string().optional(),
    sort: z.string().optional(),
    dir: z.enum(['asc', 'desc']).optional(),
    view: z.enum(['wall', 'table']).optional(),
    filter: z.array(z.string()).optional(),
  }),
  component: CollectionPage,
});
const editCollectionRoute = child('/c/$collectionId/edit', () => <CollectionFormPage mode="edit" />);
const newItemRoute = child('/c/$collectionId/new', () => <ItemFormPage mode="create" />);
const itemRoute = child('/i/$itemId', ItemPage);
const editItemRoute = child('/i/$itemId/edit', () => <ItemFormPage mode="edit" />);
const searchRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/search',
  validateSearch: z.object({ q: z.string().optional() }),
  component: SearchPage,
});
const settingsRoute = child('/settings', SettingsPage);
const serverRoute = child('/server', ServerPage);

const dataRoute = child('/data', DataLayout);
const dataIndexRoute = createRoute({
  getParentRoute: () => dataRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/data/templates' });
  },
});
const templatesRoute = createRoute({
  getParentRoute: () => dataRoute,
  path: '/templates',
  component: TemplatesListPage,
});
const newTemplateRoute = createRoute({
  getParentRoute: () => dataRoute,
  path: '/templates/new',
  validateSearch: z.object({ from: z.string().optional() }),
  component: () => <TemplateEditorPage mode="create" />,
});
const templateRoute = createRoute({
  getParentRoute: () => dataRoute,
  path: '/templates/$templateId',
  component: () => <TemplateEditorPage mode="edit" />,
});
const sourcesRoute = createRoute({ getParentRoute: () => dataRoute, path: '/sources', component: SourcesListPage });
const newSourceRoute = createRoute({
  getParentRoute: () => dataRoute,
  path: '/sources/new',
  component: () => <SourcePage mode="create" />,
});
const sourceRoute = createRoute({
  getParentRoute: () => dataRoute,
  path: '/sources/$sourceId',
  validateSearch: z.object({ missing: z.string().optional() }),
  component: () => <SourcePage mode="edit" />,
});
const endpointRoute = createRoute({
  getParentRoute: () => dataRoute,
  path: '/sources/$sourceId/e/$endpointId',
  component: EndpointPage,
});
const importRoute = createRoute({ getParentRoute: () => dataRoute, path: '/import', component: ImportExportPage });

const routeTree = rootRoute.addChildren([
  setupRoute,
  loginRoute,
  publicRoute,
  publicItemRoute,
  appRoute.addChildren([
    homeRoute,
    collectionsRoute,
    newCollectionRoute,
    collectionRoute,
    editCollectionRoute,
    newItemRoute,
    itemRoute,
    editItemRoute,
    searchRoute,
    settingsRoute,
    serverRoute,
    dataRoute.addChildren([
      dataIndexRoute,
      templatesRoute,
      newTemplateRoute,
      templateRoute,
      sourcesRoute,
      newSourceRoute,
      sourceRoute,
      endpointRoute,
      importRoute,
    ]),
  ]),
]);

export function makeRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent', scrollRestoration: true });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
