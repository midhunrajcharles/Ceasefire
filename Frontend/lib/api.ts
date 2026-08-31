'use client';

import {
  ENGINES,
  type DomainOffer,
  type EngineStatus,
  type Finding,
  type Notice,
  type Scan,
  type ScanState,
  type ScanSummary,
} from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';

/**
 * Mock mode exists so the interface is complete before the backend lands.
 * It is ALWAYS surfaced as a visible badge in the UI.
 * Set NEXT_PUBLIC_MOCK=0 before recording the demo video.
 */
export const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK === '1';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} — ${detail}`);
  }
  return res.json() as Promise<T>;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function startScan(brand: string, domain: string): Promise<{ id: string }> {
  if (MOCK_MODE) return mockStart(brand, domain);
  return req<{ id: string }>('/scan', {
    method: 'POST',
    body: JSON.stringify({ brand, domain }),
  });
}

export async function getScan(id: string): Promise<Scan> {
  if (MOCK_MODE) return mockPoll(id);
  return req<Scan>(`/scan/${id}`);
}

export async function listScans(): Promise<ScanSummary[]> {
  if (MOCK_MODE) return mockHistory();
  return req<ScanSummary[]>('/scans');
}

export async function generateNotice(scanId: string, findingId: string): Promise<Notice> {
  if (MOCK_MODE) return mockNotice(findingId);
  return req<Notice>(`/scan/${scanId}/notice`, {
    method: 'POST',
    body: JSON.stringify({ finding_id: findingId }),
  });
}

/** Human review gate — the notice cannot be signed until a person marks it reviewed. */
export async function approveNotice(noticeId: string): Promise<Notice> {
  if (MOCK_MODE) {
    mockNoticeStore.state = 'reviewed';
    mockNoticeStore.reviewed = true;
    return { ...mockNoticeStore };
  }
  return req<Notice>(`/notice/${noticeId}/approve`, { method: 'POST' });
}

/** Routes the approved notice to Foxit eSign. Still not sent to the registrant. */
export async function signNotice(noticeId: string): Promise<Notice> {
  if (MOCK_MODE) {
    await wait(900);
    mockNoticeStore.state = 'signed';
    mockNoticeStore.signed = true;
    mockNoticeStore.signedAt = new Date().toISOString();
    mockNoticeStore.envelopeId = 'env_8f2c41a9';
    mockNoticeStore.pdfUrl = '#';
    return { ...mockNoticeStore };
  }
  return req<Notice>(`/notice/${noticeId}/sign`, { method: 'POST' });
}

export async function checkAvailability(domain: string): Promise<DomainOffer> {
  if (MOCK_MODE) {
    await wait(600);
    return { domain, available: true, priceUsd: 12.99 };
  }
  return req<DomainOffer>(`/domain/availability?domain=${encodeURIComponent(domain)}`);
}

export async function registerDomain(domain: string): Promise<{ ok: boolean; orderId?: string }> {
  if (MOCK_MODE) {
    await wait(1100);
    return { ok: true, orderId: 'ord_mock_4412' };
  }
  return req(`/domain/register`, { method: 'POST', body: JSON.stringify({ domain }) });
}

// ── Shared helpers ─────────────────────────────────────────────────────────

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function idleEngines(): EngineStatus[] {
  return ENGINES.map((e) => ({
    ...e,
    state: 'idle' as const,
    findings: 0,
    searchesSpent: 0,
    cacheHit: false,
  }));
}

export function emptyScan(brand = '', domain = ''): Scan {
  return {
    id: '',
    brand,
    domain,
    state: 'idle',
    prefilter: { generated: 0, survivedDns: 0, mailCapable: 0, survivedHttp: 0 },
    engines: idleEngines(),
    findings: [],
    budget: { total: 250, spent: 0, cacheHits: 0 },
  };
}

// ── Staged mock ────────────────────────────────────────────────────────────
// Progresses through the real pipeline stages over ~13s so every UI state is
// reachable without a backend. Shapes match the real API contract exactly.

const STAGE_MS = {
  generating: 1_600,
  prefiltering: 4_200,
  sweeping: 11_400,
  scoring: 12_600,
};

const ENGINE_PLAN: { findings: number; cached: boolean }[] = [
  { findings: 2, cached: false },
  { findings: 1, cached: false },
  { findings: 1, cached: false },
  { findings: 1, cached: true },
  { findings: 0, cached: false },
  { findings: 0, cached: false },
  { findings: 0, cached: true },
  { findings: 1, cached: false },
  { findings: 0, cached: false },
  { findings: 0, cached: true },
];

let mockRun: { id: string; brand: string; domain: string; t0: number } | null = null;

function mockStart(brand: string, domain: string) {
  mockRun = { id: `mock_${Date.now().toString(36)}`, brand, domain, t0: Date.now() };
  return { id: mockRun.id };
}

function lerpInt(from: number, to: number, p: number) {
  return Math.round(from + (to - from) * Math.max(0, Math.min(1, p)));
}

function mockPoll(id: string): Scan {
  const run = mockRun ?? { id, brand: 'Example Corp', domain: 'example-corp.com', t0: Date.now() - 99_999 };
  const el = Date.now() - run.t0;

  let state: ScanState = 'complete';
  if (el < STAGE_MS.generating) state = 'generating';
  else if (el < STAGE_MS.prefiltering) state = 'prefiltering';
  else if (el < STAGE_MS.sweeping) state = 'sweeping';
  else if (el < STAGE_MS.scoring) state = 'scoring';

  // Prefilter counts animate up during their stages
  const genP = el / STAGE_MS.generating;
  const preP = (el - STAGE_MS.generating) / (STAGE_MS.prefiltering - STAGE_MS.generating);
  const prefilter = {
    generated: lerpInt(0, 204, genP),
    survivedDns: state === 'generating' ? 0 : lerpInt(0, 41, preP),
    mailCapable: state === 'generating' ? 0 : lerpInt(0, 9, preP),
    survivedHttp: state === 'generating' ? 0 : lerpInt(0, 18, preP),
  };

  // Engines complete one at a time across the sweeping window
  const sweepP = (el - STAGE_MS.prefiltering) / (STAGE_MS.sweeping - STAGE_MS.prefiltering);
  const enginesDone = state === 'generating' || state === 'prefiltering'
    ? 0
    : Math.min(ENGINES.length, Math.floor(sweepP * ENGINES.length) + 1);

  const engines: EngineStatus[] = ENGINES.map((e, i) => {
    const plan = ENGINE_PLAN[i];
    if (i < enginesDone - 1 || state === 'complete' || state === 'scoring') {
      return {
        ...e,
        state: plan.cached ? ('cached' as const) : ('done' as const),
        findings: plan.findings,
        searchesSpent: plan.cached ? 0 : 1,
        cacheHit: plan.cached,
        ms: 380 + i * 95,
      };
    }
    if (i === enginesDone - 1) {
      return { ...e, state: 'running' as const, findings: 0, searchesSpent: 0, cacheHit: false };
    }
    return { ...e, state: 'idle' as const, findings: 0, searchesSpent: 0, cacheHit: false };
  });

  const spent = engines.reduce((n, e) => n + e.searchesSpent, 0);
  const cacheHits = engines.filter((e) => e.cacheHit).length;

  return {
    id: run.id,
    brand: run.brand,
    domain: run.domain,
    state,
    prefilter,
    engines,
    findings: state === 'complete' ? mockFindings(run.domain) : [],
    budget: { total: 250, spent: spent + (state === 'complete' ? 4 : 0), cacheHits },
    startedAt: new Date(run.t0).toISOString(),
    completedAt: state === 'complete' ? new Date(run.t0 + STAGE_MS.scoring).toISOString() : undefined,
    elapsedMs: el,
    isMock: true,
  };
}

/**
 * Visually-confusable substitution. Tries each swap in turn and falls back to
 * doubling a middle character, so the result is NEVER equal to the input —
 * a "finding" identical to the brand's own domain is worse than no finding.
 */
function homoglyph(label: string): string {
  const swaps: [RegExp, string][] = [
    [/m/, 'rn'],
    [/w/, 'vv'],
    [/d/, 'cl'],
    [/l/, 'I'],
    [/o/, '0'],
    [/i/, 'l'],
  ];
  for (const [re, to] of swaps) {
    if (re.test(label)) return label.replace(re, to);
  }
  const i = Math.max(1, Math.floor(label.length / 2));
  return label.slice(0, i) + label[i] + label.slice(i);
}

function mockFindings(domain: string): Finding[] {
  const label = domain.replace(/\.[a-z.]+$/, '');
  const tld = domain.slice(label.length) || '.com';
  const now = new Date().toISOString();
  const look = homoglyph(label);

  return [
    {
      id: 'f1',
      domain: `${look}${tld}`,
      tier: 'CRITICAL',
      reason: 'Cited in AI Overview for 3 of 5 brand queries',
      technique: 'Homoglyph',
      mailCapable: true,
      live: true,
      registered: true,
      aiOverviewCited: true,
      evidence: [
        {
          engine: 'google_ai_overview',
          url: `https://${look}${tld}/support`,
          snippet: 'Listed as a source in the AI Overview answering "how do I contact <brand> support".',
          fetchedAt: now,
        },
        {
          engine: 'google_ai_mode',
          url: `https://${look}${tld}/`,
          snippet: 'Surfaced again on turn 2 of a conversational query about account recovery.',
          fetchedAt: now,
        },
      ],
    },
    {
      id: 'f2',
      domain: `${label}-login${tld}`,
      tier: 'HIGH',
      reason: 'Live page with MX records configured — mail-capable',
      technique: 'Combosquat',
      mailCapable: true,
      live: true,
      registered: true,
      aiOverviewCited: false,
      evidence: [
        {
          engine: 'google',
          url: `https://${label}-login${tld}`,
          snippet: 'Indexed login page cloning the brand sign-in flow.',
          fetchedAt: now,
        },
      ],
    },
    {
      id: 'f3',
      domain: `${label}.app`,
      tier: 'MEDIUM',
      reason: 'Play Store listing using the brand name',
      technique: 'TLD swap',
      mailCapable: false,
      live: true,
      registered: true,
      aiOverviewCited: false,
      evidence: [
        {
          engine: 'google_play',
          url: `https://play.google.com/store/apps/details?id=com.${label}.app`,
          snippet: 'Unaffiliated publisher, brand name in the title, logo reused as the icon.',
          fetchedAt: now,
        },
      ],
    },
    {
      id: 'f4',
      domain: `${label.slice(0, -1)}${tld}`,
      tier: 'LOW',
      reason: 'Unregistered — defensive registration candidate',
      technique: 'Omission',
      mailCapable: false,
      live: false,
      registered: false,
      aiOverviewCited: false,
      evidence: [],
    },
    {
      id: 'f5',
      domain: `${label}-secure${tld}`,
      tier: 'LOW',
      reason: 'Unregistered — defensive registration candidate',
      technique: 'Combosquat',
      mailCapable: false,
      live: false,
      registered: false,
      aiOverviewCited: false,
      evidence: [],
    },
  ];
}

