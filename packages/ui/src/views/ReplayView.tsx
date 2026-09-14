import { useEffect, useState } from 'react';
import type { WorldState } from '@aiww/schemas';
import { api, VARIABLE_LABELS } from '../api';

type ReplayData = Awaited<ReturnType<typeof api.replay>>;

export function ReplayView({ simId }: { simId: string | null }) {
  const [turn, setTurn] = useState(1);
  const [totalTurns, setTotalTurns] = useState(14);
  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!simId) return;
    api
      .getSimulation(simId)
      .then((s) => setTotalTurns(Math.max(1, s.world.turn)))
      .catch((e: Error) => setError(e.message));
  }, [simId]);

  useEffect(() => {
    if (!simId) return;
    api
      .replay(simId, turn)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [simId, turn]);

  if (!simId) return <p className="muted">Create a simulation first.</p>;

  const before = data?.before ?? null;
  const after = data?.after ?? null;
  const varNames = Object.keys(VARIABLE_LABELS);

  const delta = (nid: string, v: string): string => {
    const b = (before?.nations[nid]?.variables as Record<string, number> | undefined)?.[v] ?? 0;
    const a = (after?.nations[nid]?.variables as Record<string, number> | undefined)?.[v] ?? 0;
    const d = Math.round((a - b) * 10) / 10;
    return `${Math.round(b * 10) / 10} → ${Math.round(a * 10) / 10} (${d > 0 ? '+' : ''}${d})`;
  };

  const reRun = async () => {
    if (!data) return;
    try {
      const { id } = await api.createSimulation(data.reRunConfig);
      alert(`Deterministic re-run created: ${id}. Same seed + config reproduces the run.`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="grid cols-2">
      <section className="panel" style={{ gridColumn: '1 / -1' }}>
        <h2>Replay scrubber</h2>
        <label htmlFor="replay-turn">Turn: {turn}</label>
        <input
          id="replay-turn"
          type="range"
          min={1}
          max={Math.max(1, totalTurns)}
          value={turn}
          onChange={(e) => setTurn(Number(e.target.value))}
          style={{ width: '100%' }}
        />
        <div className="fieldrow">
          <button onClick={() => setTurn(Math.max(1, turn - 1))} aria-label="Previous turn">◀ Prev</button>
          <button onClick={() => setTurn(Math.min(totalTurns, turn + 1))} aria-label="Next turn">Next ▶</button>
          <button onClick={reRun} disabled={!data}>Re-run from seed</button>
          <span className="muted">same seed + config ⇒ identical replay (mock mode)</span>
        </div>
        {error && <p role="alert" className="notice">{error}</p>}
      </section>

      <section className="panel">
        <h2>Before / after state comparison (turn {turn})</h2>
        <table className="table">
          <thead><tr><th>Nation</th><th>Variable</th><th>Before → After (Δ)</th></tr></thead>
          <tbody>
            {(after ? Object.keys(after.nations) : []).flatMap((nid) =>
              varNames.slice(0, 5).map((v) => (
                <tr key={`${nid}:${v}`}>
                  <td>{nid}</td>
                  <td>{VARIABLE_LABELS[v]}</td>
                  <td>{delta(nid, v)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Action-resolution trace</h2>
        <div className="eventfeed">
          {(data?.events ?? []).filter((e) => e.type !== 'narrator').map((e) => (
            <div key={e.id} className={`event ${e.status}`}>
              <span className="badge info">{e.actorId ?? 'world'}</span>{' '}
              {e.status === 'rejected' ? `REJECTED ${e.actionId} — ${e.reason}` : `${e.actionId ?? e.type}${e.targetId ? ` → ${e.targetId}` : ''}`}
            </div>
          ))}
        </div>
        <h3>Narrator summary</h3>
        <p className="muted">{data?.narrator?.summary ?? '(no narrator summary for this turn)'}</p>
      </section>
    </div>
  );
}
