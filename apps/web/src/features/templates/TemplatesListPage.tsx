import { Link } from '@tanstack/react-router';
import { useTemplates } from '../../api/queries.ts';
import { Button, Spinner } from '../../components/ui.tsx';

export function TemplatesListPage() {
  const { data: templates, isPending } = useTemplates();
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-[2rem] leading-none font-bold">Templates</h1>
          <p className="max-w-[62ch] text-ink-muted">
            A template describes one kind of collection: its fields, what shows on each card and item page, and the
            figures in the header. Collections using a template change when it does.
          </p>
        </div>
        <Link to="/data/templates/new">
          <Button variant="primary" icon="plus" tabIndex={-1}>
            New template
          </Button>
        </Link>
      </div>
      {isPending ? (
        <Spinner />
      ) : (
        <div className="overflow-x-auto rounded-[12px] border border-line bg-surface">
          <table className="w-full border-collapse text-[0.9rem]">
            <thead>
              <tr className="text-left text-[0.68rem] font-semibold tracking-[0.08em] text-ink-muted uppercase">
                <th className="border-b border-line px-3.5 py-2">Template</th>
                <th className="border-b border-line px-3.5 py-2">Fields</th>
                <th className="border-b border-line px-3.5 py-2">Used by</th>
              </tr>
            </thead>
            <tbody>
              {(templates ?? []).map((t) => (
                <tr key={t.id} className="hover:bg-surface-sunk">
                  <td className="border-b border-line px-3.5 py-2.5">
                    <Link
                      to="/data/templates/$templateId"
                      params={{ templateId: t.id }}
                      className="font-semibold text-ink no-underline"
                    >
                      {t.name}
                    </Link>
                    <div className="text-[0.8rem] text-ink-muted">{t.description}</div>
                  </td>
                  <td className="border-b border-line px-3.5 py-2.5 tabular">
                    {t.fields.filter((f) => !f.hidden).length}
                  </td>
                  <td className="border-b border-line px-3.5 py-2.5 text-ink-muted">
                    {t.usage.length ? t.usage.map((u) => u.name).join(', ') : 'No collections yet'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