function mockHistory(): ScanSummary[] {
  const d = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
  return [
    { id: 'h1', brand: 'Northwind Supply', domain: 'northwind-supply.com', completedAt: d(3),  findingCount: 6, criticalCount: 1, searchesSpent: 15 },
    { id: 'h2', brand: 'Kestrel Health',   domain: 'kestrelhealth.io',     completedAt: d(27), findingCount: 2, criticalCount: 0, searchesSpent: 12 },
    { id: 'h3', brand: 'Vantage Labs',     domain: 'vantagelabs.co',       completedAt: d(52), findingCount: 9, criticalCount: 2, searchesSpent: 17 },
  ];
}

const mockNoticeStore: Notice = {
  id: 'mock-notice',
  findingId: '',
  domain: '',
  caseFacts: {},
  bodyMarkdown: '',
  state: 'draft',
  reviewed: false,
  signed: false,
};

function mockNotice(findingId: string): Notice {
  const f = mockFindings(mockRun?.domain ?? 'example-corp.com').find((x) => x.id === findingId);
  const domain = f?.domain ?? 'exarnple-corp.com';
  const brand = mockRun?.brand ?? 'Example Corp';

  Object.assign(mockNoticeStore, {
    id: 'mock-notice',
    findingId,
    domain,
    caseFacts: {
      registrant_domain: domain,
      rights_holder: brand,
      first_observed: new Date().toISOString().slice(0, 10),
      harm_class: f?.reason ?? 'Lookalike domain',
      permutation_technique: f?.technique ?? 'Unknown',
      evidence_count: String(f?.evidence.length ?? 0),
      mail_capable: f?.mailCapable ? 'yes' : 'no',
    },
    bodyMarkdown: [
      '## Notice of Trademark Infringement and Demand to Cease and Desist',
      '',
      `**To:** the registrant of ${domain}`,
      `**From:** ${brand}, rights holder`,
      `**Date:** ${new Date().toISOString().slice(0, 10)}`,
      '',
      '### 1. Rights asserted',
      `${brand} is the owner of the mark used throughout the domain and site identified above.`,
      '',
      '### 2. Conduct observed',
      f?.reason ?? 'Use of a confusingly similar domain.',
      f?.mailCapable
        ? 'The domain has MX records configured and is capable of sending mail that appears to originate from the rights holder.'
        : 'No mail-exchange records were observed at the time of this notice.',
      '',
      '### 3. Demand',
      'Cease all use of the mark, disable the identified content, and transfer or cancel the registration within 14 days of receipt.',
      '',
      '### 4. Evidence',
      `${f?.evidence.length ?? 0} item(s) attached, each with the search surface, URL and capture timestamp.`,
      '',
      '---',
      '_Generated from structured case facts through a conditional template. Reviewed by a person before signature._',
    ].join('\n'),
    state: 'draft',
    reviewed: false,
    signed: false,
    signedAt: undefined,
    envelopeId: undefined,
    pdfUrl: undefined,
  });

  return { ...mockNoticeStore };
}
