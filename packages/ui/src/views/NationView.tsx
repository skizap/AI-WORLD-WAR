import { useEffect, useState } from 'react';
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { api, VARIABLE_LABELS } from '../api';

type NationData = Awaited<ReturnType<typeof api.nation>>;

export function NationView({ simId }: { simId: string | null }) {
  const [nations, setNations] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [data, setData] = useState<NationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!simId) return;
    api
      .getSimulation(simId)
      .then((s) => {
        const ids = Object.keys(s.world.nations);
        setNations(ids);
        setSelected((cur) => cur ?? ids[0] ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, [simId]);

  useEffect(() => {
    if (!simId || !selected) return;
    api.nation(simId, selected).then(setData).catch((e: Error) => setError(e.message));
  }, [simId, selected]);

  if (!simId) return <p className="muted">Create a simulation first.</p>;

  const chartData = (data?.history ?? []).map((h) => ({
    turn: h.turn,
    ...h.variables,
  }));

  return (
    <div className="grid cols-2">
      <section className="panel">
        <h2>Nation detail</h2>
        <div className="fieldrow">
          <label>
            Nation
            <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)} aria-label="Select nation">
              {nations.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        {error && <p role="alert" className="notice">{error}</p>}
        {data && (
          <>
            <h3>{data.profile.name} — fictional profile</h3>
            <p className="muted">{data.profile.description}</p>
            <p className="muted">{data.profile.background}</p>
            <p>
              <span className="badge info">{data.profile.governanceType}</span>
              <span className="badge info">{data.profile.strategicOrientation}</span>
              <span className="badge">aggression {data.profile.aggression}/10</span>
              <span className="badge">force {data.profile.willingnessToUseForce}/10</span>
            </p>
            <h3>Stated goals (fictional)</h3>
            <ul>{data.profile.initialGoals.map((g) => <li key={g}>{g}</li>)}</ul>
          </>
        )}
      </section>

      <section className="panel">
        <h2>Variables over time (synthetic)</h2>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
              <CartesianGrid stroke="#33405c" />
              <XAxis dataKey="turn" stroke="#9aa7bd" />
              <YAxis stroke="#9aa7bd" />
              <Tooltip contentStyle={{ background: '#1a2233', border: '1px solid #33405c' }} />
              <Legend />
              {['militaryCapacity', 'gdp', 'trade', 'politicalStability', 'softPower'].map((k) => (
                <Line key={k} type="monotone" dataKey={k} name={VARIABLE_LABELS[k]} dot={false} stroke={[
                  '#4da3ff', '#4fd28a', '#ffcc66', '#ff7a7a', '#d78cff'][
                  ['militaryCapacity', 'gdp', 'trade', 'politicalStability', 'softPower'].indexOf(k)]} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel" style={{ gridColumn: '1 / -1' }}>
        <h2>Action history (accepted &amp; rejected)</h2>
        <div className="eventfeed">
          {(data?.actions ?? []).slice().reverse().map((e) => (
            <div key={e.id} className={`event ${e.status}`}>
              <span className="badge info">t{e.turn}</span>{' '}
              {e.status === 'rejected' ? `${e.actionId} rejected — ${e.reason}` : `${e.actionId}${e.targetId ? ` → ${e.targetId}` : ''}`}
              {e.details && <span className="muted"> · “{e.details}”</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
