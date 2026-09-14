import { useMemo, useState } from 'react';
import type { SimulationConfig } from '@aiww/schemas';
import { api, type Meta } from '../api';

export function SetupView({ meta, onCreated }: { meta: Meta; onCreated: (id: string) => void }) {
  const base = meta.defaultConfig;
  const [scenarioId, setScenarioId] = useState(base.scenarioId);
  const [packId, setPackId] = useState(base.fictionPackId);
  const [seed, setSeed] = useState(base.seed);
  const [totalTurns, setTotalTurns] = useState(base.totalTurns);
  const [provider, setProvider] = useState<'mock' | 'openrouter'>(base.provider);
  const [model, setModel] = useState(base.models.nationAgent);
  const [temperature, setTemperature] = useState(base.temperature);
  const [maxTokens, setMaxTokens] = useState(base.maxTokens);
  const [approvalPolicy, setApprovalPolicy] = useState(base.approvalPolicy);
  const [scheme, setScheme] = useState(base.scoring.scheme);
  const [severityVisibility, setSeverityVisibility] = useState(base.observation.severityVisibility);
  const [includeHistory, setIncludeHistory] = useState(base.observation.includeHistory);
  const [stateMode, setStateMode] = useState<'full' | 'deltas'>(base.observation.stateMode);
  const [framing, setFraming] = useState<'neutral' | 'low_stakes'>(base.observation.framing);
  const [narratorEnabled, setNarratorEnabled] = useState(base.narratorEnabled);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<{ id: string; contextLength?: number }[] | null>(null);

  const config = useMemo<SimulationConfig>(
    () => ({
      ...base,
      scenarioId,
      fictionPackId: packId,
      seed,
      totalTurns,
      provider,
      models: { ...base.models, nationAgent: model, worldNarrator: model, repair: model },
      temperature,
      maxTokens,
      approvalPolicy,
      scoring: { ...base.scoring, scheme },
      observation: { ...base.observation, severityVisibility, includeHistory, stateMode, framing },
      narratorEnabled,
    }),
    [base, scenarioId, packId, seed, totalTurns, provider, model, temperature, maxTokens, approvalPolicy, scheme, severityVisibility, includeHistory, stateMode, framing, narratorEnabled],
  );

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createSimulation(config);
      onCreated(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loadModels = async () => {
    try {
      const { models: m } = await api.models();
      setModels(m.slice(0, 100));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="grid cols-2">
      <section className="panel" aria-labelledby="setup-basics">
        <h2 id="setup-basics">Simulation setup</h2>
        <div className="fieldrow">
          <label>
            Scenario (fictional)
            <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
              {meta.scenarios.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>
            Nation pack (fictional)
            <select value={packId} onChange={(e) => setPackId(e.target.value)}>
              {meta.packs.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="fieldrow">
          <label>
            Seed
            <input value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="Random seed" />
          </label>
          <label>
            Turns
            <input type="number" min={1} max={200} value={totalTurns} onChange={(e) => setTotalTurns(Number(e.target.value))} aria-label="Total turns" />
          </label>
        </div>
        <div className="fieldrow">
          <label>
            Provider
            <select value={provider} onChange={(e) => setProvider(e.target.value as 'mock' | 'openrouter')}>
              <option value="mock">Deterministic mock (offline)</option>
              <option value="openrouter" disabled={!meta.openRouterKeyConfigured}>
                OpenRouter {meta.openRouterKeyConfigured ? '' : '(API key not configured)'}
              </option>
            </select>
          </label>
          <label>
            Model slug (nation agents)
            <input value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model slug" />
          </label>
          <button type="button" onClick={loadModels}>Browse catalog</button>
        </div>
        {models && (
          <div className="panel" style={{ maxHeight: 220, overflowY: 'auto' }}>
            <h3>OpenRouter catalog (first 100)</h3>
            <table className="table">
              <thead><tr><th>Model</th><th>Context</th></tr></thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id}>
                    <td><button type="button" onClick={() => setModel(m.id)}>{m.id}</button></td>
                    <td>{m.contextLength ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="fieldrow">
          <label>Temperature <input type="number" step={0.1} min={0} max={2} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} /></label>
          <label>Max tokens <input type="number" min={64} max={32000} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} /></label>
        </div>
      </section>

      <section className="panel" aria-labelledby="setup-advanced">
        <h2 id="setup-advanced">Mechanics & ablations</h2>
        <div className="fieldrow">
          <label>
            Approval gate
            <select value={approvalPolicy} onChange={(e) => setApprovalPolicy(e.target.value as SimulationConfig['approvalPolicy'])}>
              <option value="off">Off</option>
              <option value="severe">Severe actions only</option>
              <option value="all">All actions</option>
            </select>
          </label>
          <label>
            Scoring scheme
            <select value={scheme} onChange={(e) => setScheme(e.target.value as SimulationConfig['scoring']['scheme'])}>
              <option value="default">Default (2^x − 4 ladder)</option>
              <option value="exponential">Exponential</option>
              <option value="linear">Linear</option>
              <option value="firebreak">Firebreak</option>
              <option value="custom">Custom</option>
            </select>
          </label>
        </div>
        <div className="fieldrow">
          <label>
            Severity labels in prompts
            <select value={severityVisibility} onChange={(e) => setSeverityVisibility(e.target.value as 'hidden' | 'exposed')}>
              <option value="hidden">Hidden (baseline)</option>
              <option value="exposed">Exposed (experimental)</option>
            </select>
          </label>
          <label>
            History
            <select value={includeHistory ? 'on' : 'off'} onChange={(e) => setIncludeHistory(e.target.value === 'on')}>
              <option value="on">Visible to agents</option>
              <option value="off">Ablated</option>
            </select>
          </label>
        </div>
        <div className="fieldrow">
          <label>
            State visibility
            <select value={stateMode} onChange={(e) => setStateMode(e.target.value as 'full' | 'deltas')}>
              <option value="full">Full values</option>
              <option value="deltas">Changes only</option>
            </select>
          </label>
          <label>
            Framing
            <select value={framing} onChange={(e) => setFraming(e.target.value as 'neutral' | 'low_stakes')}>
              <option value="neutral">Neutral</option>
              <option value="low_stakes">Low-stakes (experimental)</option>
            </select>
          </label>
        </div>
        <div className="checkbox-row">
          <input id="narrator-chk" type="checkbox" checked={narratorEnabled} onChange={(e) => setNarratorEnabled(e.target.checked)} />
          <label htmlFor="narrator-chk">World narrator enabled (deterministic fallback if unavailable)</label>
        </div>
      </section>

      <section className="panel" style={{ gridColumn: '1 / -1' }} aria-labelledby="setup-safety">
        <h2 id="setup-safety">Safety acknowledgment</h2>
        <div className="checkbox-row">
          <input id="ack-chk" type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
          <label htmlFor="ack-chk">
            I understand this is a <strong>fictional research simulation</strong>: all countries are fictional, numbers are
            synthetic research parameters, and results are not predictions, forecasts, or decision support for the real world.
          </label>
        </div>
        {error && <p role="alert" className="notice">{error}</p>}
        <button disabled={!ack || busy} onClick={create}>{busy ? 'Creating…' : 'Create simulation'}</button>
      </section>
    </div>
  );
}
