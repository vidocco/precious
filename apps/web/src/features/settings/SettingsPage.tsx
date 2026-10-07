import { useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { authClient } from '../../api/auth.ts';
import { api, errorMessage } from '../../api/client.ts';
import { keys, useMe } from '../../api/queries.ts';
import { Button, Caps, ErrorBox, Field, Segmented, TextField } from '../../components/ui.tsx';
import { useInstall } from '../../lib/install.ts';
import { applyTheme, readTheme, type ThemePref } from '../../lib/theme.ts';
import { Page } from '../shell/AppShell.tsx';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-4 rounded-sheet border border-line bg-surface p-5 sm:p-6">
      <Caps>{title}</Caps>
      {children}
    </section>
  );
}

const INSTALL_TEXT = {
  installed: 'Precious is installed on this device.',
  ready: 'Install Precious to open it like an app, from your home screen or dock.',
  ios: 'On iPhone and iPad: tap Share, then Add to Home Screen.',
  insecure:
    'Installing needs a secure connection (https://). On Unraid, put Precious behind a reverse proxy with a certificate, such as Nginx Proxy Manager or Tailscale.',
  menu: 'Use your browser’s menu: Install Precious, or Add to Home screen.',
} as const;

function InstallSection() {
  const { state, install } = useInstall();
  return (
    <Section title="App on this device">
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-60 flex-1 text-[0.92rem] text-ink-muted">{INSTALL_TEXT[state]}</p>
        {state === 'ready' && (
          <Button variant="primary" onClick={() => void install()}>
            Install Precious
          </Button>
        )}
      </div>
    </Section>
  );
}

export function SettingsPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [theme, setTheme] = useState<ThemePref>(readTheme());
  const [nameMsg, setNameMsg] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwError, setPwError] = useState('');

  async function saveName(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get('name') ?? '').trim();
    if (!name) return;
    try {
      await api.patch('/api/me', { name });
      await qc.invalidateQueries({ queryKey: keys.me });
      setNameMsg('Saved.');
    } catch (err) {
      setNameMsg(errorMessage(err));
    }
  }

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const current = String(data.get('current') ?? '');
    const next = String(data.get('next') ?? '');
    setPwMsg('');
    setPwError('');
    if (next.length < 10) return setPwError('Use at least 10 characters.');
    const res = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    if (res.error) return setPwError(res.error.message ?? 'Could not change the password.');
    form.reset();
    setPwMsg('Password changed. Other devices have been signed out.');
  }

  if (!me) return null;
  return (
    <Page narrow>
      <h1 className="text-[2.2rem] leading-none font-bold">Settings</h1>
      <Section title="Profile">
        <form onSubmit={saveName} className="flex flex-wrap items-end gap-3">
          <div className="min-w-60 flex-1">
            <TextField label="Name" name="name" defaultValue={me.name} />
          </div>
          <Button type="submit">Save name</Button>
          {nameMsg && <span className="text-[0.85rem] text-ink-muted">{nameMsg}</span>}
        </form>
        <p className="text-[0.88rem] text-ink-muted">
          Signed in as {me.email}
          {me.role === 'admin' && ' · admin'}
        </p>
      </Section>
      <Section title="Password">
        <form onSubmit={changePassword} className="grid gap-3 sm:grid-cols-2">
          <TextField label="Current password" name="current" type="password" autoComplete="current-password" />
          <TextField
            label="New password"
            name="next"
            type="password"
            autoComplete="new-password"
            help="At least 10 characters."
          />
          {pwError && (
            <div className="sm:col-span-2">
              <ErrorBox>{pwError}</ErrorBox>
            </div>
          )}
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit">Change password</Button>
            {pwMsg && <span className="text-[0.85rem] text-ok">{pwMsg}</span>}
          </div>
        </form>
      </Section>
      <Section title="Appearance">
        <Field
          label="Theme"
          help="System follows your device’s light or dark setting. Item pages stay dark either way."
        >
          <Segmented
            label="Theme"
            value={theme}
            onChange={(v) => {
              setTheme(v);
              applyTheme(v);
            }}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </Field>
      </Section>
      <InstallSection />
    </Page>
  );
}
