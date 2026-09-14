import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api, SEVERITY_COLOR, SEVERITY_TEXT, VARIABLE_LABELS } from '../api';
import type { RunMetrics } from '@aiww/schemas';

export function AnalyticsView({ simId }: { simId: string | null }) {
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!simId) return;
    const load = () => api.metrics(simId).then(setMetrics).catch((e: Error) => setError(e.message));
    load();
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [simId]);

  if (!simId) return <p className="muted">Create a simulation first.</p>;
  if (error) return <p role="alert" className="notice">{error}</p>;
  if (!metrics || metrics.turns.length === 0) return <p className="muted">No metrics yet — start the simulation.</p>;

  const escalationData = metrics.turns.map((t) => ({ turn: t.turn, meanScore: t.meanScore }));
  const severityData = metrics.turns.map((t) => ({
    turn: t.turn,
    De_escalation: t.severityCounts['de_escalation'] ?? 0,
    Status_quo: t.severityCounts['status_quo'] ?? 0,
    Posturing: t.severityCounts['posturing'] ?? 0,
    Non_violent: t.severityCounts['non_violent_escalation'] ?? 0,
    Violent: t.severityCounts['violent_escalation'] ?? 0,
    Nuclear: t.severityCounts['nuclear_escalation'] ?? 0,
  }));
  const nationIds = Object.keys(metrics.turns[0]?.perNation ?? {});
  const cumulativeData = metrics.turns.map((t) => {
    const row: Record<string, number | number> = { turn: t.turn };
    for (const n of nationIds) row[n] = Math.round(t.perNation[n]?.cumulative ?? 0);
    return row;
  });
  const palette = ['#4da3ff', '#4fd28a', '#ffcc66', '#ff7a7a', '#d78cff', '#7de0e6', '#f78fb3', '#a0e57c'];
  const stabilityData = metrics.turns.map((t) => ({ turn: t.turn, globalStability: t.globalStability }));

  return (
    <div className="grid cols-2">
      <section className="panel">
        <h2>Mean escalation score per turn (simulation score)</h2>
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={escalationData}>
              <CartesianGrid stroke="#33405c" />
              <XAxis dataKey="turn" stroke="#9aa7bd" />
              <YAxis stroke="#9aa7bd" />
              <Tooltip contentStyle={{ background: '#1a2233', border: '1px solid #33405c' }} />
              <Line type="monotone" dataKey="meanScore" stroke="#4da3ff" dot={false} name="Mean simulation score" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <h2>Severity counts per turn (text labels + color)</h2>
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={severityData}>
              <CartesianGrid stroke="#33405c" />
              <XAxis dataKey="turn" stroke="#9aa7bd" />
              <YAxis stroke="#9aa7bd" />
              <Tooltip contentStyle={{ background: '#1a2233', border: '1px solid #33405c' }} />
              <Legend />
              <Bar dataKey="De_escalation" stackId="s" fill={SEVERITY_COLOR['de_escalation']} name={SEVERITY_TEXT['de_escalation']} />
              <Bar dataKey="Status_quo" stackId="s" fill="#55627d" name={SEVERITY_TEXT['status_quo']} />
              <Bar dataKey="Posturing" stackId="s" fill={SEVERITY_COLOR['posturing']} name={SEVERITY_TEXT['posturing']} />
              <Bar dataKey="Non_violent" stackId="s" fill={SEVERITY_COLOR['non_violent_escalation']} name={SEVERITY_TEXT['non_violent_escalation']} />
              <Bar dataKey="Violent" stackId="s" fill={SEVERITY_COLOR['violent_escalation']} name={SEVERITY_TEXT['violent_escalation']} />
              <Bar dataKey="Nuclear" stackId="s" fill={SEVERITY_COLOR['nuclear_escalation']} name={SEVERITY_TEXT['nuclear_escalation']} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <h2>Cumulative simulation score by nation</h2>
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={cumulativeData}>
              <CartesianGrid stroke="#33405c" />
              <XAxis dataKey="turn" stroke="#9aa7bd" />
              <YAxis stroke="#9aa7bd" />
              <Tooltip contentStyle={{ background: '#1a2233', border: '1px solid #33405c' }} />
              <Legend />
              {nationIds.map((n, i) => (
                <Line key={n} type="monotone" dataKey={n} stroke={palette[i % palette.length]} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <h2>Global fictional stability</h2>
        <div style={{ height: 280 }}>
          <ResponsiveContainer>
            <LineChart data={stabilityData}>
              <CartesianGrid stroke="#33405c" />
              <XAxis dataKey="turn" stroke="#9aa7bd" />
              <YAxis stroke="#9aa7bd" />
              <Tooltip contentStyle={{ background: '#1a2233', border: '1px solid #33405c' }} />
              <Line type="monotone" dataKey="globalStability" stroke="#4fd28a" dot={false} name="Global stability (synthetic)" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <h2>One-turn spike table (largest jumps)</h2>
        <table className="table">
          <thead><tr><th>Nation</th><th>Turn</th><th>Spike (score delta)</th></tr></thead>
          <tbody>
            {metrics.spikes.slice(0, 8).map((s, i) => (
              <tr key={i}><td>{s.nationId}</td><td>{s.turn}</td><td>+{s.spike}</td></tr>
            ))}
          </tbody>
        </table>
        <h3>Run totals (descriptive only)</h3>
        <p className="muted">
          violent actions: {metrics.totals.violentActionCount} · nuclear: {metrics.totals.nuclearActionCount} · de-escalation:{' '}
          {metrics.totals.deEscalationCount} · rejected: {metrics.rejectedActionCount} · alliances formed: {metrics.allianceFormation}
        </p>
      </section>

      <section className="panel">
        <h2>Exports</h2>
        <p className="muted">Download the full validated event stream, snapshots, and metrics.</p>
        <a href={`/api/simulations/${simId}/export?format=csv`} download><button type="button">Export CSV</button></a>{' '}
        <a href={`/api/simulations/${simId}/export`} download><button type="button">Export JSON</button></a>
        <h3>Resource label reference</h3>
        <ul className="muted">
          {Object.entries(VARIABLE_LABELS).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
        </ul>
      </section>
    </div>
  );
}
