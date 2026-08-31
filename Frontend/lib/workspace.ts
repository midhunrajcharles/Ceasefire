'use client';

import type { EngineId, RiskTier } from './types';

/**
 * Workspace-level aggregates — everything that spans more than a single sweep.
 * Stubbed here so every view is complete before the backend lands; the shapes
 * are the contract the API should return.
 */

export type NoticeStage = 'draft' | 'awaiting_signature' | 'signed' | 'delivered' | 'resolved';

export interface NoticeRecord {
  id: string;
  domain: string;
  tier: RiskTier;
  stage: NoticeStage;
  createdAt: string;
  updatedAt: string;
  registrar?: string;
}

export type DomainStatus = 'protected' | 'watchlist' | 'available' | 'hostile';

export interface PortfolioDomain {
  domain: string;
  status: DomainStatus;
  technique: string;
  registrar?: string;
  expiresAt?: string;
  priceUsd?: number;
  mailCapable?: boolean;
  firstSeen: string;
}

export interface SurfaceStat {
  id: EngineId;
  findingsAllTime: number;
  searchesSpent: number;
  avgMs: number;
  cacheHitRate: number;
}

export interface ActivityEvent {
  id: string;
  at: string;
  kind: 'sweep' | 'finding' | 'notice' | 'domain' | 'system';
  text: string;
  emphasis?: boolean;
}

export interface TrendPoint {
  label: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface Integration {
  name: string;
  role: string;
  status: 'connected' | 'not_configured';
  detail: string;
}

// ── Mock workspace ─────────────────────────────────────────────────────────

const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000).toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

export const NOTICES: NoticeRecord[] = [
  { id: 'n1', domain: 'northwind-suppIy.com', tier: 'CRITICAL', stage: 'awaiting_signature', createdAt: hoursAgo(3),  updatedAt: hoursAgo(2), registrar: 'NameSilo' },
  { id: 'n2', domain: 'northwind-login.com',  tier: 'HIGH',     stage: 'draft',              createdAt: hoursAgo(3),  updatedAt: hoursAgo(3), registrar: 'Namecheap' },
  { id: 'n3', domain: 'vantagelabs-app.co',   tier: 'CRITICAL', stage: 'delivered',          createdAt: daysAgo(2),   updatedAt: daysAgo(1),  registrar: 'Porkbun' },
  { id: 'n4', domain: 'kestrelheaith.io',     tier: 'HIGH',     stage: 'signed',             createdAt: daysAgo(1),   updatedAt: hoursAgo(9), registrar: 'GoDaddy' },
  { id: 'n5', domain: 'vantage1abs.co',       tier: 'MEDIUM',   stage: 'resolved',           createdAt: daysAgo(9),   updatedAt: daysAgo(4),  registrar: 'Dynadot' },
];

export const PORTFOLIO: PortfolioDomain[] = [
  { domain: 'northwind-supply.net',  status: 'protected', technique: 'TLD swap',      registrar: 'name.com', expiresAt: daysAgo(-318), firstSeen: daysAgo(40) },
  { domain: 'northwindsupply.com',   status: 'protected', technique: 'Hyphenation',   registrar: 'name.com', expiresAt: daysAgo(-291), firstSeen: daysAgo(38) },
  { domain: 'northwind-suppIy.com',  status: 'hostile',   technique: 'Homoglyph',     registrar: 'NameSilo', mailCapable: true,  firstSeen: hoursAgo(3) },
  { domain: 'northwind-login.com',   status: 'hostile',   technique: 'Combosquat',    registrar: 'Namecheap', mailCapable: true, firstSeen: hoursAgo(3) },
  { domain: 'northwind-supply.app',  status: 'watchlist', technique: 'TLD swap',      registrar: 'Cloudflare', mailCapable: false, firstSeen: daysAgo(12) },
  { domain: 'nortwind-supply.com',   status: 'available', technique: 'Omission',      priceUsd: 12.99, firstSeen: hoursAgo(3) },
  { domain: 'northwind-secure.com',  status: 'available', technique: 'Combosquat',    priceUsd: 12.99, firstSeen: hoursAgo(3) },
  { domain: 'northwnid-supply.com',  status: 'available', technique: 'Transposition', priceUsd: 12.99, firstSeen: hoursAgo(3) },
];

