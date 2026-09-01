'use client';

import type { EngineId, RiskTier } from './types';

/**
 * Workspace-level aggregates — everything that spans more than a single sweep.
 * These are the shapes the /workspace/* endpoints return; the data itself is
 * fetched in lib/api.ts and passed down as props.
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

export interface WorkspaceStats {
  openCriticals: number;
  hostileDomains: number;
  noticesInFlight: number;
}

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
