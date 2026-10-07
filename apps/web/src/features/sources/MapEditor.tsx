import { type EndpointRole, ROLE_MAP_KEYS } from '@precious/shared';
import { useState } from 'react';
import { Button, cx, IconButton, TextInput } from '../../components/ui.tsx';

const HINTS: Record<string, string> = {
  results: 'Where the list of results is, e.g. docs or data.items',
  id: 'Unique id of each result (saved to find it again later)',
  title: 'The name to show',
  subtitle: 'A second line, e.g. author or platform',
  image: 'A cover image address',
  year: 'Year, if there is one',
  value: 'The value to keep up to date, e.g. price.loose / 100',
};

/** Output key → JSONata expression rows. The focused row receives paths clicked in the response. */
export function MapEditor({
  role,
  map,
  onChange,
  focused,
  onFocus,
}: {
  role: EndpointRole;
  map: Record<string, string>;
  onChange: (m: Record<string, string>) => void;
  focused: string | null;
  onFocus: (key: string) => void;
}) {
  const fixed = ROLE_MAP_KEYS[role];
  const keys = [...fixed, ...Object.keys(map).filter((k) => !fixed.includes(k))];
  const [newKey, setNewKey] = useState('');
  return (
    <div className="grid gap-2">
      <span className="text-[0.82rem] text-ink-muted">
        JSONata expressions.{' '}
        {role === 'search' ? 'Every key but results is read from each result.' : 'Each key becomes a value.'} Click a
        key in the response to fill the selected row.
      </span>
      {keys.map((k) => (
        <div key={k} className={cx('grid gap-1 rounded-[9px] p-1.5', focused === k && 'bg-accent/10')}>
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={`map-${k}`} className="text-[0.74rem] font-semibold text-ink-muted">
              {k}
              {HINTS[k] && <span className="font-normal text-ink-faint"> · {HINTS[k]}</span>}
            </label>
            {!fixed.includes(k) && (
              <IconButton
                icon="x"
                label={`Remove ${k}`}
                className="size-6"
                onClick={() => {
                  const { [k]: _gone, ...rest } = map;
                  onChange(rest);
                }}
              />
            )}
          </div>
          <TextInput
            id={`map-${k}`}
            value={map[k] ?? ''}
            placeholder={k === 'results' ? '$ (the whole response)' : ''}
            onFocus={() => onFocus(k)}
            onChange={(e) => onChange({ ...map, [k]: e.target.value })}
            className="py-1.5 text-[0.86rem] italic"
            spellCheck={false}
          />
        </div>
      ))}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const k = newKey.trim();
          if (k && !(k in map) && !fixed.includes(k)) {
            onChange({ ...map, [k]: '' });
            onFocus(k);
          }
          setNewKey('');
        }}
      >
        <TextInput
          aria-label="New output key"
          placeholder={role === 'lookup' ? 'Output name, e.g. synopsis' : 'Extra output, e.g. pages'}
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          className="py-1.5"
        />
        <Button type="submit" size="sm" disabled={!newKey.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}
