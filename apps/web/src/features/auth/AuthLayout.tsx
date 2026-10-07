import type { ReactNode } from 'react';
import { Logo } from '../../components/Icon.tsx';

export function AuthLayout({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="grid w-full max-w-[420px] gap-6">
        <div className="flex items-center gap-2 text-[1.4rem] font-bold [font-stretch:75%]">
          <Logo size={28} />
          Precious
        </div>
        <div className="grid gap-5 rounded-sheet border border-line bg-surface p-6 sm:p-8">
          <div className="grid gap-2">
            <h1 className="text-[2rem] leading-none font-bold">{title}</h1>
            <p className="text-ink-muted">{intro}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
