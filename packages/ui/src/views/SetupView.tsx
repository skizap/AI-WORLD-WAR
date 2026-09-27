import { useMemo, useState } from 'react';
import type { SimulationConfig } from '@aiww/schemas';
import { api, type Meta } from '../api';

const parseNumberInput = (value: string): number | undefined =>
  value.trim() === '' ? undefined : Number(value);

const rangeError = (value: number, min: number, max: number, integer = false): string | undefined => {
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    return `Enter a ${integer ? 'whole number' : 'number'} from ${min} to ${max}.`;
  }
  return undefined;
};

const modelIdError = (value: string): string | undefined =>
  value.trim() ? undefined : 'Enter a model ID.';

export function SetupView({ meta, onCreated }: { meta: Meta; onCreated: (id: string) => void }) {
  const base = meta.defaultConfig;
  const [scenarioId, setScenarioId] = useState(base.scenarioId);
  const [packId, setPackId] = useState(base.fictionPackId);
  const [seed, setSeed] = useState(base.seed);
  const [totalTurns, setTotalTurns] = useState<number | undefined>(base.totalTurns);
  const [provider, setProvider] = useState<'mock' | 'openrouter'>(base.provider);
  const [model, setModel] = useState(base.models.nationAgent);
  const [nationModels, setNationModels] = useState<Record<string, string>>({ ...base.models.nationAgents });
  const [narratorModel, setNarratorModel] = useState(base.models.worldNarrator);
  const [repairModel, setRepairModel] = useState(base.models.repair);
  const [temperature, setTemperature] = useState<number | undefined>(base.temperature);
  const [maxTokens, setMaxTokens] = useState<number | undefined>(base.maxTokens);
  const [nonMessagePerTurn, setNonMessagePerTurn] = useState<number | undefined>(base.limits.nonMessagePerTurn);
  const [messagePerTurn, setMessagePerTurn] = useState<number | undefined>(base.limits.messagePerTurn);
  const [maxMessageLength, setMaxMessageLength] = useState<number | undefined>(base.limits.maxMessageLength);
  const [maxRationaleLength, setMaxRationaleLength] = useState<number | undefined>(base.limits.maxRationaleLength);
  const [populationCollapseThreshold, setPopulationCollapseThreshold] = useState<number | undefined>(
    base.stopConditions.populationCollapseThreshold,
  );
  const [maxViolentActionsPerTurn, setMaxViolentActionsPerTurn] = useState<number | undefined>(
    base.stopConditions.maxViolentActionsPerTurn,
  );
  const [globalStabilityFloor, setGlobalStabilityFloor] = useState<number | undefined>(
    base.stopConditions.globalStabilityFloor,
  );
  const [scheme, setScheme] = useState(base.scoring.scheme);
  const [severityVisibility, setSeverityVisibility] = useState(base.observation.severityVisibility);
  const [includeHistory, setIncludeHistory] = useState(base.observation.includeHistory);
  const [stateMode, setStateMode] = useState<'full' | 'deltas'>(base.observation.stateMode);
  const [framing, setFraming] = useState<'neutral' | 'low_stakes'>(base.observation.framing);
  const [narratorEnabled, setNarratorEnabled] = useState(base.narratorEnabled);
  const [includeNarratorSummaries, setIncludeNarratorSummaries] = useState(base.observation.includeNarratorSummaries);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<Awaited<ReturnType<typeof api.models>>['models'] | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const selectedPack = meta.packs.find((p) => p.id === packId) ?? meta.packs[0];
  const searchTerm = modelSearch.trim().toLowerCase();
  const filteredModels = (models ?? []).filter((entry) => {
    if (!searchTerm) return true;
    const searchableText = [
      entry.id,
      entry.name ?? '',
      entry.contextLength?.toString() ?? '',
      ...Object.entries(entry.pricing ?? {}).map(([key, value]) => `${key} ${value}`),
    ].join(' ').toLowerCase();
    return searchableText.includes(searchTerm);
  });

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
      totalTurns: totalTurns ?? Number.NaN,
      provider,
      models: {
        nationAgent: model,
        nationAgents: Object.fromEntries(
          (selectedPack?.nations ?? []).map((nation) => [nation.id, nationModels[nation.id] ?? model]),
        ),
        worldNarrator: narratorModel,
        repair: repairModel,
      },
      temperature: temperature ?? Number.NaN,
      maxTokens: maxTokens ?? Number.NaN,
      limits: {
        ...base.limits,
        nonMessagePerTurn: nonMessagePerTurn ?? Number.NaN,
        messagePerTurn: messagePerTurn ?? Number.NaN,
        maxMessageLength: maxMessageLength ?? Number.NaN,
        maxRationaleLength: maxRationaleLength ?? Number.NaN,
      },
      stopConditions: {
        ...base.stopConditions,
        populationCollapseThreshold: populationCollapseThreshold ?? Number.NaN,
        maxViolentActionsPerTurn: maxViolentActionsPerTurn ?? Number.NaN,
        globalStabilityFloor: globalStabilityFloor ?? Number.NaN,
      },
      scoring: { ...base.scoring, scheme },
      observation: { ...base.observation, severityVisibility, includeHistory, stateMode, framing, includeNarratorSummaries },
      narratorEnabled,
    }),
    [
      base, scenarioId, packId, seed, totalTurns, provider, model, nationModels, narratorModel, repairModel,
      temperature, maxTokens, nonMessagePerTurn, messagePerTurn, maxMessageLength, maxRationaleLength,
      populationCollapseThreshold, maxViolentActionsPerTurn, globalStabilityFloor, scheme, severityVisibility,
      includeHistory, stateMode, framing, includeNarratorSummaries, narratorEnabled, selectedPack,
    ],
  );

  const rangeErrors = {
    totalTurns: rangeError(config.totalTurns, 1, 200, true),
    temperature: rangeError(config.temperature, 0, 2),
    maxTokens: rangeError(config.maxTokens, 64, 32000, true),
    nonMessagePerTurn: rangeError(config.limits.nonMessagePerTurn, 1, 10, true),
    messagePerTurn: rangeError(config.limits.messagePerTurn, 0, 20, true),
    maxMessageLength: rangeError(config.limits.maxMessageLength, 32, 2000, true),
    maxRationaleLength: rangeError(config.limits.maxRationaleLength, 64, 4000, true),
    populationCollapseThreshold: rangeError(config.stopConditions.populationCollapseThreshold, 0, 100),
    maxViolentActionsPerTurn: rangeError(config.stopConditions.maxViolentActionsPerTurn, 1, 100, true),
    globalStabilityFloor: rangeError(config.stopConditions.globalStabilityFloor, 0, 100),
  };
  const modelErrors = {
    nationAgent: modelIdError(config.models.nationAgent),
    nationAgents: Object.fromEntries(
      Object.entries(config.models.nationAgents).map(([nationId, nationModel]) => [nationId, modelIdError(nationModel)]),
    ),
    worldNarrator: modelIdError(config.models.worldNarrator),
    repair: modelIdError(config.models.repair),
  };
  const hasValidationErrors =
    Object.values(rangeErrors).some(Boolean) ||
    Boolean(modelErrors.nationAgent || modelErrors.worldNarrator || modelErrors.repair) ||
    Object.values(modelErrors.nationAgents).some(Boolean);
  const validationProps = (errorId: string, message: string | undefined) => ({
    'aria-invalid': Boolean(message),
    'aria-describedby': message ? errorId : undefined,
  });
  const validationMessage = (errorId: string, message: string | undefined) =>
    message ? <span className="notice" id={errorId} role="alert">{message}</span> : null;

  const create = async () => {
    if (hasValidationErrors) return;
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
            <input
              type="number"
              min={1}
              max={200}
              step={1}
              value={totalTurns ?? ''}
              onChange={(e) => setTotalTurns(parseNumberInput(e.target.value))}
              aria-label="Total turns"
              {...validationProps('setup-total-turns-error', rangeErrors.totalTurns)}
            />
            {validationMessage('setup-total-turns-error', rangeErrors.totalTurns)}
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
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              aria-label="Model slug"
              {...validationProps('setup-default-model-error', modelErrors.nationAgent)}
            />
            {validationMessage('setup-default-model-error', modelErrors.nationAgent)}
          </label>
          <button type="button" onClick={() => applyModelToAll()}>Apply to all nations</button>
          <button type="button" onClick={loadModels}>Browse catalog</button>
        </div>
        {models && (
          <div className="panel" style={{ maxHeight: 220, overflowY: 'auto' }}>
            <h3>OpenRouter catalog (first 100)</h3>
            <div className="fieldrow">
              <label htmlFor="model-catalog-search">Search catalog
                <input
                  id="model-catalog-search"
                  type="search"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="ID, name, context, or pricing"
                  aria-controls="model-catalog-results"
                />
              </label>
            </div>
            <p className="muted" aria-live="polite">{filteredModels.length} of {models.length} loaded models</p>
            <table id="model-catalog-results" className="table" aria-label="OpenRouter model catalog">
              <thead><tr><th>Model ID</th><th>Name</th><th>Context</th><th>Pricing</th></tr></thead>
              <tbody>
                {filteredModels.length > 0 ? filteredModels.map((entry) => (
                  <tr key={entry.id}>
                    <td><button type="button" onClick={() => applyModelToAll(entry.id)}>{entry.id}</button></td>
                    <td>{entry.name ?? '—'}</td>
                    <td>{entry.contextLength ?? '—'}</td>
                    <td>{Object.entries(entry.pricing ?? {}).map(([key, value]) => `${key}: ${value}`).join(', ') || '—'}</td>
                  </tr>
                )) : <tr><td colSpan={4} className="muted">No models match this search.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="fieldrow">
          <label>
            Temperature
            <input
              type="number"
              step={0.1}
              min={0}
              max={2}
              value={temperature ?? ''}
              onChange={(e) => setTemperature(parseNumberInput(e.target.value))}
              {...validationProps('setup-temperature-error', rangeErrors.temperature)}
            />
            {validationMessage('setup-temperature-error', rangeErrors.temperature)}
          </label>
          <label>
            Max tokens
            <input
              type="number"
              min={64}
              max={32000}
              step={1}
              value={maxTokens ?? ''}
              onChange={(e) => setMaxTokens(parseNumberInput(e.target.value))}
              {...validationProps('setup-max-tokens-error', rangeErrors.maxTokens)}
            />
            {validationMessage('setup-max-tokens-error', rangeErrors.maxTokens)}
          </label>
        </div>
        <h3>Nation model assignments</h3>
        <div className="model-assignments">
          {(selectedPack?.nations ?? []).map((nation, index) => {
            const errorId = `setup-nation-model-${index}-error`;
            const message = modelErrors.nationAgents[nation.id];
            return (
              <label key={nation.id}>
                <span>{nation.name}</span>
                <input
                  value={nationModels[nation.id] ?? model}
                  onChange={(e) => setNationModels((current) => ({ ...current, [nation.id]: e.target.value }))}
                  aria-label={`${nation.name} model`}
                  {...validationProps(errorId, message)}
                />
                {validationMessage(errorId, message)}
              </label>
            );
          })}
        </div>
        <div className="fieldrow">
          <label>
            World narrator model
            <input
              value={narratorModel}
              onChange={(e) => setNarratorModel(e.target.value)}
              {...validationProps('setup-narrator-model-error', modelErrors.worldNarrator)}
            />
            {validationMessage('setup-narrator-model-error', modelErrors.worldNarrator)}
          </label>
          <label>
            Repair model
            <input
              value={repairModel}
              onChange={(e) => setRepairModel(e.target.value)}
              {...validationProps('setup-repair-model-error', modelErrors.repair)}
            />
            {validationMessage('setup-repair-model-error', modelErrors.repair)}
          </label>
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
        <h3>Action limits</h3>
        <div className="fieldrow">
          <label>
            Non-message actions per turn
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              value={nonMessagePerTurn ?? ''}
              onChange={(e) => setNonMessagePerTurn(parseNumberInput(e.target.value))}
              {...validationProps('setup-non-message-limit-error', rangeErrors.nonMessagePerTurn)}
            />
            {validationMessage('setup-non-message-limit-error', rangeErrors.nonMessagePerTurn)}
          </label>
          <label>
            Messages per turn
            <input
              type="number"
              min={0}
              max={20}
              step={1}
              value={messagePerTurn ?? ''}
              onChange={(e) => setMessagePerTurn(parseNumberInput(e.target.value))}
              {...validationProps('setup-message-limit-error', rangeErrors.messagePerTurn)}
            />
            {validationMessage('setup-message-limit-error', rangeErrors.messagePerTurn)}
          </label>
          <label>
            Maximum message length
            <input
              type="number"
              min={32}
              max={2000}
              step={1}
              value={maxMessageLength ?? ''}
              onChange={(e) => setMaxMessageLength(parseNumberInput(e.target.value))}
              {...validationProps('setup-max-message-length-error', rangeErrors.maxMessageLength)}
            />
            {validationMessage('setup-max-message-length-error', rangeErrors.maxMessageLength)}
          </label>
          <label>
            Maximum rationale length
            <input
              type="number"
              min={64}
              max={4000}
              step={1}
              value={maxRationaleLength ?? ''}
              onChange={(e) => setMaxRationaleLength(parseNumberInput(e.target.value))}
              {...validationProps('setup-max-rationale-length-error', rangeErrors.maxRationaleLength)}
            />
            {validationMessage('setup-max-rationale-length-error', rangeErrors.maxRationaleLength)}
          </label>
        </div>
        <h3>Stop conditions</h3>
        <div className="fieldrow">
          <label>
            Population collapse threshold
            <input
              type="number"
              min={0}
              max={100}
              step="any"
              value={populationCollapseThreshold ?? ''}
              onChange={(e) => setPopulationCollapseThreshold(parseNumberInput(e.target.value))}
              {...validationProps('setup-population-collapse-error', rangeErrors.populationCollapseThreshold)}
            />
            {validationMessage('setup-population-collapse-error', rangeErrors.populationCollapseThreshold)}
          </label>
          <label>
            Maximum violent actions per turn
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              value={maxViolentActionsPerTurn ?? ''}
              onChange={(e) => setMaxViolentActionsPerTurn(parseNumberInput(e.target.value))}
              {...validationProps('setup-violent-actions-error', rangeErrors.maxViolentActionsPerTurn)}
            />
            {validationMessage('setup-violent-actions-error', rangeErrors.maxViolentActionsPerTurn)}
          </label>
          <label>
            Global stability floor
            <input
              type="number"
              min={0}
              max={100}
              step="any"
              value={globalStabilityFloor ?? ''}
              onChange={(e) => setGlobalStabilityFloor(parseNumberInput(e.target.value))}
              {...validationProps('setup-global-stability-error', rangeErrors.globalStabilityFloor)}
            />
            {validationMessage('setup-global-stability-error', rangeErrors.globalStabilityFloor)}
          </label>
        </div>
      </section>

      <section className="panel" style={{ gridColumn: '1 / -1' }} aria-labelledby="setup-launch">
        <h2 id="setup-launch">Create autonomous simulation</h2>
        <p className="muted">The simulation runs without action approvals. Start and Stop are available from the Live view.</p>
        {error && <p role="alert" className="notice">{error}</p>}
        {hasValidationErrors && <p id="setup-validation-summary" className="notice" role="status">Correct the highlighted fields before creating the simulation.</p>}
        <button
          disabled={busy || hasValidationErrors}
          onClick={create}
          aria-describedby={hasValidationErrors ? 'setup-validation-summary' : undefined}
        >
          {busy ? 'Creating…' : 'Create simulation'}
        </button>
      </section>
    </div>
  );
}
