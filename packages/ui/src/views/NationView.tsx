import { useEffect, useRef, useState } from 'react';
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { api, VARIABLE_LABELS } from '../api';

type NationData = Awaited<ReturnType<typeof api.nation>>;
type SimulationViewState = {
  simId: string;
  nations: string[];
  loading: boolean;
  error: string | null;
};
type NationDetailState = {
  simId: string;
  nationId: string;
  data: NationData | null;
  loading: boolean;
  error: string | null;
};

export function NationView({ simId, initialNationId = null }: { simId: string | null; initialNationId?: string | null }) {
  const [simulationState, setSimulationState] = useState<SimulationViewState | null>(null);
  const [selected, setSelected] = useState<string | null>(initialNationId);
  const [detailState, setDetailState] = useState<NationDetailState | null>(null);
  const simulationStatus = useRef<string | null>(null);
  const nationRequestId = useRef(0);
  const nationPollInterval = useRef<number | null>(null);

  const currentSimulation = simulationState?.simId === simId ? simulationState : null;
  const nations = currentSimulation?.nations ?? [];
  const simulationReady = currentSimulation !== null && !currentSimulation.loading;
  const simulationLoading = Boolean(simId && !simulationReady);
  const selectedAvailable = Boolean(selected && nations.includes(selected));
  const currentDetail = detailState?.simId === simId && detailState.nationId === selected ? detailState : null;
  const data = currentDetail?.data ?? null;
  const detailLoading = selectedAvailable && (!currentDetail || currentDetail.loading);

  useEffect(() => {
    setSelected(initialNationId);
    setDetailState(null);
    setSimulationState(simId ? { simId, nations: [], loading: true, error: null } : null);
    simulationStatus.current = null;
    nationRequestId.current += 1;

    if (!simId) return;

    let active = true;
    let inFlight = false;
    let initialized = false;
    let controller: AbortController | null = null;
    let intervalId: number | null = null;

    const refreshSimulation = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      const requestController = new AbortController();
      controller = requestController;

      try {
        const snapshot = await api.getSimulation(simId, { signal: requestController.signal });
        if (!active) return;

        simulationStatus.current = snapshot.status;
        if (!initialized) {
          initialized = true;
          const ids = Object.keys(snapshot.world.nations);
          setSimulationState({ simId, nations: ids, loading: false, error: null });
          setSelected((current) => current && ids.includes(current) ? current : ids[0] ?? null);
        } else {
          setSimulationState((current) => current?.simId === simId && (current.loading || current.error !== null)
            ? { ...current, loading: false, error: null }
            : current);
        }

        if (snapshot.status !== 'idle' && snapshot.status !== 'running') {
          if (intervalId !== null) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
          if (nationPollInterval.current !== null) {
            window.clearInterval(nationPollInterval.current);
            nationPollInterval.current = null;
          }
        }
      } catch (e) {
        if (!active || requestController.signal.aborted) return;
        const message = e instanceof Error ? e.message : String(e);
        setSimulationState((current) => current?.simId === simId
          ? { ...current, loading: false, error: message }
          : { simId, nations: [], loading: false, error: message });
      } finally {
        if (controller === requestController) controller = null;
        inFlight = false;
      }
    };

    intervalId = window.setInterval(() => void refreshSimulation(), 2500);
    void refreshSimulation();

    return () => {
      active = false;
      if (intervalId !== null) window.clearInterval(intervalId);
      if (nationPollInterval.current !== null) {
        window.clearInterval(nationPollInterval.current);
        nationPollInterval.current = null;
      }
      controller?.abort();
      simulationStatus.current = null;
    };
  }, [simId, initialNationId]);

  useEffect(() => {
    if (!simId || !selected || !simulationReady || !selectedAvailable) return;

    let active = true;
    let inFlight = false;
    const requestId = ++nationRequestId.current;
    const isCurrentRequest = () => active && nationRequestId.current === requestId;

    const refreshNation = async () => {
      if (!isCurrentRequest() || inFlight) return;
      inFlight = true;
      try {
        const next = await api.nation(simId, selected);
        if (!isCurrentRequest()) return;
        setDetailState({ simId, nationId: selected, data: next, loading: false, error: null });
      } catch (e) {
        if (!isCurrentRequest()) return;
        const message = e instanceof Error ? e.message : String(e);
        setDetailState((current) => {
          const previous = current?.simId === simId && current.nationId === selected ? current : null;
          return { simId, nationId: selected, data: previous?.data ?? null, loading: false, error: message };
        });
      } finally {
        inFlight = false;
      }
    };

    setDetailState((current) => current?.simId === simId && current.nationId === selected
      ? { ...current, loading: current.data === null, error: null }
      : { simId, nationId: selected, data: null, loading: true, error: null });
    void refreshNation();

    let intervalId: number | null = null;
    if (simulationStatus.current === 'idle' || simulationStatus.current === 'running') {
      intervalId = window.setInterval(() => {
        if (simulationStatus.current === 'running') void refreshNation();
      }, 2500);
      nationPollInterval.current = intervalId;
    }

    return () => {
      active = false;
      nationRequestId.current += 1;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        if (nationPollInterval.current === intervalId) nationPollInterval.current = null;
      }
    };
  }, [simId, selected, simulationReady, selectedAvailable]);

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
            <select value={selected ?? ''} onChange={(e) => {
              const nationId = e.target.value || null;
              nationRequestId.current += 1;
              setSelected(nationId);
              setDetailState(nationId
                ? { simId, nationId, data: null, loading: true, error: null }
                : null);
              setSimulationState((current) => current?.simId === simId ? { ...current, error: null } : current);
            }} aria-label="Select nation">
              {nations.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        {currentSimulation?.error && <p role="alert" className="notice">{currentSimulation.error}</p>}
        {currentDetail?.error && <p role="alert" className="notice">{currentDetail.error}</p>}
        {simulationLoading && <p role="status" className="muted">Loading simulation nations...</p>}
        {!simulationLoading && !currentSimulation?.error && nations.length === 0 && (
          <p role="status" className="muted">No nations are available for this simulation.</p>
        )}
        {!simulationLoading && nations.length > 0 && !selected && (
          <p className="muted">Select a nation to view its details.</p>
        )}
        {detailLoading && !currentDetail?.error && (
          <p role="status" className="muted">Loading nation details...</p>
        )}
        {selectedAvailable && currentDetail && !currentDetail.loading && !data && !currentDetail.error && (
          <p className="muted">No detail data is available for this nation.</p>
        )}
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
