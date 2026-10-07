import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { authClient } from '../../api/auth.ts';
import { keys } from '../../api/queries.ts';
import { Button, ErrorBox, TextField } from '../../components/ui.tsx';
import { AuthLayout } from './AuthLayout.tsx';

export function LoginPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { redirect } = useSearch({ from: '/login' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    const res = await authClient.signIn.email({
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    });
    setBusy(false);
    if (res.error) {
      setError(
        res.error.status === 401
          ? 'That email and password don’t match an account.'
          : (res.error.message ?? 'Could not sign in.'),
      );
      return;
    }
    // Reset (not just invalidate) so the route guard fetches the new session instead of reusing the cached one.
    await qc.resetQueries({ queryKey: keys.me });
    // Only follow redirects within this app.
    navigate({ to: redirect?.startsWith('/') && !redirect.startsWith('//') ? redirect : '/' });
  }

  return (
    <AuthLayout title="Sign in" intro="Forgot your password? Ask an admin in your household to reset it.">
      <form onSubmit={onSubmit} className="grid gap-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <TextField label="Email" name="email" type="email" autoComplete="email" required autoFocus />
        <TextField label="Password" name="password" type="password" autoComplete="current-password" required />
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
