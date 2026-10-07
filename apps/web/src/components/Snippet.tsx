import { splitSnippet } from '../lib/format.ts';

export function Snippet({ text }: { text: string }) {
  return (
    <>
      {splitSnippet(text).map((p, i) =>
        // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and static
        p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>,
      )}
    </>
  );
}
