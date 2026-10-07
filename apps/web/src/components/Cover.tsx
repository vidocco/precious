import type { CoverDto, CoverShape } from '@precious/shared';
import type { ReactNode } from 'react';
import { mediaUrl } from '../api/client.ts';
import { cx } from './ui.tsx';

/** A placeholder "cover" for items without an image: a colour field with the title set in type. */
export function placeholderColor(title: string) {
  let h = 0;
  for (const ch of title) h = (h * 33 + ch.charCodeAt(0)) % 360;
  return `oklch(0.42 0.07 ${h})`;
}

export function Cover({
  cover,
  title,
  size = 'sm',
  shape,
  className,
  children,
  eager,
  transitionName,
}: {
  cover: CoverDto | null;
  title: string;
  size?: 'sm' | 'lg';
  /** The template's cover shape; 3:4 when not given. */
  shape?: CoverShape;
  className?: string;
  children?: ReactNode;
  eager?: boolean;
  /** Pairs this cover with the same one on another page, so navigating morphs between them. */
  transitionName?: string;
}) {
  return (
    <div
      className={cx(
        '@container relative w-full max-w-full overflow-hidden rounded-cover shadow-object',
        !shape && 'aspect-[3/4]',
        className,
      )}
      style={{
        background: cover?.color ?? placeholderColor(title),
        viewTransitionName: transitionName,
        ...(shape && { aspectRatio: `${shape.width} / ${shape.height}` }),
      }}
    >
      {cover ? (
        <img
          src={mediaUrl(cover.id, size)}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className={cx('absolute inset-0 size-full', shape?.fit === 'whole' ? 'object-contain' : 'object-cover')}
        />
      ) : (
        <span
          aria-hidden="true"
          className="absolute inset-x-3 top-1/2 hidden -translate-y-1/2 @[90px]:line-clamp-4 text-[clamp(0.9rem,2.4cqi,1.3rem)] leading-[0.95] font-bold text-white/85 [font-stretch:75%]"
        >
          {title}
        </span>
      )}
      {children}
    </div>
  );
}

export function Slot({ position, children }: { position: 'tl' | 'tr' | 'b'; children: ReactNode }) {
  if (position === 'b') {
    return (
      <span className="absolute inset-x-0 bottom-0 truncate bg-[rgb(14_16_20/0.72)] px-2 py-1.5 text-[0.72rem] font-semibold text-[#f2f3f6]">
        {children}
      </span>
    );
  }
  return (
    <span
      className={cx(
        'absolute top-[7px] max-w-[calc(100%-16px)] truncate rounded-[4px] bg-white/90 px-1.5 py-0.5 text-[0.62rem] font-semibold tracking-[0.06em] text-[#16181d] uppercase',
        position === 'tl' ? 'left-[7px]' : 'right-[7px]',
      )}
    >
      {children}
    </span>
  );
}
