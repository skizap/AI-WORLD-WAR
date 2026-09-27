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
  const [nationModels, setNationModels] = useState<Record<string, string>>({ ...base.models.nationAgents });
  const [narratorModel, setNarratorModel] = useState(base.models.worldNarrator);
  const [repairModel, setRepairModel] = useState(base.models.repair);
  const [temperature, setTemperature] = useState(base.temperature);
  const [maxTokens, setMaxTokens] = useState(base.maxTokens);
  const [scheme, setScheme] = useState(base.scoring.scheme);
  const [severityVisibility, setSeverityVisibility] = useState(base.observation.severityVisibility);
  const [includeHistory, setIncludeHistory] = useState(base.observation.includeHistory);
  const [stateMode, setStateMode] = useState<'full' | 'deltas'>(base.observation.stateMode);
  const [framing, setFraming] = useState<'neutral' | 'low_stakes'>(base.observation.framing);
  const [narratorEnabled, setNarratorEnabled] = useState(base.narratorEnabled);
  const [includeNarratorSummaries, setIncludeNarratorSummaries] = useState(base.observation.includeNarratorSummaries);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<{ id: string; contextLength?: number }[] | null>(null);
  const selectedPack = meta.packs.find((p) => p.id === packId) ?? meta.packs[0];

  const applyModelToAll = (nextModel = model) => {
    setModel(nextModel);
    setNationModels(Object.fromEntries((selectedPack?.nations ?? []).map((nation) => [nation.id, nextModel])));
  };

  const config = useMemo<SimulationConfig>(
    () => ({
      ...base,
      scenarioId,
      fictionPackId: packId,
      seed,
      totalTurns,
      provider,
      models: {
        nationAgent: model,
        nationAgents: Object.fromEntries(
          (selectedPack?.nations ?? []).map((nation) => [nation.id, nationModels[nation.id] ?? model]),
        ),
        worldNarrator: narratorModel,
        repair: repairModel,
      },
      temperature,
      maxTokens,
      scoring: { ...base.scoring, scheme },
      observation: { ...base.observation, severityVisibility, includeHistory, stateMode, framing, includeNarratorSummaries },
      narratorEnabled,
    }),
    [base, scenarioId, packId, seed, totalTurns, provider, model, nationModels, narratorModel, repairModel, temperature, maxTokens, scheme, severityVisibility, includeHistory, stateMode, framing, includeNarratorSummaries, narratorEnabled, selectedPack],
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
            Default nation model
            <input value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model slug" />
          </label>
          <button type="button" onClick={() => applyModelToAll()}>Apply to all nations</button>
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
                    <td><button type="button" onClick={() => applyModelToAll(m.id)}>{m.id}</button></td>
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
        <h3>Nation model assignments</h3>
        <div className="model-assignments">
          {(selectedPack?.nations ?? []).map((nation) => (
            <label key={nation.id}>
              <span>{nation.name}</span>
              <input
                value={nationModels[nation.id] ?? model}
                onChange={(e) => setNationModels((current) => ({ ...current, [nation.id]: e.target.value }))}
                aria-label={`${nation.name} model`}
              />
            </label>
          ))}
        </div>
        <div className="fieldrow">
          <label>World narrator model <input value={narratorModel} onChange={(e) => setNarratorModel(e.target.value)} /></label>
          <label>Repair model <input value={repairModel} onChange={(e) => setRepairModel(e.target.value)} /></label>
        </div>
      </section>

      <section className="panel" aria-labelledby="setup-advanced">
        <h2 id="setup-advanced">Mechanics & ablations</h2>
        <div className="fieldrow">
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
        <div className="checkbox-row">
          <input id="narrator-feedback-chk" type="checkbox" checked={includeNarratorSummaries} onChange={(e) => setIncludeNarratorSummaries(e.target.checked)} />
          <label htmlFor="narrator-feedback-chk">Experimental: feed narrator summaries back to nation agents</label>
        </div>
      </section>

      <section className="panel" style={{ gridColumn: '1 / -1' }} aria-labelledby="setup-launch">
        <h2 id="setup-launch">Create autonomous simulation</h2>
        <p className="muted">The simulation runs without action approvals. Start and Stop are available from the Live view.</p>
        {error && <p role="alert" className="notice">{error}</p>}
        <button disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create simulation'}</button>
      </section>
    </div>
  );
}
