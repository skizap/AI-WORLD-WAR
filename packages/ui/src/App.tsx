import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { api, type Meta } from './api';
import { SetupView, type SetupDraft } from './views/SetupView';
import { LiveView } from './views/LiveView';
import { NationView } from './views/NationView';
import { AnalyticsView } from './views/AnalyticsView';
import { ReplayView } from './views/ReplayView';
import type { ActiveNationId } from './atlas/types';

const TABS = ['Setup', 'Live', 'Nations', 'Analytics', 'Replay'] as const;
export type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>('Setup');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [simId, setSimId] = useState<string | null>(null);
  const [selectedNationId, setSelectedNationId] = useState<ActiveNationId | null>(null);
  const [setupDraft, setSetupDraft] = useState<SetupDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabButtons = useRef(new Map<Tab, HTMLButtonElement>());

  useEffect(() => {
    api.meta().then(setMeta).catch((e: Error) => setError(e.message));
  }, []);

  const onCreated = useCallback((id: string) => {
    setSimId(id);
    setTab('Live');
  }, []);
  const onPickSimulation = useCallback((id: string) => setSimId(id), []);
  const openSimulationInLive = useCallback((id: string) => {
    setSimId(id);
    setTab('Live');
  }, []);
  const onViewNation = useCallback((nationId: ActiveNationId) => {
    setSelectedNationId(nationId);
    setTab('Nations');
  }, []);
  // Single owner of the selected nation: Live's atlas, Nations, and any other
  // view share this one piece of state.
  const onSelectNation = useCallback((nationId: string | null | ((current: string | null) => string | null)) => {
    setSelectedNationId((current) =>
      typeof nationId === 'function' ? (nationId(current) as ActiveNationId | null) : (nationId as ActiveNationId | null),
    );
  }, []);
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentTab: Tab) => {
    const currentIndex = TABS.indexOf(currentTab);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = TABS[nextIndex]!;
    setTab(nextTab);
    tabButtons.current.get(nextTab)?.focus();
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1 id="app-title">AI-WORLD-WAR <span aria-hidden="true">·</span> Aurelia Atlas</h1>
        <span className="muted">
          code v{meta?.codeVersion ?? '?'} · prompts v{meta?.promptVersion ?? '?'} · catalog v{meta?.catalogVersion ?? '?'}
        </span>
      </header>
      {/* Canonical persistent fiction notice served by the API (meta.notice). */}
      {meta?.notice && <p className="notice" role="note">{meta.notice}</p>}
      {error && <p className="notice" role="alert">API error: {error}</p>}
      <nav className="tabs" role="tablist" aria-labelledby="app-title" aria-orientation="horizontal">
        {TABS.map((t) => (
          <button
            key={t}
            ref={(node) => { if (node) tabButtons.current.set(t, node); else tabButtons.current.delete(t); }}
            id={`tab-${t.toLowerCase()}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`panel-${t.toLowerCase()}`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={(event) => handleTabKeyDown(event, t)}
          >
            {t}
          </button>
        ))}
      </nav>
      <section
        className="tab-panel"
        role="tabpanel"
        id={`panel-${tab.toLowerCase()}`}
        aria-labelledby={`tab-${tab.toLowerCase()}`}
        tabIndex={0}
      >
        {!meta && !error && <p className="panel muted" role="status">Loading simulation configuration…</p>}
        {meta && tab === 'Setup' && (
          <SetupView meta={meta} draft={setupDraft} onDraftChange={setSetupDraft} onCreated={onCreated} />
        )}
        {tab === 'Live' && <LiveView key={simId ?? 'auto'} simId={simId} onPick={onPickSimulation} onViewNation={onViewNation} />}
        {tab === 'Nations' && (
          <NationView
            simId={simId}
            selectedNationId={selectedNationId}
            onSelectNation={onSelectNation}
          />
        )}
        {tab === 'Analytics' && <AnalyticsView simId={simId} />}
        {tab === 'Replay' && <ReplayView simId={simId} onOpenSimulation={openSimulationInLive} />}
      </section>
      {TABS.filter((inactiveTab) => inactiveTab !== tab).map((inactiveTab) => (
        <section
          key={inactiveTab}
          className="tab-panel"
          role="tabpanel"
          id={`panel-${inactiveTab.toLowerCase()}`}
          aria-labelledby={`tab-${inactiveTab.toLowerCase()}`}
          hidden
        />
      ))}
      <p className="footer-note">
        Nation identities, events, and values are fictional synthetic research parameters. The atlas boundaries are Earth-derived references with fictional aliases; visual links are illustrative and do not show movement or routes. Scores are not risk probabilities or safety certifications.
      </p>
    </div>
  );
}
