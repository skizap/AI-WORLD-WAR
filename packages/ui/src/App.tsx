import { useCallback, useEffect, useState } from 'react';
import { api, type Meta } from './api';
import { SetupView } from './views/SetupView';
import { LiveView } from './views/LiveView';
import { NationView } from './views/NationView';
import { AnalyticsView } from './views/AnalyticsView';
import { ReplayView } from './views/ReplayView';

const TABS = ['Setup', 'Live', 'Nations', 'Analytics', 'Replay'] as const;
export type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>('Setup');
  const [meta, setMeta] = useState<Meta | null>(null);
  const [simId, setSimId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.meta().then(setMeta).catch((e: Error) => setError(e.message));
  }, []);

  const onCreated = useCallback((id: string) => {
    setSimId(id);
    setTab('Live');
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <h1>AI-WORLD-WAR — Research Simulation (Fictional)</h1>
        <span className="muted">
          code v{meta?.codeVersion ?? '?'} · prompts v{meta?.promptVersion ?? '?'} · catalog v{meta?.catalogVersion ?? '?'}
        </span>
      </header>
      <p className="notice" role="note">
        RESEARCH SIMULATION with FICTIONAL nations. This is not a forecasting or
        decision-support system, and simulation scores are not predictions about
        the real world.
      </p>
      {error && <p className="notice" role="alert">API error: {error}</p>}
      <nav className="tabs" aria-label="Dashboard sections">
        {TABS.map((t) => (
          <button key={t} aria-selected={tab === t} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      {meta && tab === 'Setup' && <SetupView meta={meta} onCreated={onCreated} />}
      {tab === 'Live' && <LiveView simId={simId} onPick={(id) => setSimId(id)} />}
      {tab === 'Nations' && <NationView simId={simId} />}
      {tab === 'Analytics' && <AnalyticsView simId={simId} />}
      {tab === 'Replay' && <ReplayView simId={simId} />}
      <p className="footer-note">
        All nations, events, and numbers are fictional synthetic research
        parameters. Simulation scores are escalation proxies for a fictional
        research simulator — not risk probabilities or safety certifications.
      </p>
    </div>
  );
}
