import { finder } from '@medv/finder';
import { useEffect, useRef, useState } from 'react';

const HIGHLIGHT = 'precious-picked';
const HOVER = 'precious-hover';
const PICKER_CSS = `.${HOVER}{outline:2px dashed #3445d8!important;outline-offset:1px;cursor:crosshair!important}.${HIGHLIGHT}{outline:2px solid #3445d8!important;outline-offset:1px;background:rgba(52,69,216,.12)!important}`;

/**
 * Shows a fetched page (already stripped of scripts by the server) in a sandboxed
 * frame. Scripts can't run in it; this component reaches in from outside to let you
 * point at an element and get a CSS selector for it.
 */
export function HtmlPicker({
  html,
  highlight,
  onPick,
}: {
  html: string;
  highlight?: string;
  onPick: (selector: string, sample: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;

  // Attach once the page's DOM is ready. The frame's load event can be late or never
  // come (it waits for every remote image), so check readiness on a short interval.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new page means a new document to attach to
  useEffect(() => {
    const iframe = frame.current;
    if (!iframe) return;
    setDoc(null);
    const attach = () => {
      const d = iframe.contentDocument;
      if (!d || d.readyState === 'loading' || !d.body?.childElementCount) return false;
      const marked = d as Document & { __picker?: boolean };
      if (marked.__picker) return true;
      marked.__picker = true;
      const style = d.createElement('style');
      style.textContent = PICKER_CSS;
      d.head?.appendChild(style);
      d.addEventListener('mouseover', (e) => (e.target as Element).classList?.add(HOVER));
      d.addEventListener('mouseout', (e) => (e.target as Element).classList?.remove(HOVER));
      d.addEventListener(
        'click',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          const el = e.target as Element;
          el.classList.remove(HOVER);
          const selector = finder(el, {
            root: d.body,
            // Generated class names and ids change between page loads; skip them.
            className: (n) => !n.startsWith('precious-') && !/\d{3,}|^[a-z]{1,3}-[A-Za-z0-9]{5,}$/.test(n),
            idName: (n) => !/\d{3,}/.test(n),
          });
          pickRef.current(selector, (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120));
        },
        true,
      );
      setDoc(d);
      return true;
    };
    if (attach()) return;
    const timer = setInterval(() => {
      if (attach()) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [html]);

  useEffect(() => {
    if (!doc) return;
    for (const el of Array.from(doc.querySelectorAll(`.${HIGHLIGHT}`))) el.classList.remove(HIGHLIGHT);
    if (!highlight) {
      setCount(null);
      return;
    }
    try {
      const found = Array.from(doc.querySelectorAll(highlight));
      for (const el of found) el.classList.add(HIGHLIGHT);
      found[0]?.scrollIntoView({ block: 'center' });
      setCount(found.length);
    } catch {
      setCount(null);
    }
  }, [doc, highlight]);

  return (
    <div className="grid gap-2">
      <iframe
        ref={frame}
        title="Page preview"
        srcDoc={html}
        // No allow-scripts: the page can't run code. Same-origin lets the picker read it.
        sandbox="allow-same-origin"
        className="h-[460px] w-full rounded-[10px] border border-line bg-white"
      />
      {highlight && (
        <span className="justify-self-start rounded-[6px] bg-ink px-2 py-1 text-[0.74rem] text-surface">
          {highlight} · {count ?? 0} {count === 1 ? 'match' : 'matches'}
        </span>
      )}
    </div>
  );
}
