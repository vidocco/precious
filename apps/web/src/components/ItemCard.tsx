import type { CardLayout, FieldDefinition, ItemDto, ItemMatch } from '@precious/shared';
import { Link } from '@tanstack/react-router';
import { refValue } from '../lib/format.ts';
import { Cover, Slot } from './Cover.tsx';
import { Snippet } from './Snippet.tsx';
import { cx } from './ui.tsx';

const LINE_CLASS = {
  title: 'text-[0.95rem] font-semibold leading-tight text-ink',
  normal: 'truncate text-[0.82rem] text-ink',
  muted: 'truncate text-[0.8rem] text-ink-muted',
  value: 'truncate text-[0.82rem] font-semibold text-gilt tabular',
} as const;

/** A card laid out by the template: labels on the cover, caption lines under it. */
export function ItemCard({
  item,
  card,
  fields,
  match,
  to,
  collectionName,
  morph,
}: {
  item: ItemDto;
  card: CardLayout;
  fields: FieldDefinition[];
  match?: ItemMatch;
  to?: { to: string; params?: Record<string, string> } | null;
  collectionName?: string;
  /** The cover morphs into the item page's cover when opened. */
  morph?: boolean;
}) {
  const slot = (pos: 'tl' | 'tr' | 'b') => {
    const ref = card.slots[pos];
    const v = ref ? refValue(ref, item, fields, collectionName) : '';
    return v ? <Slot position={pos}>{v}</Slot> : null;
  };
  const body = (
    <>
      <Cover
        cover={item.cover}
        title={item.title}
        className="transition-transform duration-200 group-hover:-translate-y-1"
        transitionName={morph ? `cover-${item.id}` : undefined}
      >
        {slot('tl')}
        {slot('tr')}
        {slot('b')}
      </Cover>
      <span className="grid min-w-0 gap-px">
        {card.lines.map((line, i) => {
          const text = line.fields
            .map((r) => refValue(r, item, fields, collectionName))
            .filter(Boolean)
            .join(' · ');
          if (!text) return null;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional in the template
            <span key={i} className={LINE_CLASS[line.style]}>
              {line.prefix}
              {text}
            </span>
          );
        })}
        {match && (
          <span className="truncate text-[0.74rem] text-ink-muted italic">
            {match.label}: <Snippet text={match.snippet} />
          </span>
        )}
      </span>
    </>
  );
  const cls = 'group grid min-w-0 content-start gap-2 rounded-cover text-left no-underline';
  if (to === null) return <div className={cls}>{body}</div>;
  return (
    <Link to={to?.to ?? '/i/$itemId'} params={to?.params ?? { itemId: item.id }} className={cx(cls)}>
      {body}
    </Link>
  );
}

export function Wall({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 @[520px]:grid-cols-3 @[760px]:grid-cols-4 @[1040px]:grid-cols-6">
        {children}
      </div>
    </div>
  );
}
