'use client';

/**
 * Sign in.
 *
 * Magic link only. No password field, which means no password reset flow, no
 * password strength theatre, and no credential to leak — for an app whose whole
 * pitch is that you can try it without an account, a second auth mechanism is
 * surface area with no user behind it.
 *
 * The page never claims whether an address is registered. Sign-in and sign-up
 * are the same button and produce the same message, because a form that says
 * "no account with that email" is an account-enumeration oracle.
 */
import { ArrowLeft, MailCheck, Send } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { z } from 'zod';

import { useCapabilities } from '@/components/providers/capabilities';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { getBrowserSupabase } from '@/lib/supabase/client';

const emailSchema = z.string().trim().min(3).max(254).email('Enter a valid email address');

type Phase = 'idle' | 'sending' | 'sent';

export default function SignInPage() {
  const capabilities = useCapabilities();
  const [email, setEmail] = React.useState('');
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      const parsed = emailSchema.safeParse(email);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address');
        return;
      }

      const supabase = getBrowserSupabase();
      if (!supabase) {
        setError('Sign-in is not configured on this deployment. The guest demo is fully usable.');
        return;
      }

      setPhase('sending');
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: parsed.data,
        options: {
          // The callback exchanges the code and then forwards to the planner.
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/today`,
        },
      });

      if (authError) {
        setPhase('idle');
        // Rate limiting is the one error worth naming, because the user needs
        // to know that waiting is the fix.
        setError(
          authError.status === 429
            ? 'Too many requests. Wait a minute and try again.'
            : 'Could not send the link. Check the address and try again.',
        );
        return;
      }

      setPhase('sent');
    },
    [email],
  );

  if (!capabilities.authAvailable) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Accounts are not enabled here</CardTitle>
          <CardDescription>
            This deployment has no Supabase credentials configured, so there is nothing to sign in
            to. The guest demo is the complete app and runs entirely in your browser.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="primary" className="w-full">
            <Link href="/today">Open the demo</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (phase === 'sent') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailCheck className="text-success size-5" aria-hidden />
            Check your email
          </CardTitle>
          <CardDescription>
            If an account can be created or found for <span className="text-ink">{email}</span>, a
            sign-in link is on its way. The link works once and expires in an hour.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="secondary" className="w-full" onClick={() => setPhase('idle')}>
            Use a different address
          </Button>
          <Button asChild variant="ghost" className="w-full">
            <Link href="/today">Keep using the demo instead</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to Momentum</CardTitle>
        <CardDescription>
          One link, no password. If you have never signed in before, this creates your account.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="email" error={error}>
            <Input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(error) || undefined}
            />
          </Field>

          <Button type="submit" variant="primary" className="w-full" loading={phase === 'sending'}>
            <Send className="size-4" aria-hidden />
            Send me a link
          </Button>
        </form>

        <div className="border-line mt-5 border-t pt-4">
          <p className="text-ink-subtle text-xs leading-relaxed">
            Not ready for an account? The guest demo has the same scheduler, the same ranking and a
            realistic dataset — it just saves to your browser.
          </p>
          <Button asChild variant="ghost" size="sm" className="mt-2 -ml-3">
            <Link href="/today">
              <ArrowLeft className="size-3.5" aria-hidden />
              Continue as a guest
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
