import { Link, Outlet } from '@tanstack/react-router';
import { useSources, useTemplates } from '../../api/queries.ts';
import { Icon, type IconName } from '../../components/Icon.tsx';
import { EmptyState } from '../../components/ui.tsx';

const linkCls =
  'flex flex-none items-center gap-2 rounded-[9px] px-2.5 py-2 text-[0.9rem] font-medium text-ink-muted no-underline data-[status=active]:bg-surface data-[status=active]:font-semibold data-[status=active]:text-ink data-[status=active]:shadow-[inset_0_0_0_1px_var(--line)]';

export function DataLayout() {
  const { data: templates } = useTemplates();
  const { data: sources } = useSources();
  const links: { to: string; label: string; icon: IconName; n?: number }[] = [
    { to: '/data/templates', label: 'Templates', icon: 'layers', n: templates?.length },
    { to: '/data/sources', label: 'Data sources', icon: 'plug', n: sources?.length },
    { to: '/data/import', label: 'Import & export', icon: 'swap' },
  ];
  return (
    <div className="grid lg:grid-cols-[1fr_220px]">
      <div className="min-w-0 px-4 pt-6 pb-24 sm:px-8 sm:pt-8">
        <Outlet />
      </div>
      <nav
        aria-label="Data management"
        className="-order-1 flex gap-1 overflow-x-auto border-b border-line bg-wall px-3.5 py-2.5 lg:order-none lg:min-h-[calc(100dvh-57px)] lg:flex-col lg:border-b-0 lg:border-l lg:px-3.5 lg:py-6"
      >
        <span className="hidden px-2.5 pb-2 text-[0.7rem] font-semibold tracking-[0.11em] text-ink-muted uppercase lg:block">
          Data management
        </span>
        {links.map((l) => (
          <Link key={l.to} to={l.to} className={linkCls}>
            <Icon name={l.icon} size={16} />
            {l.label}
            {l.n !== undefined && <span className="ml-auto pl-2 text-[0.74rem] text-ink-faint">{l.n}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function ImportExportPage() {
  return (
    <div className="grid gap-5">
      <h1 className="text-[2rem] leading-none font-bold">Import & export</h1>
      <EmptyState title="Coming in a later version">
        Import collections from CSV files and export yours as CSV or JSON.
      </EmptyState>
    </div>
  );
}
