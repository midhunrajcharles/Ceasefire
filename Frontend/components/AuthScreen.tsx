'use client';

import React, { useState } from 'react';
import CeasefireMark from './CeasefireMark';
import { isFreeMail, signIn, signUp, type Session } from '@/lib/session';

type Mode = 'signin' | 'signup';

export default function AuthScreen({ onAuthed }: { onAuthed: (s: Session) => void }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  function validate(): boolean {
    const next: Record<string, string> = {};

    if (!email.trim()) next.email = 'Required.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      next.email = 'Enter a valid email address.';
    else if (mode === 'signup' && isFreeMail(email))
      next.email = 'Use a work address — the domain you want to protect.';

    if (!password) next.password = 'Required.';
    else if (mode === 'signup' && password.length < 10)
      next.password = 'At least 10 characters.';

    if (mode === 'signup' && !organisation.trim()) next.organisation = 'Required.';

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setBusy(true);
    setErrors({});
    try {
      const session =
        mode === 'signup'
          ? await signUp(email.trim(), password, organisation.trim())
          : await signIn(email.trim(), password);
      onAuthed(session);
    } catch (err) {
      // The API owns these rules — show what it actually said rather than a guess.
      setErrors({ form: err instanceof Error ? err.message : 'Could not sign in.' });
    } finally {
      setBusy(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setErrors({});
    setPassword('');
  }

  return (
    <main className="relative z-10 min-h-screen grid grid-cols-1 lg:grid-cols-2">
      {/* Left — statement */}
      <section className="hidden lg:flex flex-col justify-between border-r border-neutral-200 p-12 xl:p-16">
        <CeasefireMark className="text-black" />

        <div className="max-w-md">
          <p className="text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-mono mb-6">
            Brand impersonation reconnaissance
          </p>
          <h1 className="text-3xl xl:text-4xl font-light leading-[1.15] tracking-tight text-neutral-900">
            Someone registered a domain one character off yours, and configured it to send mail.
          </h1>
          <p className="mt-6 text-[13px] leading-relaxed text-neutral-600">
            Ceasefire sweeps ten separate search surfaces for anyone impersonating your brand, ranks
            what it finds by how dangerous it is, and drafts the takedown notice for a person to
            review.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-8">
          <Stat k="Surfaces" v="10" />
          <Stat k="Input" v="1" />
          <Stat k="Auto-sent" v="0" />
        </dl>
      </section>

      {/* Right — form */}
      <section className="flex flex-col justify-center px-6 py-16 sm:px-12 lg:px-16">
        <div className="w-full max-w-sm mx-auto">
          <div className="lg:hidden mb-12">
            <CeasefireMark className="text-black" />
          </div>

          {/* Mode switch */}
          <div className="inline-flex border border-neutral-200 rounded-full p-1 mb-10">
            {(['signin', 'signup'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => switchMode(m)}
                className={`px-5 py-2 rounded-full font-mono text-[10px] uppercase tracking-[0.15em] transition-colors duration-300 ${
                  mode === m ? 'bg-black text-white' : 'text-neutral-500 hover:text-black'
                }`}
              >
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <h2 className="text-2xl font-light tracking-tight text-neutral-900 mb-2">
            {mode === 'signin' ? 'Welcome back' : 'Protect a brand'}
          </h2>
          <p className="text-[13px] leading-relaxed text-neutral-500 mb-10">
            {mode === 'signin'
              ? 'Sign in to run a sweep and review open findings.'
              : 'Create a workspace for the domain you want to monitor.'}
          </p>

          <form onSubmit={submit} noValidate className="space-y-7">
            <Field
              id="email"
              label="Work email"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@yourcompany.com"
              error={errors.email}
              autoComplete="email"
            />

            {mode === 'signup' && (
              <Field
                id="organisation"
                label="Organisation"
                value={organisation}
                onChange={setOrganisation}
                placeholder="Your Company Ltd"
                error={errors.organisation}
                autoComplete="organization"
              />
            )}

            <Field
              id="password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              placeholder={mode === 'signup' ? 'At least 10 characters' : '••••••••••'}
              error={errors.password}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />

            {errors.form && (
              <p role="alert" className="font-mono text-[11px] leading-relaxed text-red-600">
                {errors.form}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full text-[11px] uppercase tracking-[0.15em] font-mono font-medium px-6 py-4 rounded-full bg-black text-white border border-neutral-900 hover:bg-white hover:text-black transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
              data-cursor={mode === 'signin' ? 'Sign in' : 'Create'}
            >
              {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create workspace'}
            </button>
          </form>

          <p className="mt-10 text-[11px] leading-relaxed text-neutral-400">
            {mode === 'signin' ? (
              <>
                No account?{' '}
                <button
                  onClick={() => switchMode('signup')}
                  className="text-neutral-900 underline underline-offset-2 hover:no-underline"
                >
                  Create one
                </button>
                .
              </>
            ) : (
              <>
                Already have one?{' '}
                <button
                  onClick={() => switchMode('signin')}
                  className="text-neutral-900 underline underline-offset-2 hover:no-underline"
                >
                  Sign in
                </button>
                .
              </>
            )}
          </p>

          <p className="mt-8 pt-6 border-t border-neutral-200 text-[10px] leading-relaxed text-neutral-400 font-mono">
            Passwords are hashed with Argon2id and the session is an httpOnly cookie.
            Sign-up requires a work address — the domain you want to protect.
          </p>
        </div>
      </section>
    </main>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-400">{k}</dt>
      <dd className="mt-1 font-mono text-2xl text-neutral-900 tabular-nums">{v}</dd>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  error,
  type = 'text',
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[11px] uppercase tracking-[0.15em] text-neutral-400 font-mono mb-2"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`w-full bg-transparent border-b px-0 py-3 text-[15px] text-neutral-900 placeholder:text-neutral-300 focus:outline-none transition-colors duration-300 ${
          error ? 'border-red-400 focus:border-red-600' : 'border-neutral-200 focus:border-black'
        }`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-2 font-mono text-[11px] text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
