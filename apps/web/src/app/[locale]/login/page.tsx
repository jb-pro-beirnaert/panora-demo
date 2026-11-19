'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { coreApi } from '@/lib/api';

type DemoAccounts = Awaited<ReturnType<typeof coreApi.demoAccounts>>;

export default function LoginPage() {
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(false);
  const [demo, setDemo] = useState<DemoAccounts | null>(null);

  useEffect(() => {
    coreApi
      .demoAccounts()
      .then(setDemo)
      .catch(() => setDemo(null));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(false);
    try {
      await coreApi.login(email, password);
      // Full reload: the session cookie now opens the API and the realtime stream.
      window.location.assign(window.location.pathname.replace(/\/login$/, '') || '/');
    } catch {
      setError(true);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <div className="space-y-1">
              <Label htmlFor="email">{t('email')}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="password">{t('password')}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-destructive">{t('wrong')}</p>}
            <Button type="submit">{t('submit')}</Button>
          </form>
        </CardContent>
      </Card>
      {demo && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {t('demoAccounts', { password: demo.password })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {demo.accounts.map((account) => (
              <button
                key={account.email}
                type="button"
                className="block w-full rounded px-2 py-1 text-left hover:bg-muted"
                onClick={() => {
                  setEmail(account.email);
                  setPassword(demo.password);
                }}
              >
                <span className="font-medium">{account.name}</span>{' '}
                <span className="text-muted-foreground">
                  — {account.brokerage} — {account.email}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
