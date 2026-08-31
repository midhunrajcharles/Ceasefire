// Ceasefire — domain model
// Mirrors the API contract in CEASEFIRE_BUILD_PROMPT.md §4 / §6.

export type RiskTier = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export type EngineId =
  | 'google'
  | 'google_ai_overview'
  | 'google_ai_mode'
  | 'google_play'
  | 'apple_app_store'
  | 'google_shopping'
  | 'google_maps'
  | 'youtube'
  | 'google_images'
  | 'google_trends';

export type EngineState = 'idle' | 'running' | 'done' | 'cached' | 'error' | 'skipped';

export interface EngineMeta {
  id: EngineId;
  label: string;
  /** What this surface finds that the others do not. Shown in the UI and the write-up. */
  purpose: string;
  /** Marks the two engines nothing else on the market checks. */
  headline?: boolean;
}

export interface EngineStatus extends EngineMeta {
  state: EngineState;
  findings: number;
  searchesSpent: number;
  cacheHit: boolean;
  ms?: number;
}

export interface Evidence {
  engine: EngineId;
  url: string;
  snippet: string;
  fetchedAt: string;
}

export interface Finding {
  id: string;
  domain: string;
  tier: RiskTier;
  /** Human-readable trigger, e.g. "Cited in AI Overview for 3 brand queries". */
  reason: string;
  /** MX records present => phishing-capable. */
  mailCapable: boolean;
  live: boolean;
  registered: boolean;
  aiOverviewCited: boolean;
  /** Which permutation technique produced this candidate. */
  technique?: string;
  evidence: Evidence[];
}

export interface ScanBudget {
  total: number;
  spent: number;
  cacheHits: number;
}

export interface PrefilterStats {
  generated: number;
  survivedDns: number;
  mailCapable: number;
  survivedHttp: number;
}

export type ScanState =
  | 'idle'
  | 'generating'
  | 'prefiltering'
  | 'sweeping'
  | 'scoring'
  | 'complete'
  | 'error';

export const SCAN_STAGES: { key: ScanState; label: string; detail: string }[] = [
  { key: 'generating',   label: 'Generating',   detail: 'Typosquat permutations — homoglyph, omission, transposition, TLD swap, combosquat' },
  { key: 'prefiltering', label: 'Prefiltering', detail: 'DNS, MX and HTTP survival checks — free, no searches spent' },
  { key: 'sweeping',     label: 'Sweeping',     detail: 'Ten search surfaces, rate-limited under the 50/hour cap' },
  { key: 'scoring',      label: 'Scoring',      detail: 'Ranking findings by harm class' },
  { key: 'complete',     label: 'Complete',     detail: 'Findings ready for review' },
];

export interface Scan {
  id: string;
  brand: string;
  domain: string;
  state: ScanState;
  prefilter: PrefilterStats;
  engines: EngineStatus[];
  findings: Finding[];
  budget: ScanBudget;
  startedAt?: string;
  completedAt?: string;
  elapsedMs?: number;
  error?: string;
  /** True when served from mock data. Rendered as a visible badge — never hidden. */
  isMock?: boolean;
}

export interface ScanSummary {
  id: string;
  brand: string;
  domain: string;
  completedAt: string;
  findingCount: number;
  criticalCount: number;
  searchesSpent: number;
}

export type NoticeState = 'draft' | 'reviewed' | 'signed';

export interface Notice {
  id: string;
  findingId: string;
  domain: string;
  /** Structured case facts in, conditional template out. Not prose from a model. */
  caseFacts: Record<string, string>;
  bodyMarkdown: string;
  state: NoticeState;
  /** Human review gate. Nothing is sent until this is true. */
  reviewed: boolean;
  signed: boolean;
  signedAt?: string;
  pdfUrl?: string;
  /** Foxit eSign envelope reference, once routed. */
  envelopeId?: string;
}

export interface DomainOffer {
  domain: string;
  available: boolean;
  priceUsd?: number;
  premium?: boolean;
  reason?: string;
}

export const TIER_ORDER: RiskTier[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export const TIER_DEFINITION: Record<RiskTier, string> = {
  CRITICAL: "Cited in Google's AI Overview or AI Mode as a source for the brand",
  HIGH: 'Live page with MX records configured, or an app-store listing using the brand',
  MEDIUM: 'Local-pack listing or counterfeit commerce listing',
  LOW: 'Registered and parked, or unregistered — a defensive-registration candidate',
};

export const ENGINES: EngineMeta[] = [
  {
    id: 'google',
    label: 'Google Search',
    purpose: 'Verifies each generated permutation is indexed and live',
  },
  {
    id: 'google_ai_overview',
    label: 'AI Overview',
    purpose: "Whether Google's own AI cites an impersonator as a source for the brand",
    headline: true,
  },
  {
    id: 'google_ai_mode',
    label: 'AI Mode',
    purpose: 'Same check in the conversational surface, across multiple turns',
    headline: true,
  },
  {
    id: 'google_play',
    label: 'Google Play',
    purpose: 'Fake Android apps using the brand name or logo',
  },
  {
    id: 'apple_app_store',
    label: 'App Store',
    purpose: 'The same impersonation on iOS',
  },
  {
    id: 'google_shopping',
    label: 'Shopping',
    purpose: 'Counterfeit listings with structured seller and price data',
  },
  {
    id: 'google_maps',
    label: 'Maps / Local',
    purpose: 'Fake business listings occupying the local pack',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    purpose: 'Impersonation channels — the vector behind most brand-impersonation fraud',
  },
  {
    id: 'google_images',
    label: 'Images / Lens',
    purpose: 'Logo and brand-asset misuse, found by reverse image search',
  },
  {
    id: 'google_trends',
    label: 'Trends',
    purpose: 'Whether search demand for the lookalike is rising — an urgency signal',
  },
];

export const PERMUTATION_TECHNIQUES = [
  { name: 'Homoglyph',     example: 'acrne.com', note: 'Visually confusable characters, incl. Cyrillic' },
  { name: 'Omission',      example: 'acm.com',   note: 'A dropped character' },
  { name: 'Transposition', example: 'acem.com',  note: 'Two adjacent characters swapped' },
  { name: 'Insertion',     example: 'accme.com', note: 'A doubled or inserted character' },
  { name: 'TLD swap',      example: 'acme.co',   note: 'Same label, different top-level domain' },
  { name: 'Hyphenation',   example: 'ac-me.com', note: 'A hyphen inserted into the label' },
  { name: 'Combosquat',    example: 'acme-login.com', note: 'Brand plus a credential-bait keyword' },
];
