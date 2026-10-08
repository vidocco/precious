import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import {
  Button as AriaButton,
  Dialog,
  Menu,
  MenuItem,
  MenuTrigger,
  Modal,
  ModalOverlay,
  Popover,
  Separator,
} from 'react-aria-components';
import { authClient } from '../../api/auth.ts';
import { useCollections, useMe } from '../../api/queries.ts';
import { Icon, type IconName, Logo } from '../../components/Icon.tsx';
import { Avatar, cx, IconButton } from '../../components/ui.tsx';
import { GlobalSearch } from './GlobalSearch.tsx';

const navLink =
  'flex items-center gap-1.5 whitespace-nowrap rounded-[9px] px-2.5 py-[7px] text-[0.9rem] font-medium text-ink-muted no-underline hover:text-ink data-[status=active]:bg-surface-sunk data-[status=active]:text-ink';

const menuItem =
  'flex cursor-pointer items-center gap-2.5 rounded-[8px] px-3 py-2 text-[0.9rem] text-ink outline-none data-[focused]:bg-surface-sunk';

function CollectionsMenu() {
  const { data: collections } = useCollections();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const active = path.startsWith('/c/') || path.startsWith('/i/') || path.startsWith('/collections');
  return (
    <MenuTrigger>
      <AriaButton className={cx(navLink, 'outline-none', active && 'bg-surface-sunk text-ink')}>
        <Icon name="grid" size={16} />
        Collections
        <Icon name="chevron" size={14} />
      </AriaButton>
      <Popover
        placement="bottom start"
        className="min-w-60 rounded-[12px] border border-line bg-surface p-1.5 shadow-float"
      >
        <Menu
          aria-label="Collections"
          className="outline-none"
          onAction={(key) =>
            key === 'new'
              ? navigate({ to: '/collections/new' })
              : navigate({ to: '/c/$collectionId', params: { collectionId: String(key) } })
          }
        >
          {(collections ?? []).map((c) => (
            <MenuItem key={c.id} id={c.id} className={menuItem} textValue={c.name}>
              <span data-accent={c.accent} className="size-2.5 rounded-[3px] bg-accent" />
              <span className="flex-1">{c.name}</span>
              <span className="text-[0.75rem] text-ink-faint tabular">{c.itemCount}</span>
            </MenuItem>
          ))}
          {(collections ?? []).length > 0 && <Separator className="my-1 border-t border-line" />}
          <MenuItem id="new" className={cx(menuItem, 'font-semibold text-accent')}>
            <Icon name="plus" size={16} />
            New collection
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    await authClient.signOut();
    qc.clear();
    navigate({ to: '/login' });
  };
}

