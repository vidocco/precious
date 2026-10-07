import type { FieldDefinition, ItemDto, ItemLayout, UserDto } from '@precious/shared';
import { formatValue } from '@precious/shared';
import { Cover } from '../../components/Cover.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Caps, cx } from '../../components/ui.tsx';
import { LOCALE, refLabel, refValue } from '../../lib/format.ts';

function sourceLabel(item: ItemDto, ref: string, users?: UserDto[], onUnlock?: (ref: string) => void) {
  const meta = item.fieldMeta[ref];
  if (!meta) return null;
  const who =
    meta.source === 'user' ? (users?.find((u) => u.id === meta.by)?.name.split(' ')[0] ?? 'You') : meta.source;
  if (meta.error) {
    const when = meta.errorAt
      ? new Date(meta.errorAt).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' })
      : '';
    return (
      <span
        className="inline-flex items-center gap-1 text-[0.64rem] whitespace-nowrap text-warn"
        title={`Couldn’t update ${when}: ${meta.error}. Showing the last value${meta.at ? ` from ${new Date(meta.at).toLocaleDateString(LOCALE)}` : ''}.`}
      >
        <Icon name="refresh" size={11} />
        {who} · out of date
      </span>
    );
  }
  if (meta.locked && onUnlock) {
    return (
      <button
        type="button"
        onClick={() => onUnlock(ref)}
        className="inline-flex items-center gap-1 rounded-[5px] px-1 text-[0.64rem] whitespace-nowrap text-ink-faint hover:bg-surface-sunk hover:text-ink"
        title="Edited by hand, so refreshing keeps it. Click to unlock it, so refreshing can update it again."
        aria-label={`Unlock ${ref === '$title' ? 'the title' : 'this value'} (edited by ${who})`}
      >
        <Icon name="lock" size={11} />
        {who}
      </button>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[0.64rem] whitespace-nowrap text-ink-faint"
      title={meta.locked ? 'Edited by hand: refreshing from a data source will keep this value' : undefined}
    >
      {meta.locked && <Icon name="lock" size={11} />}
      {who}
    </span>
  );
}

/** The template-driven body of an item page: cover + info box, then sections. */
export function ItemView({
  item,
  fields,
  layout,
  collectionName,
  users,
  onUnlock,
}: {
  item: ItemDto;
  fields: FieldDefinition[];
  layout: ItemLayout;
  collectionName: string;
  users?: UserDto[];
  /** When set, locked values can be unlocked from their source label. */
  onUnlock?: (ref: string) => void;
}) {
  const ctxValue = (ref: string) => {
    const field = fields.find((f) => f.id === ref);
    if (field?.type === 'person') {
      const id = item.data[ref];
      return typeof id === 'string' ? (users?.find((u) => u.id === id)?.name ?? '') : '';
    }
    return refValue(ref, item, fields, collectionName);
  };
  const info = layout.info.filter((ref) => !fields.find((f) => f.id === ref)?.hidden && ctxValue(ref));
  const sections = layout.sections
    .map((s) => ({ ...s, refs: s.fields.filter((r) => !fields.find((f) => f.id === r)?.hidden && ctxValue(r)) }))
    .filter((s) => s.refs.length > 0);
  const money = fields.find((f) => f.type === 'money' && layout.info.includes(f.id) && item.data[f.id] !== undefined);

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 md:grid-cols-[250px_1fr] md:gap-8">
        <Cover
          cover={item.cover}
          title={item.title}
          size="lg"
          eager
          className="max-w-[250px] shadow-[0_2px_2px_rgb(0_0_0/0.4),0_22px_44px_-16px_rgb(0_0_0/0.85)]"
        />
        <div className="grid min-w-0 content-start gap-3.5">
          <div className="grid gap-2">
            <h1 className="text-[clamp(2rem,5vw,3rem)] leading-none font-bold">{item.title}</h1>
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.95rem] text-ink-muted">
              <span className="tabular">{item.accession}</span>
              <span className="text-ink-faint">·</span>
              <span>
                Added{' '}
                {new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' }).format(
                  new Date(item.createdAt),
                )}
                {item.createdByName && ` by ${item.createdByName.split(' ')[0]}`}
              </span>
              {money && (
                <span className="rounded-full bg-gilt-soft px-2.5 py-0.5 text-[0.85rem] font-semibold text-gilt tabular">
                  {formatValue(money, item.data[money.id], { locale: LOCALE })}
                </span>
              )}
            </div>
          </div>
          {info.length > 0 && (
            <dl className="m-0 grid overflow-hidden rounded-[12px] border border-line bg-surface sm:grid-cols-2">
              {info.map((ref) => {
                const field = fields.find((f) => f.id === ref);
                return (
                  <div
                    key={ref}
                    className="grid min-w-0 grid-cols-[110px_1fr_auto] items-baseline gap-2.5 border-b border-line px-3 py-2 text-[0.9rem]"
                  >
                    <dt className="text-[0.7rem] font-semibold tracking-[0.08em] text-ink-muted uppercase">
                      {refLabel(ref, fields)}
                    </dt>
                    <dd
                      className={cx(
                        'm-0 min-w-0 font-medium break-words',
                        field?.type === 'money' && 'font-bold text-gilt tabular',
                      )}
                    >
                      {field?.type === 'url' ? (
                        <a
                          href={String(item.data[ref])}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-accent"
                        >
                          {ctxValue(ref)}
                        </a>
                      ) : (
                        ctxValue(ref)
                      )}
                    </dd>
                    {sourceLabel(item, ref, users, onUnlock)}
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      </div>
      {sections.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          {sections.map((s) => (
            <section
              key={s.id}
              className={cx(
                'grid min-w-0 content-start gap-2 rounded-[12px] border border-line bg-surface px-4 py-3.5',
                s.wide && 'lg:col-span-2',
              )}
            >
              <Caps>{s.title}</Caps>
              {s.type === 'text' ? (
                s.refs.map((r) => (
                  <p key={r} className="max-w-[72ch] text-[0.94rem] whitespace-pre-line text-ink-muted">
                    {ctxValue(r)}
                  </p>
                ))
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
                  {s.refs.map((r) => (
                    <div key={r} className="grid gap-px">
                      <b className="text-[1.25rem] leading-tight tabular [font-stretch:80%]">{ctxValue(r)}</b>
                      <span className="text-[0.74rem] text-ink-muted">{refLabel(r, fields)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
