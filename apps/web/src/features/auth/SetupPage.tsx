import { setupInputSchema } from '@precious/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { authClient } from '../../api/auth.ts';
import { ApiError, errorMessage } from '../../api/client.ts';
import { keys, useSetup } from '../../api/queries.ts';
import { Button, ErrorBox, TextField } from '../../components/ui.tsx';
import { AuthLayout } from './AuthLayout.tsx';

export function SetupPage() {
  const setup = useSetup();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const parsed = setupInputSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setError('');
    try {
      await setup.mutateAsync(parsed.data);
      const res = await authClient.signIn.email({ email: parsed.data.email, password: parsed.data.password });
      if (res.error) throw new Error(res.error.message ?? 'Could not sign in.');
      await qc.resetQueries({ queryKey: keys.setup });
      await qc.resetQueries({ queryKey: keys.me });
      navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? err.message : errorMessage(err));
    }
  }

  return (
    <AuthLayout
      title="Welcome"
      intro="Create the first account. It will be the admin: you'll add everyone else in your household from the Server page."
    >
      <form onSubmit={onSubmit} className="grid gap-4" noValidate>
        {error && <ErrorBox>{error}</ErrorBox>}
        <TextField label="Your name" name="name" autoComplete="name" error={errors.name} required />
        <TextField label="Email" name="email" type="email" autoComplete="email" error={errors.email} required />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          help="At least 10 characters."
          error={errors.password}
          required
        />
        <Button type="submit" variant="primary" disabled={setup.isPending}>
          {setup.isPending ? 'Creating account…' : 'Create admin account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
