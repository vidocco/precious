import { createUserInputSchema, type Role, type UserDto } from '@precious/shared';
import { type FormEvent, useState } from 'react';
import { errorMessage } from '../../api/client.ts';
import { useMe, useUserMutations, useUsers } from '../../api/queries.ts';
import {
  Avatar,
  Button,
  Caps,
  ConfirmStrip,
  ErrorBox,
  Select,
  Spinner,
  TextField,
  TextInput,
} from '../../components/ui.tsx';
import { Page } from '../shell/AppShell.tsx';

function UserRow({ user, isMe }: { user: UserDto; isMe: boolean }) {
  const { update, remove } = useUserMutations();
  const [resetting, setResetting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<unknown>, done: string) => {
    setError('');
    setMsg('');
    try {
      await fn();
      setMsg(done);
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <li className="grid gap-2 border-b border-line py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={user.name} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">
            {user.name}
            {isMe && <span className="font-normal text-ink-muted"> (you)</span>}
          </div>
          <div className="truncate text-[0.85rem] text-ink-muted">{user.email}</div>
        </div>
        <Select
          aria-label={`Role for ${user.name}`}
          value={user.role}
          disabled={isMe}
          onChange={(e) =>
            run(() => update.mutateAsync({ id: user.id, role: e.target.value as Role }), 'Role changed.')
          }
          className="w-auto py-1.5"
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </Select>
        <Button size="sm" onClick={() => setResetting((v) => !v)}>
          Reset password
        </Button>
        {!isMe && (
          <Button size="sm" variant="danger" icon="trash" onClick={() => setConfirming(true)}>
            Remove
          </Button>
        )}
      </div>
      {resetting && (
        <form
          className="flex flex-wrap items-center gap-2 pl-11"
          onSubmit={(e) => {
            e.preventDefault();
            const pw = String(new FormData(e.currentTarget).get('pw') ?? '');
            if (pw.length < 10) return setError('Use at least 10 characters.');
            void run(
              () => update.mutateAsync({ id: user.id, password: pw }),
              `New password set. ${user.name.split(' ')[0]} has been signed out everywhere.`,
            ).then(() => setResetting(false));
          }}
        >
          <TextInput
            name="pw"
            type="text"
            placeholder="New password (10+ characters)"
            aria-label="New password"
            className="max-w-72 py-1.5"
            autoComplete="off"
          />
          <Button type="submit" size="sm" variant="primary">
            Set password
          </Button>
        </form>
      )}
      {confirming && (
        <ConfirmStrip
          message={
            <>
              Remove <b>{user.name}</b>’s account?
            </>
          }
          confirmLabel="Remove account"
          busy={remove.isPending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void run(() => remove.mutateAsync(user.id), '').then(() => setConfirming(false))}
        />
      )}
      {error && <ErrorBox>{error}</ErrorBox>}
      {msg && <span className="pl-11 text-[0.85rem] text-ok">{msg}</span>}
    </li>
  );
}

export function ServerPage() {
  const { data: me } = useMe();
  const { data: users, isPending } = useUsers();
  const { create } = useUserMutations();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [added, setAdded] = useState('');

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const parsed = createUserInputSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setError('');
    try {
      const u = await create.mutateAsync(parsed.data);
      form.reset();
      setAdded(`${u.name} can now sign in with ${u.email}.`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (me && me.role !== 'admin') {
    return (
      <Page narrow>
        <ErrorBox>Only admins can manage the server.</ErrorBox>
      </Page>
    );
  }

  return (
    <Page narrow>
      <h1 className="text-[2.2rem] leading-none font-bold">Server</h1>
      <section className="grid gap-2 rounded-sheet border border-line bg-surface p-5 sm:p-6">
        <Caps>People in this household</Caps>
        {isPending ? (
          <Spinner />
        ) : (
          <ul className="m-0 list-none p-0">
            {(users ?? []).map((u) => (
              <UserRow key={u.id} user={u} isMe={u.id === me?.id} />
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-4 rounded-sheet border border-line bg-surface p-5 sm:p-6">
        <Caps>Add someone</Caps>
        <form onSubmit={onCreate} className="grid gap-3 sm:grid-cols-2" noValidate>
          <TextField label="Name" name="name" error={errors.name} autoComplete="off" />
          <TextField label="Email" name="email" type="email" error={errors.email} autoComplete="off" />
          <TextField
            label="Password"
            name="password"
            type="text"
            error={errors.password}
            help="Give it to them; they can change it in Settings."
            autoComplete="off"
          />
          <label className="grid content-start gap-1.5">
            <span className="text-[0.72rem] font-semibold tracking-[0.08em] text-ink-muted uppercase">Role</span>
            <Select name="role" defaultValue="member">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </Select>
          </label>
          {error && (
            <div className="sm:col-span-2">
              <ErrorBox>{error}</ErrorBox>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" variant="primary" disabled={create.isPending}>
              Add account
            </Button>
            {added && <span className="text-[0.85rem] text-ok">{added}</span>}
          </div>
        </form>
      </section>
    </Page>
  );
}
