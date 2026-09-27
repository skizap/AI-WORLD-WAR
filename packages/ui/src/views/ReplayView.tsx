import { useEffect, useState } from 'react';
import { api, VARIABLE_LABELS } from '../api';

type ReplayData = Awaited<ReturnType<typeof api.replay>>;

type SimulationState =
  | { simId: string; status: 'loading' }
  | { simId: string; status: 'success'; totalTurns: number }
  | { simId: string; status: 'error'; message: string };

type ReplayState =
  | { simId: string; turn: number; status: 'loading' }
  | { simId: string; turn: number; status: 'success'; data: ReplayData }
  | { simId: string; turn: number; status: 'error'; message: string };

type ReRunResult =
  | { status: 'success'; id: string; simId: string; turn: number }
  | { status: 'error'; message: string; simId: string; turn: number };

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function ReplayView({
  simId,
  onOpenSimulation,
}: {
  simId: string | null;
  onOpenSimulation?: (id: string) => void;
}) {
  const [turnSelection, setTurnSelection] = useState<{ simId: string | null; turn: number }>({
    simId: null,
    turn: 1,
  });
  const [simulationState, setSimulationState] = useState<SimulationState | null>(null);
  const [replayState, setReplayState] = useState<ReplayState | null>(null);
  const [simulationRetry, setSimulationRetry] = useState(0);
  const [replayRetry, setReplayRetry] = useState(0);
  const [confirmingReRun, setConfirmingReRun] = useState(false);
  const [creatingReRun, setCreatingReRun] = useState(false);
  const [creatingSource, setCreatingSource] = useState<{ simId: string; turn: number } | null>(null);
  const [reRunResult, setReRunResult] = useState<ReRunResult | null>(null);

  const selectedTurn = turnSelection.simId === simId ? turnSelection.turn : 1;
  const simulation = simulationState && simulationState.simId === simId ? simulationState : null;
  const totalTurns = simulation?.status === 'success' ? Math.max(1, simulation.totalTurns) : 1;
  const turn = Math.min(selectedTurn, totalTurns);
  const replay = replayState && replayState.simId === simId && replayState.turn === turn
    ? replayState
    : null;
  const replayData = replay?.status === 'success' ? replay.data : null;
  const simulationLoading = !!simId && (!simulation || simulation.status === 'loading');
  const replayLoading = !!simId && (!replay || replay.status === 'loading');
  const canScrub = simulation?.status === 'success';

  useEffect(() => {
    if (!simId) {
      setSimulationState(null);
      return;
    }

    let active = true;
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    setSimulationState({ simId, status: 'loading' });
    api
      .getSimulation(simId, controller ? { signal: controller.signal } : undefined)
      .then((simulationDetails) => {
        if (!active) return;
        setSimulationState({
          simId,
          status: 'success',
          totalTurns: Math.max(1, simulationDetails.world.turn),
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSimulationState({
          simId,
          status: 'error',
          message: errorMessage(error, 'Unable to load simulation details.'),
        });
      });

    return () => {
      active = false;
      controller?.abort();
    };
  }, [simId, simulationRetry]);

  useEffect(() => {
    setConfirmingReRun(false);
    setReRunResult(null);

    if (!simId) {
      setReplayState(null);
      return;
    }

    let active = true;
    setReplayState({ simId, turn, status: 'loading' });
    api
      .replay(simId, turn)
      .then((data) => {
        if (!active) return;
        setReplayState({ simId, turn, status: 'success', data });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setReplayState({
          simId,
          turn,
          status: 'error',
          message: errorMessage(error, 'Unable to load this turn replay.'),
        });
      });

    return () => {
      active = false;
    };
  }, [simId, turn, replayRetry]);

  if (!simId) {
    return <p className="muted" role="status">Select or create a simulation to inspect its replay.</p>;
  }

  const before = replayData?.before ?? null;
  const after = replayData?.after ?? null;
  const nationIds = after ? Object.keys(after.nations) : [];
  const actionEvents = replayData?.events.filter((event) => event.type !== 'narrator') ?? [];
  const varNames = Object.keys(VARIABLE_LABELS);

  const delta = (nid: string, v: string): string => {
    const b = (before?.nations[nid]?.variables as Record<string, number> | undefined)?.[v] ?? 0;
    const a = (after?.nations[nid]?.variables as Record<string, number> | undefined)?.[v] ?? 0;
    const d = Math.round((a - b) * 10) / 10;
    return `${Math.round(b * 10) / 10} → ${Math.round(a * 10) / 10} (${d > 0 ? '+' : ''}${d})`;
  };

  const selectTurn = (nextTurn: number) => {
    setTurnSelection({ simId, turn: Math.min(totalTurns, Math.max(1, nextTurn)) });
  };

  const retrySimulation = () => {
    setSimulationState({ simId, status: 'loading' });
    setSimulationRetry((attempt) => attempt + 1);
  };

  const retryReplay = () => {
    setReplayState({ simId, turn, status: 'loading' });
    setReplayRetry((attempt) => attempt + 1);
  };

  const createReRun = async () => {
    if (!replayData || creatingReRun) return;
    const source = { simId, turn };
    setConfirmingReRun(false);
    setCreatingReRun(true);
    setCreatingSource(source);
    setReRunResult(null);
    try {
      const { id } = await api.createSimulation(replayData.reRunConfig);
      setReRunResult({ status: 'success', id, ...source });
    } catch (error: unknown) {
      setReRunResult({
        status: 'error',
        message: errorMessage(error, 'Unable to create a separate simulation.'),
        ...source,
      });
    } finally {
      setCreatingReRun(false);
      setCreatingSource(null);
    }
  };

  return (
    <div className="grid cols-2">
      <section className="panel" style={{ gridColumn: '1 / -1' }} aria-labelledby="replay-scrubber-heading">
        <h2 id="replay-scrubber-heading">Replay scrubber</h2>
        <label htmlFor="replay-turn">Turn: {turn}</label>
        <input
          id="replay-turn"
          type="range"
          min={1}
          max={totalTurns}
          value={turn}
          onChange={(event) => selectTurn(Number(event.target.value))}
          disabled={!canScrub}
          style={{ width: '100%' }}
        />
        <div className="fieldrow">
          <button type="button" onClick={() => selectTurn(turn - 1)} disabled={!canScrub || turn <= 1} aria-label="Previous turn">◀ Prev</button>
          <button type="button" onClick={() => selectTurn(turn + 1)} disabled={!canScrub || turn >= totalTurns} aria-label="Next turn">Next ▶</button>
          <button
            type="button"
            onClick={() => {
              setReRunResult(null);
              setConfirmingReRun(true);
            }}
            disabled={!replayData || creatingReRun}
          >
            Re-run from seed
          </button>
          <span className="muted">same seed + config ⇒ identical replay (mock mode)</span>
        </div>

        {simulationLoading && <p className="muted" role="status" aria-busy="true">Loading simulation details…</p>}
        {simulation?.status === 'error' && (
          <div>
            <p role="alert" className="notice">Unable to load simulation details: {simulation.message}</p>
            <button type="button" onClick={retrySimulation}>Retry simulation details</button>
          </div>
        )}

        {confirmingReRun && replayData && (
          <div className="notice" role="group" aria-labelledby="replay-rerun-confirmation">
            <p id="replay-rerun-confirmation">Create a separate simulation from the seed and configuration saved with this replay?</p>
            <p className="muted">The current simulation will not be changed.</p>
            <div className="fieldrow">
              <button type="button" onClick={createReRun} disabled={creatingReRun}>Create separate simulation</button>
              <button type="button" onClick={() => setConfirmingReRun(false)} disabled={creatingReRun}>Cancel</button>
            </div>
          </div>
        )}
        {creatingReRun && creatingSource && (
          <p className="muted" role="status" aria-busy="true">
            Creating a separate simulation from {creatingSource.simId}, turn {creatingSource.turn}…
          </p>
        )}
        {reRunResult?.status === 'success' && (
          <div className="notice" role="status">
            <p>Separate simulation <code>{reRunResult.id}</code> created from {reRunResult.simId}, turn {reRunResult.turn}.</p>
            {onOpenSimulation && (
              <button type="button" onClick={() => onOpenSimulation(reRunResult.id)}>Open in Live</button>
            )}
          </div>
        )}
        {reRunResult?.status === 'error' && (
          <p role="alert" className="notice">
            Could not create a separate simulation from {reRunResult.simId}, turn {reRunResult.turn}: {reRunResult.message}
          </p>
        )}
      </section>

      {replayLoading && <p className="muted" role="status" aria-busy="true">Loading replay for turn {turn}…</p>}
      {replay?.status === 'error' && (
        <div>
          <p role="alert" className="notice">Unable to load replay for turn {turn}: {replay.message}</p>
          <button type="button" onClick={retryReplay}>Retry replay</button>
        </div>
      )}

      {replayData && (
        <>
          <section className="panel">
            <h2>Before / after state comparison (turn {turn})</h2>
            <table className="table">
              <thead><tr><th>Nation</th><th>Variable</th><th>Before → After (Δ)</th></tr></thead>
              <tbody>
                {nationIds.length === 0 ? (
                  <tr><td colSpan={3} className="muted">No nation state is available for this turn.</td></tr>
                ) : nationIds.flatMap((nid) =>
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
              {actionEvents.length === 0 ? (
                <p className="muted" role="status">No action-resolution events for this turn.</p>
              ) : actionEvents.map((event) => (
                <div key={event.id} className={`event ${event.status}`}>
                  <span className="badge info">{event.actorId ?? 'world'}</span>{' '}
                  {event.status === 'rejected' ? `REJECTED ${event.actionId} — ${event.reason}` : `${event.actionId ?? event.type}${event.targetId ? ` → ${event.targetId}` : ''}`}
                </div>
              ))}
            </div>
            <h3>Narrator summary</h3>
            <p className="muted">{replayData.narrator?.summary ?? '(no narrator summary for this turn)'}</p>
          </section>
        </>
      )}
    </div>
  );
}
