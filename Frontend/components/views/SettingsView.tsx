'use client';

import React, { useState } from 'react';
import { Badge, Button, PageHeader, Panel } from '../ui';
import { INTEGRATIONS } from '@/lib/workspace';
import { TIER_DEFINITION, TIER_ORDER } from '@/lib/types';
import type { Session } from '@/lib/session';

export default function SettingsView({
  session,
  onSignOut,
}: {
  session: Session;
  onSignOut: () => void;
}) {
  const [org, setOrg] = useState(session.organisation);
  const [primaryDomain, setPrimaryDomain] = useState('');
  const [budget, setBudget] = useState('250');
  const [alertAt, setAlertAt] = useState('200');
  const [permutations, setPermutations] = useState('15');
  const [saved, setSaved] = useState(false);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  }

  return (
    <>
      <PageHeader
        title="Settings"
        lede="Workspace configuration, search budget guardrails, and the integrations behind each stage of the pipeline."
      />

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-10">
        <form onSubmit={save} className="xl:col-span-2 space-y-10">
          <Panel title="Workspace">
            <div className="px-5 py-6 space-y-7">
              <Field id="org" label="Organisation" value={org} onChange={setOrg} />
              <Field
                id="primary"
                label="Primary domain"
                value={primaryDomain}
                onChange={setPrimaryDomain}
                placeholder="yourcompany.com"
                hint="Every sweep generates permutations from this domain."
              />
              <Field id="acct" label="Account" value={session.email} onChange={() => {}} disabled />
            </div>
          </Panel>

          <Panel title="Search budget">
            <div className="px-5 py-6 space-y-7">
              <p className="text-[12px] leading-relaxed text-neutral-500">
                SerpApi&apos;s free tier allows 250 searches a month at 50 per hour. Ceasefire
                enforces both limits in code — a scan pauses and resumes rather than failing.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-7">
                <Field id="budget" label="Monthly budget" value={budget} onChange={setBudget} />
                <Field id="alert" label="Alert at" value={alertAt} onChange={setAlertAt} />
              </div>
              <Field
                id="perms"
                label="Permutations per demo sweep"
                value={permutations}
                onChange={setPermutations}
                hint="Capped deliberately. A 60-permutation sweep would consume a quarter of the monthly budget."
              />
            </div>
          </Panel>

          <div className="flex items-center gap-5">
            <Button variant="primary" type="submit" data-cursor="Save">
              Save changes
            </Button>
            {saved && (
              <span className="font-mono text-[11px] uppercase tracking-[0.15em] text-neutral-500 animate-fadeIn">
                Saved locally
              </span>
            )}
          </div>
        </form>

        <div className="space-y-10">
          <Panel title="Integrations">
            <div className="divide-y divide-neutral-200">
              {INTEGRATIONS.map((i) => (
                <div key={i.name} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-[12px] text-neutral-900">{i.name}</span>
                    <Badge tone={i.status === 'connected' ? 'ok' : 'neutral'}>
                      {i.status === 'connected' ? 'Connected' : 'Not set'}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-neutral-500">{i.role}</p>
                  <p className="mt-1 font-mono text-[10px] text-neutral-400">{i.detail}</p>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Risk tiers">
            <dl className="divide-y divide-neutral-200">
              {TIER_ORDER.map((t) => (
                <div key={t} className="px-5 py-3.5">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-900">
                    {t}
                  </dt>
                  <dd className="mt-1 text-[11px] leading-relaxed text-neutral-500">
                    {TIER_DEFINITION[t]}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Session">
            <div className="px-5 py-5">
              <p className="text-[12px] leading-relaxed text-neutral-500 mb-4">
                The session is held in this browser only. No password is stored.
              </p>
              <Button onClick={onSignOut} data-cursor="Sign out">
                Sign out
              </Button>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
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
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="w-full bg-transparent border-b border-neutral-200 px-0 py-3 text-[14px] text-neutral-900 placeholder:text-neutral-300 focus:border-black focus:outline-none transition-colors duration-300 disabled:text-neutral-400"
      />
      {hint && <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">{hint}</p>}
    </div>
  );
}
