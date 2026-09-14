import { useEffect, useMemo, useState } from 'react';
import type { WorldState } from '@aiww/schemas';
import { api, VARIABLE_LABELS } from '../api';

export function LiveView({ simId, onPick }: { simId: string | null; onPick: (id: string) => void }) {
  const [sims, setSims] = useState<{ id: string; status: string; turn: number; totalTurns: number; scenarioId: string }[]>([]);
  const [world, setWorld] = useState<WorldState | null>(null);
  const [status, setStatus] = useState<string>('');
  const [phase, setPhase] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const refresh = async (id: string | null) => {
    try {
      const list = await api.listSimulations();
      setSims(list);
      const active = id ?? list[0]?.id ?? null;
      if (active && active !== simId) onPick(active);
      if (active) {
        const s = await api.getSimulation(active);
        setWorld(s.world);
        setStatus(s.status);
        setPhase(s.phase);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void refresh(simId);
    const t = setInterval(() => void refresh(simId), 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simId]);

  const control = async (action: 'start' | 'pause' | 'resume' | 'stop' | 'step') => {
    if (!simId) return;
    try {
      await api.control(simId, action);
      await refresh(simId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const nations = useMemo(() => Object.values(world?.nations ?? {}), [world]);
  const recentEvents = (world?.events ?? []).slice(-40).reverse();
  const pending = (world?.pendingApprovals ?? []).filter((p) => p.status === 'pending');
  const turn = world?.turn ?? 0;
  const total = world?.totalTurns ?? 1;

  return (
    <div className="grid cols-2">
      <section className="panel" style={{ gridColumn: '1 / -1' }} aria-labelledby="live-controls">
        <h2 id="live-controls">Live simulation controls</h2>
        <div className="fieldrow">
          <label>
            Simulation
            <select value={simId ?? ''} onChange={(e) => onPick(e.target.value)} aria-label="Select simulation">
              {sims.map((s) => (
                <option key={s.id} value={s.id}>{s.id} · {s.status} · t{s.turn}/{s.totalTurns}</option>
              ))}
            </select>
          </label>
          <button onClick={() => control('start')} disabled={!simId}>Start</button>
          <button onClick={() => control('pause')} disabled={!simId}>Pause</button>
          <button onClick={() => control('resume')} disabled={!simId}>Resume</button>
          <button onClick={() => control('step')} disabled={!simId}>Step</button>
          <button onClick={() => control('stop')} disabled={!simId}>Stop</button>
          <span className="muted" aria-live="polite">status: {status || '—'} · phase: {phase || '—'}</span>
        </div>
        <div className="progress" role="progressbar" aria-valuenow={turn} aria-valuemin={0} aria-valuemax={total} aria-label="Simulation progress">
          <div style={{ width: `${total > 0 ? (turn / total) * 100 : 0}%` }} />
        </div>
        <p className="muted">Turn {turn} of {total} · scenario: {world?.scenarioId ?? '—'} · seed: {world?.seed ?? '—'}</p>
        {error && <p role="alert" className="notice">{error}</p>}
      </section>

      <section className="panel" aria-labelledby="pending-approvals">
        <h2 id="pending-approvals">Pending approvals ({pending.length})</h2>
        {pending.length === 0 && <p className="muted">No severe actions awaiting human approval.</p>}
        {pending.map((p) => (
          <div className="approval" key={p.key}>
            <strong>{p.nationId}</strong> proposes <strong>{p.actionId}</strong>
            {p.targetId ? ` against ${p.targetId}` : ''}{' '}
            <span className="badge severe">{p.severity.replace(/_/g, ' ')}</span>
            {p.message && <p className="muted">“{p.message}”</p>}
            <button onClick={async () => { await api.approve(simId!, p.key, true); void refresh(simId); }}>Approve</button>{' '}
            <button onClick={async () => { await api.approve(simId!, p.key, false); void refresh(simId); }}>Reject</button>
          </div>
        ))}
      </section>

      <section className="panel" aria-labelledby="event-feed">
        <h2 id="event-feed">Event feed</h2>
        <div className="eventfeed">
          {recentEvents.map((e) => (
            <div key={e.id} className={`event ${e.status} ${e.type}`}>
              <span className="badge info">t{e.turn}</span>{' '}
              {e.type === 'narrator' ? `Narrator: ${e.message}` : `${e.actorId ?? 'world'} ${e.status === 'rejected' ? `was rejected: ${e.actionId} (${e.reason ?? ''})` : `${e.actionId ?? e.type}${e.targetId ? ` → ${e.targetId}` : ''}`}`}
              {(e.severity === 'violent_escalation' || e.severity === 'nuclear_escalation') && e.status === 'accepted' && (
                <span className="badge severe"> severe fictional event: {e.severity.replace(/_/g, ' ')}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="panel" style={{ gridColumn: '1 / -1' }} aria-labelledby="nation-cards">
        <h2 id="nation-cards">Fictional nations</h2>
        <div className="grid cols-3">
          {nations.map((n) => (
            <div className="panel" key={n.id} style={{ background: 'var(--panel-2)' }}>
              <h3 style={{ color: 'var(--text)' }}>{n.id}</h3>
              {(['militaryCapacity', 'gdp', 'trade', 'politicalStability', 'population', 'nuclearCapability'] as const).map((k) => {
                const v = n.variables[k] ?? 0;
                const max = k === 'nuclearCapability' ? 10 : 100;
                return (
                  <div className="varbar" key={k}>
                    <span>{VARIABLE_LABELS[k]}</span>
                    <span className="bar"><div style={{ width: `${(v / max) * 100}%` }} /></span>
                    <span>{Math.round(v * 10) / 10}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
