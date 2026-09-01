'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import SmoothScroll, { useSmoothScroll } from '@/components/SmoothScroll';
import WebGLCanvas from '@/components/webgl/WebGLCanvas';
import CustomCursor from '@/components/CustomCursor';
import IntroLoader from '@/components/IntroLoader';
import AuthScreen from '@/components/AuthScreen';
import AppShell, { type ViewKey } from '@/components/AppShell';
import NoticePanel from '@/components/NoticePanel';
import HowItWorksDrawer from '@/components/HowItWorksDrawer';
import RegisterDrawer from '@/components/RegisterDrawer';

import OverviewView from '@/components/views/OverviewView';
import SweepView from '@/components/views/SweepView';
import FindingsView from '@/components/views/FindingsView';
import NoticesView from '@/components/views/NoticesView';
import DomainsView from '@/components/views/DomainsView';
import SurfacesView from '@/components/views/SurfacesView';
import MethodView from '@/components/views/MethodView';
import SettingsView from '@/components/views/SettingsView';

import {
  startScan,
  getScan,
  listScans,
  generateNotice,
  approveNotice,
  signNotice,
  emptyScan,
  getOverview,
  getWorkspaceFindings,
  getNotices,
  getDomains,
  getSurfaces,
  getIntegrations,
  getBudget,
} from '@/lib/api';
import type {
  ActivityEvent,
  Integration,
  NoticeRecord,
  PortfolioDomain,
  SurfaceStat,
  TrendPoint,
  WorkspaceStats,
} from '@/lib/workspace';
import {
  type Finding,
  type Notice,
  type RiskTier,
  type Scan,
  type ScanBudget,
  type ScanSummary,
} from '@/lib/types';
import { readSession, signOut, type Session } from '@/lib/session';

const POLL_MS = 500;

/** Everything the workspace views render. One fetch pass fills all of it. */
interface WorkspaceData {
  stats: WorkspaceStats;
  trend: TrendPoint[];
  activity: ActivityEvent[];
  findings: Finding[];
  notices: NoticeRecord[];
  domains: PortfolioDomain[];
  surfaces: SurfaceStat[];
  integrations: Integration[];
  budget: ScanBudget;
}

const EMPTY_WORKSPACE: WorkspaceData = {
  stats: { openCriticals: 0, hostileDomains: 0, noticesInFlight: 0 },
  trend: [],
  activity: [],
  findings: [],
  notices: [],
  domains: [],
  surfaces: [],
  integrations: [],
  budget: { total: 0, spent: 0, cacheHits: 0 },
};