export const SURFACE_STATS: SurfaceStat[] = [
  { id: 'google',             findingsAllTime: 24, searchesSpent: 61, avgMs: 480,  cacheHitRate: 0.31 },
  { id: 'google_ai_overview', findingsAllTime: 4,  searchesSpent: 18, avgMs: 1240, cacheHitRate: 0.00 },
  { id: 'google_ai_mode',     findingsAllTime: 3,  searchesSpent: 15, avgMs: 1580, cacheHitRate: 0.00 },
  { id: 'google_play',        findingsAllTime: 5,  searchesSpent: 9,  avgMs: 620,  cacheHitRate: 0.44 },
  { id: 'apple_app_store',    findingsAllTime: 2,  searchesSpent: 9,  avgMs: 700,  cacheHitRate: 0.44 },
  { id: 'google_shopping',    findingsAllTime: 3,  searchesSpent: 8,  avgMs: 810,  cacheHitRate: 0.38 },
  { id: 'google_maps',        findingsAllTime: 2,  searchesSpent: 7,  avgMs: 540,  cacheHitRate: 0.57 },
  { id: 'youtube',            findingsAllTime: 6,  searchesSpent: 8,  avgMs: 660,  cacheHitRate: 0.25 },
  { id: 'google_images',      findingsAllTime: 1,  searchesSpent: 6,  avgMs: 930,  cacheHitRate: 0.33 },
  { id: 'google_trends',      findingsAllTime: 0,  searchesSpent: 5,  avgMs: 410,  cacheHitRate: 0.60 },
];

export const ACTIVITY: ActivityEvent[] = [
  { id: 'a1', at: hoursAgo(2),  kind: 'notice',  text: 'Notice for northwind-suppIy.com approved — awaiting signature' },
  { id: 'a2', at: hoursAgo(3),  kind: 'finding', text: 'AI Overview cited northwind-suppIy.com as a source for 3 brand queries', emphasis: true },
  { id: 'a3', at: hoursAgo(3),  kind: 'sweep',   text: 'Sweep completed for northwind-supply.com — 6 findings, 15 searches' },
  { id: 'a4', at: hoursAgo(9),  kind: 'notice',  text: 'kestrelheaith.io notice signed via Foxit eSign' },
  { id: 'a5', at: hoursAgo(26), kind: 'domain',  text: 'northwind-supply.net registered defensively through name.com' },
  { id: 'a6', at: hoursAgo(27), kind: 'sweep',   text: 'Sweep completed for kestrelhealth.io — 2 findings, 12 searches' },
  { id: 'a7', at: hoursAgo(34), kind: 'system',  text: 'Rate limiter backed off twice — 50/hour throughput cap reached' },
  { id: 'a8', at: hoursAgo(52), kind: 'sweep',   text: 'Sweep completed for vantagelabs.co — 9 findings, 17 searches' },
];

export const TREND: TrendPoint[] = [
  { label: 'Wk 1', critical: 0, high: 1, medium: 2, low: 3 },
  { label: 'Wk 2', critical: 1, high: 1, medium: 1, low: 4 },
  { label: 'Wk 3', critical: 0, high: 2, medium: 3, low: 4 },
  { label: 'Wk 4', critical: 1, high: 3, medium: 2, low: 5 },
  { label: 'Wk 5', critical: 2, high: 2, medium: 4, low: 6 },
  { label: 'Wk 6', critical: 3, high: 4, medium: 3, low: 7 },
];

export const INTEGRATIONS: Integration[] = [
  { name: 'SerpApi',   role: 'Ten search surfaces',          status: 'connected',      detail: '250 searches/month · 50/hour' },
  { name: 'Xano',      role: 'Backend, cache, audit trail',  status: 'connected',      detail: 'Result cache and scan history' },
  { name: 'Foxit',     role: 'PDF generation + eSign',       status: 'connected',      detail: 'MCP server · 500 credits' },
  { name: 'Doctavian', role: 'Conditional-template notices', status: 'connected',      detail: 'eIDAS-aligned signatures' },
  { name: 'Nutrient',  role: 'Embedded review gate',         status: 'connected',      detail: 'Viewer + annotation' },
  { name: 'name.com',  role: 'Availability + registration',  status: 'connected',      detail: 'Sandbox — api.dev.name.com' },
];

export const NOTICE_STAGE_LABEL: Record<NoticeStage, string> = {
  draft: 'Draft',
  awaiting_signature: 'Awaiting signature',
  signed: 'Signed',
  delivered: 'Delivered',
  resolved: 'Resolved',
};

export const DOMAIN_STATUS_LABEL: Record<DomainStatus, string> = {
  protected: 'Protected',
  hostile: 'Hostile',
  watchlist: 'Watchlist',
  available: 'Available',
};

export function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
