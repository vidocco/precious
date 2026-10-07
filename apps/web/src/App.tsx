import { type HealthResponse, healthResponseSchema } from '@precious/shared';
import { useEffect, useState } from 'react';

const ACCENTS = ['ultramarine', 'oxblood', 'moss', 'saffron'] as const;

const SWATCHES = [
  ['wall', 'bg-wall'],
  ['surface', 'bg-surface'],
  ['surface-sunk', 'bg-surface-sunk'],
  ['line', 'bg-line'],
  ['ink', 'bg-ink'],
  ['ink-muted', 'bg-ink-muted'],
  ['gilt', 'bg-gilt'],
  ['gilt-soft', 'bg-gilt-soft'],
] as const;

function useHealth() {
  const [health, setHealth] = useState<HealthResponse | 'unreachable' | null>(null);
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((json) => setHealth(healthResponseSchema.parse(json)))
      .catch(() => setHealth('unreachable'));
  }, []);
  return health;
}

function HealthBadge() {
  const health = useHealth();
  const label =
    health === null
      ? 'Checking server…'
      : health === 'unreachable'
        ? 'Server unreachable'
        : `Server ${health.version} · database ${health.database}`;
  const tone =
    health === null
      ? 'text-ink-muted'
      : health === 'unreachable' || health.database === 'down'
        ? 'text-danger'
        : 'text-ok';
  return <p className={`font-data text-[length:var(--step--1)] ${tone}`}>{label}</p>;
}

export function App() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-12 px-4 py-10 sm:px-8">
      <header className="flex flex-col gap-3">
        <p className="font-data text-[length:var(--step--1)] tracking-widest text-ink-muted uppercase">
          Foundations · milestone 0
        </p>
        <h1 className="text-[length:var(--step-5)] leading-none font-bold tracking-tight">Precious</h1>
        <p className="max-w-[60ch] text-[length:var(--step-1)] text-ink-muted">
          One cabinet for everything the household collects. This page is a living style guide for the design tokens;
          the real app starts in milestone 1.
        </p>
        <HealthBadge />
      </header>

      <section className="flex flex-col gap-4">
        <h2 className="text-[length:var(--step-3)] font-semibold">Type</h2>
        <div className="flex flex-col gap-2 rounded-sheet bg-surface p-6">
          <p className="font-display text-[length:var(--step-4)] font-bold [font-stretch:75%]">
            Instrument Sans, condensed bold for titles
          </p>
          <p className="max-w-[65ch]">
            The same family carries the interface and running text at its normal width. It stays quiet so covers, titles
            and the collection's own accent can do the talking.
          </p>
          <p className="text-[length:var(--step--1)] font-semibold tracking-widest text-ink-muted uppercase">
            Section label · caps and letter-spacing
          </p>
          <p className="font-data text-ink-muted">VG·0142 · acquired 2024-11-03 · 812 g · €64.50</p>
          <p className="text-ink-muted italic">Italics for mappings, notes and asides.</p>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[length:var(--step-3)] font-semibold">Palette</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SWATCHES.map(([name, cls]) => (
            <li key={name} className="flex flex-col gap-2">
              <span className={`h-16 rounded-control border border-line ${cls}`} />
              <span className="font-data text-[length:var(--step--1)] text-ink-muted">--{name}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-[length:var(--step-3)] font-semibold">Collection accents</h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ACCENTS.map((accent) => (
            <li key={accent} data-accent={accent} className="flex flex-col gap-3 rounded-sheet bg-surface p-4">
              <span className="aspect-[3/4] max-w-full rounded-cover bg-accent shadow-object" />
              <button type="button" className="rounded-control bg-accent px-3 py-2 font-medium text-accent-ink">
                Add item
              </button>
              <span className="font-data text-[length:var(--step--1)] text-ink-muted">{accent}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