function ScanApp() {
  const { velocity } = useSmoothScroll();

  // Shell: hold-to-enter → auth → application
  const [entered, setEntered] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [view, setView] = useState<ViewKey>('overview');

  const [scan, setScan] = useState<Scan>(emptyScan());
  const [history, setHistory] = useState<ScanSummary[]>([]);
  const [workspace, setWorkspace] = useState<WorkspaceData>(EMPTY_WORKSPACE);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [registerTarget, setRegisterTarget] = useState<string | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const [filter, setFilter] = useState<RiskTier | 'ALL'>('ALL');
  const [busy, setBusy] = useState(false);
  const [noticeBusy, setNoticeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  // A returning user skips the hold gate — it's the first-visit moment, not a toll
  // booth on every reload. The cookie is resolved by the API, not read locally.
  useEffect(() => {
    let cancelled = false;
    readSession()
      .then((existing) => {
        if (cancelled) return;
        setSession(existing);
        if (existing) setEntered(true);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSessionChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Reloads every workspace aggregate. Called on sign-in and after anything lands. */
  const refreshWorkspace = useCallback(async () => {
    try {
      const [overview, findings, notices, domains, surfaces, integrations, budget] =
        await Promise.all([
          getOverview(),
          getWorkspaceFindings(),
          getNotices(),
          getDomains(),
          getSurfaces(),
          getIntegrations(),
          getBudget(),
        ]);
      setWorkspace({
        stats: overview.stats,
        trend: overview.trend,
        activity: overview.activity,
        findings,
        notices,
        domains,
        surfaces,
        integrations,
        budget,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load workspace data');
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    listScans().then(setHistory).catch(() => {});
    void refreshWorkspace();
  }, [session, refreshWorkspace]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
    } catch {
      /* the cookie may already be gone — clear the UI either way */
    }
    setSession(null);
    setScan(emptyScan());
    setNotice(null);
    setHistory([]);
    setWorkspace(EMPTY_WORKSPACE);
    setError(null);
    setView('overview');
    stopPolling();
  }, [stopPolling]);

  const handleScan = useCallback(
    async (brand: string, domain: string) => {
      setError(null);
      setBusy(true);
      setFilter('ALL');
      setScan({ ...emptyScan(brand, domain), state: 'generating' });

      try {
        const { id } = await startScan(brand, domain);
        stopPolling();

        const tick = async () => {
          try {
            const next = await getScan(id);
            setScan(next);
            if (next.state === 'complete' || next.state === 'error') {
              stopPolling();
              setBusy(false);
              if (next.state === 'error') {
                setError(next.error ?? 'Scan failed');
              } else {
                listScans().then(setHistory).catch(() => {});
                void refreshWorkspace();
              }
            }
          } catch (e) {
            stopPolling();
            setBusy(false);
            setError(e instanceof Error ? e.message : 'Scan failed');
          }
        };

        await tick();
        if (pollRef.current === null) pollRef.current = setInterval(tick, POLL_MS);
      } catch (e) {
        setBusy(false);
        // api.ts already names the unreachable base URL, so don't append it again.
        setError(e instanceof Error ? e.message : 'Scan failed');
        setScan((s) => ({ ...s, state: 'error' }));
      }
    },
    [stopPolling, refreshWorkspace],
  );

  const handleDraftNotice = useCallback(
    async (findingId: string) => {
      setNoticeBusy(true);
      try {
        setNotice(await generateNotice(scan.id, findingId));
        void refreshWorkspace();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not draft notice');
      } finally {
        setNoticeBusy(false);
      }
    },
    [scan.id, refreshWorkspace],
  );

  const handleApprove = useCallback(async (noticeId: string) => {
    setNoticeBusy(true);
    try {
      setNotice(await approveNotice(noticeId));
      void refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not approve notice');
    } finally {
      setNoticeBusy(false);
    }
  }, [refreshWorkspace]);

  const handleSign = useCallback(async (noticeId: string) => {
    setNoticeBusy(true);
    try {
      setNotice(await signNotice(noticeId));
      void refreshWorkspace();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not route for signature');
    } finally {
      setNoticeBusy(false);
    }
  }, [refreshWorkspace]);

  // ── Stage 1: hold to enter ───────────────────────────────────────────────
  if (!entered || !sessionChecked) {
    return (
      <main className="relative min-h-screen">
        <WebGLCanvas scrollVelocity={velocity} />
        <CustomCursor />
        <IntroLoader onComplete={() => setEntered(true)} />
      </main>
    );
  }

  // ── Stage 2: auth ────────────────────────────────────────────────────────
  if (!session) {
    return (
      <>
        <WebGLCanvas scrollVelocity={velocity} />
        <CustomCursor />
        <AuthScreen onAuthed={setSession} />
      </>
    );
  }

  // ── Stage 3: application ─────────────────────────────────────────────────
  const openNotices = workspace.notices.filter((n) => n.stage !== 'resolved').length;
  const openFindings = workspace.findings.length;
  const availableDomains = workspace.domains.filter((d) => d.status === 'available').length;

  return (
    <>
      <WebGLCanvas scrollVelocity={velocity} />
      <CustomCursor />

      <AppShell
        view={view}
        onNavigate={setView}
        session={session}
        budget={workspace.budget}
        onSignOut={handleSignOut}
        counts={{ findings: openFindings, notices: openNotices, domains: availableDomains }}
      >
        {error && (
          <div className="mb-10 border border-red-300 bg-red-50 rounded-md px-4 py-3">
            <p className="font-mono text-[12px] leading-relaxed text-red-700">{error}</p>
          </div>
        )}

        {view === 'overview' && (
          <OverviewView
            budget={workspace.budget}
            stats={workspace.stats}
            trend={workspace.trend}
            activity={workspace.activity}
            notices={workspace.notices}
            domains={workspace.domains}
            onNavigate={setView}
          />
        )}

        {view === 'sweep' && (
          <SweepView
            scan={scan}
            history={history}
            busy={busy}
            noticeBusy={noticeBusy}
            isMock={scan.isMock ?? false}
            organisation={session.organisation}
            filter={filter}
            onFilter={setFilter}
            onScan={handleScan}
            onDraftNotice={handleDraftNotice}
            onRegister={setRegisterTarget}
          />
        )}

        {view === 'findings' && (
          <FindingsView findings={workspace.findings} onNavigate={setView} />
        )}
        {view === 'notices' && <NoticesView notices={workspace.notices} />}
        {view === 'domains' && (
          <DomainsView domains={workspace.domains} onRegister={setRegisterTarget} />
        )}
        {view === 'surfaces' && <SurfacesView surfaces={workspace.surfaces} />}
        {view === 'method' && <MethodView />}
        {view === 'settings' && (
          <SettingsView
            session={session}
            integrations={workspace.integrations}
            budget={workspace.budget}
            onSignOut={handleSignOut}
          />
        )}
      </AppShell>

      <NoticePanel
        notice={notice}
        onApprove={handleApprove}
        onSign={handleSign}
        onClose={() => setNotice(null)}
        busy={noticeBusy}
      />
      <RegisterDrawer domain={registerTarget} onClose={() => setRegisterTarget(null)} />
      <HowItWorksDrawer isOpen={howOpen} onClose={() => setHowOpen(false)} />
    </>
  );
}

export default function Page() {
  return (
    <SmoothScroll>
      <ScanApp />
    </SmoothScroll>
  );
}