function ProfileMenu() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const signOut = useSignOut();
  if (!me) return null;
  return (
    <MenuTrigger>
      <AriaButton
        aria-label="Your account"
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Avatar name={me.name} />
      </AriaButton>
      <Popover
        placement="bottom end"
        className="min-w-52 rounded-[12px] border border-line bg-surface p-1.5 shadow-float"
      >
        <div className="px-3 pt-1.5 pb-2 text-[0.85rem]">
          <div className="font-semibold">{me.name}</div>
          <div className="text-ink-muted">{me.email}</div>
        </div>
        <Menu
          aria-label="Account"
          className="outline-none"
          onAction={(key) => (key === 'signout' ? void signOut() : navigate({ to: '/settings' }))}
        >
          <MenuItem id="settings" className={menuItem}>
            <Icon name="user" size={16} />
            Profile and settings
          </MenuItem>
          <MenuItem id="signout" className={menuItem}>
            <Icon name="logout" size={16} />
            Sign out
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function MobileMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: me } = useMe();
  const signOut = useSignOut();
  const links: { to: string; label: string; icon: IconName; admin?: boolean }[] = [
    { to: '/', label: 'Home', icon: 'home' },
    { to: '/collections', label: 'Collections', icon: 'grid' },
    { to: '/data', label: 'Data management', icon: 'db' },
    { to: '/settings', label: 'Settings', icon: 'gear' },
    { to: '/server', label: 'Server', icon: 'shield', admin: true },
  ];
  return (
    <ModalOverlay isOpen={open} onOpenChange={onOpenChange} isDismissable className="fixed inset-0 z-50 bg-scrim">
      <Modal className="absolute inset-x-0 top-0 rounded-b-sheet border-b border-line bg-surface pt-[var(--safe-top)] shadow-float">
        <Dialog aria-label="Menu" className="grid gap-0.5 p-3 outline-none">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="flex items-center gap-2 text-[1.2rem] font-bold [font-stretch:75%]">
              <Logo />
              Precious
            </span>
            <IconButton icon="x" label="Close menu" onClick={() => onOpenChange(false)} />
          </div>
          {links
            .filter((l) => !l.admin || me?.role === 'admin')
            .map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => onOpenChange(false)}
                activeOptions={{ exact: l.to === '/' }}
                className="flex items-center gap-3 rounded-[10px] px-2.5 py-3 text-[1rem] font-medium text-ink no-underline data-[status=active]:bg-surface-sunk data-[status=active]:font-semibold"
              >
                <Icon name={l.icon} />
                {l.label}
              </Link>
            ))}
          <hr className="my-1.5 border-line" />
          {me && (
            <div className="flex items-center justify-between gap-2 px-2.5 py-2 text-[0.9rem] text-ink-muted">
              <span className="flex items-center gap-2.5">
                <Avatar name={me.name} />
                {me.name}
                {me.role === 'admin' && ' · admin'}
              </span>
              <button type="button" onClick={() => void signOut()} className="font-semibold text-accent">
                Sign out
              </button>
            </div>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function MobileSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <ModalOverlay isOpen={open} onOpenChange={onOpenChange} isDismissable className="fixed inset-0 z-50 bg-scrim">
      <Modal className="absolute inset-x-0 top-0 bg-surface p-3 pt-[calc(var(--safe-top)+12px)] shadow-float">
        <Dialog aria-label="Search" className="flex items-center gap-2 outline-none">
          <GlobalSearch autoFocus onDone={() => onOpenChange(false)} />
          <IconButton icon="x" label="Close search" onClick={() => onOpenChange(false)} />
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function TopBar() {
  const { data: me } = useMe();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const path = useRouterState({ select: (s) => s.location.pathname });
  // biome-ignore lint/correctness/useExhaustiveDependencies: close overlays whenever the page changes
  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [path]);

  return (
    // The header reaches under the status bar (translucent when installed on iOS) and pads itself
    // below it, so it always takes up its whole height and never covers the page.
    <header className="sticky top-0 z-30 border-b border-line bg-surface pt-[var(--safe-top)] pr-[var(--safe-right)] pl-[var(--safe-left)]">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3.5 px-4 py-2.5">
        <Link
          to="/"
          className="flex items-center gap-2 text-[1.2rem] font-bold text-ink no-underline [font-stretch:75%]"
        >
          <Logo />
          Precious
        </Link>
        <nav aria-label="Main" className="hidden gap-0.5 md:flex">
          <Link to="/" className={navLink} activeOptions={{ exact: true }}>
            <Icon name="home" size={16} />
            Home
          </Link>
          <CollectionsMenu />
          <Link to="/data" className={navLink}>
            <Icon name="db" size={16} />
            Data management
          </Link>
        </nav>
        <div className="hidden max-w-[420px] flex-1 md:flex">
          <GlobalSearch />
        </div>
        <div className="ml-auto hidden items-center gap-1 md:flex">
          <Link
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className="grid size-9 place-items-center rounded-[9px] text-ink-muted hover:bg-surface-sunk hover:text-ink"
          >
            <Icon name="gear" />
          </Link>
          {me?.role === 'admin' && (
            <Link
              to="/server"
              aria-label="Server"
              title="Server (admins only)"
              className="relative grid size-9 place-items-center rounded-[9px] text-ink-muted after:absolute after:top-1.5 after:right-1.5 after:size-1.5 after:rounded-full after:bg-gilt hover:bg-surface-sunk hover:text-ink"
            >
              <Icon name="shield" />
            </Link>
          )}
          <ProfileMenu />
        </div>
        <div className="ml-auto flex gap-0.5 md:hidden">
          <IconButton icon="search" label="Search" onClick={() => setSearchOpen(true)} />
          <IconButton icon="menu" label="Menu" onClick={() => setMenuOpen(true)} />
        </div>
      </div>
      <MobileMenu open={menuOpen} onOpenChange={setMenuOpen} />
      <MobileSearch open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}

export function AppShell() {
  return (
    <div className="min-h-dvh">
      <TopBar />
      <main className="mx-auto max-w-[1400px] pr-[var(--safe-right)] pl-[var(--safe-left)]">
        <Outlet />
      </main>
    </div>
  );
}

/** A consistent page frame: gutter, vertical rhythm and an optional width cap. */
export function Page({
  children,
  narrow,
  className,
}: {
  children: React.ReactNode;
  narrow?: boolean;
  className?: string;
}) {
  return (
    <div className={cx('grid gap-6 px-4 pt-6 pb-24 sm:px-8 sm:pt-8', narrow && 'max-w-3xl', className)}>{children}</div>
  );
}
