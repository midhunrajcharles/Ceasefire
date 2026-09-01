'use client';

import {
  ENGINES,
  type DomainOffer,
  type EngineStatus,
  type Finding,
  type Notice,
  type Scan,
  type ScanSummary,
} from './types';
import type {
  ActivityEvent,
  Integration,
  NoticeRecord,
  PortfolioDomain,
  SurfaceStat,
  TrendPoint,
} from './workspace';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000';

/**
 * Every response on this client is a row the backend computed. There is no
 * fixture path — if the API is down the UI shows the error, not invented data.
 */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * `credentials: 'include'` is not optional. The session is an httpOnly cookie on
 * localhost:8000 and the app is served from localhost:3000 — a cross-origin fetch
 * drops the cookie without it, and every authenticated route answers 401.
 */
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, `Cannot reach the API at ${API_BASE}. Is the backend running?`);
  }

  if (!res.ok) throw new ApiError(res.status, await detail(res));
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** FastAPI puts the human-readable message in `detail`. Fall back to the status line. */
async function detail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    const d = (body as { detail?: unknown }).detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d) && d.length) {
      const first = d[0] as { msg?: string };
      if (first?.msg) return first.msg;
    }
  } catch {
    /* not JSON */
  }
  return res.statusText || `Request failed (${res.status})`;
}

// ── Auth ───────────────────────────────────────────────────────────────────

export interface SessionResponse {
  email: string;
  organisation: string;
  createdAt: string;
}

export function apiSignup(email: string, password: string, organisation: string) {
  return req<SessionResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, organisation }),
  });
}

export function apiSignin(email: string, password: string) {
  return req<SessionResponse>('/auth/signin', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function apiSignout() {
  return req<void>('/auth/signout', { method: 'POST' });
}

/** Resolves the cookie the browser already holds. 401 → nobody is signed in. */
export async function apiMe(): Promise<SessionResponse | null> {
  try {
    return await req<SessionResponse>('/auth/me');
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

// ── Scans ──────────────────────────────────────────────────────────────────

export function startScan(brand: string, domain: string): Promise<{ id: string }> {
  return req<{ id: string }>('/scan', {
    method: 'POST',
    body: JSON.stringify({ brand, domain }),
  });
}

export function getScan(id: string): Promise<Scan> {
  return req<Scan>(`/scan/${id}`);
}

export function listScans(): Promise<ScanSummary[]> {
  return req<ScanSummary[]>('/scans');
}

// ── Notices ────────────────────────────────────────────────────────────────

export function generateNotice(scanId: string, findingId: string): Promise<Notice> {
  return req<Notice>(`/scan/${scanId}/notice`, {
    method: 'POST',
    body: JSON.stringify({ finding_id: findingId }),
  });
}

/** Human review gate — the notice cannot be signed until a person marks it reviewed. */
export function approveNotice(noticeId: string): Promise<Notice> {
  return req<Notice>(`/notice/${noticeId}/approve`, { method: 'POST' });
}

/** Routes the approved notice to Foxit eSign. Still not sent to the registrant. */
export function signNotice(noticeId: string): Promise<Notice> {
  return req<Notice>(`/notice/${noticeId}/sign`, { method: 'POST' });
}

// ── Domains ────────────────────────────────────────────────────────────────

export function checkAvailability(domain: string): Promise<DomainOffer> {
  return req<DomainOffer>(`/domain/availability?domain=${encodeURIComponent(domain)}`);
}

export function registerDomain(domain: string): Promise<{ ok: boolean; orderId?: string }> {
  return req(`/domain/register`, { method: 'POST', body: JSON.stringify({ domain }) });
}

// ── Workspace aggregates ───────────────────────────────────────────────────

export interface WorkspaceOverview {
  stats: { openCriticals: number; hostileDomains: number; noticesInFlight: number };
  trend: TrendPoint[];
  activity: ActivityEvent[];
}

export function getOverview(): Promise<WorkspaceOverview> {
  return req<WorkspaceOverview>('/workspace/overview');
}

export function getWorkspaceFindings(): Promise<Finding[]> {
  return req<Finding[]>('/workspace/findings');
}

export function getNotices(): Promise<NoticeRecord[]> {
  return req<NoticeRecord[]>('/workspace/notices');
}

export function getDomains(): Promise<PortfolioDomain[]> {
  return req<PortfolioDomain[]>('/workspace/domains');
}

export function getSurfaces(): Promise<SurfaceStat[]> {
  return req<SurfaceStat[]>('/workspace/surfaces');
}

export function getIntegrations(): Promise<Integration[]> {
  return req<Integration[]>('/workspace/integrations');
}

export function getBudget(): Promise<{ total: number; spent: number; cacheHits: number }> {
  return req('/workspace/budget');
}

// ── Shared helpers ─────────────────────────────────────────────────────────

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
    budget: { total: 0, spent: 0, cacheHits: 0 },
  };
}
