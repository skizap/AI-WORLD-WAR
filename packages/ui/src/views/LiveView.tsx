import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldEvent, WorldState } from '@aiww/schemas';
import { api, SEVERITY_TEXT, VARIABLE_LABELS } from '../api';
import { AtlasMap } from '../atlas/AtlasMap';
import { eventKey, isVisualAction, mergeEventSnapshot, orderWorldEvents } from '../atlas/events';
import { ACTIVE_NATION_NAMES, type ActiveNationId } from '../atlas/types';

type SimulationListItem = Awaited<ReturnType<typeof api.listSimulations>>[number];

interface EventStream {
  simId: string | null;
  events: WorldEvent[];
  hydrated: boolean;
}

const EVENT_LIMIT = 120;
const NATION_VARIABLES = [
  'militaryCapacity', 'gdp', 'trade', 'politicalStability', 'population', 'nuclearCapability',
] as const;

function nationLabel(id?: string): string {
  if (!id) return 'World';
  return ACTIVE_NATION_NAMES[id as ActiveNationId] ?? id;
}

function eventSummary(event: WorldEvent): string {
  const actor = nationLabel(event.actorId);
  const target = event.targetId ? ` → ${nationLabel(event.targetId)}` : '';
  if (event.type === 'narrator') return `Narrator${event.message ? `: ${event.message}` : ' update'}`;
  if (event.status === 'rejected') return `${actor} · ${event.actionId ?? 'proposal'}${target} · rejected`;
  if (event.type === 'action') return `${actor} · ${event.actionId ?? 'validated action'}${target}`;
  return `${actor} · ${event.actionId ?? event.type}${target}`;
}

export function LiveView({
  simId,
  onPick,
  onViewNation = () => undefined,
}: {
  simId: string | null;
  onPick: (id: string) => void;
  onViewNation?: (nationId: ActiveNationId) => void;
}) {
  const [sims, setSims] = useState<SimulationListItem[]>([]);
  const [world, setWorld] = useState<WorldState | null>(null);
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [controlBusy, setControlBusy] = useState(false);
  const [eventStream, setEventStream] = useState<EventStream>(() => ({ simId, events: [], hydrated: false }));
  const [queue, setQueue] = useState<WorldEvent[]>([]);
  const [visualEvent, setVisualEvent] = useState<WorldEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<WorldEvent | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [eventSearch, setEventSearch] = useState('');
  const [eventStatus, setEventStatus] = useState<'all' | 'accepted' | 'rejected' | 'info'>('all');
  const [eventNation, setEventNation] = useState<'all' | ActiveNationId>('all');
  const [railOpen, setRailOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 760);
  const eventStreamRef = useRef<EventStream>({ simId, events: [], hydrated: false });
  const queueRef = useRef<WorldEvent[]>([]);
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const events = eventStream.simId === simId ? eventStream.events : [];

  useEffect(() => {
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    const initialStream: EventStream = { simId, events: [], hydrated: false };
    eventStreamRef.current = initialStream;
    queueRef.current = [];
    setEventStream(initialStream);
    setQueue([]);
    setVisualEvent(null);
    setSelectedEvent(null);
    setWorld(null);
    setStatus('');
    setPhase('');
    setError(null);
    setIsPlaying(true);
    setPlaybackSpeed(1);

    const refresh = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const list = await api.listSimulations({ signal: controller.signal });
        if (!active) return;
        setSims(list);
        const activeId = simId ?? list[0]?.id ?? null;
        if (!activeId) {
          setWorld(null);
          setStatus('');
          setPhase('');
          const empty: EventStream = { simId: null, events: [], hydrated: true };
          eventStreamRef.current = empty;
          setEventStream(empty);
          return;
        }

        const simulation = await api.getSimulation(activeId, { signal: controller.signal });
        if (!active) return;
        setWorld(simulation.world);
        setStatus(simulation.status);
        setPhase(simulation.phase);
        setError(null);

        // The SQLite-backed events endpoint flushes after steps; world.events is current in-memory state.
        const current = eventStreamRef.current;
        if (current.simId !== activeId || !current.hydrated) {
          const hydrated: EventStream = {
            simId: activeId,
            events: orderWorldEvents(simulation.world.events ?? []),
            hydrated: true,
          };
          eventStreamRef.current = hydrated;
          setEventStream(hydrated);
        } else {
          const merged = mergeEventSnapshot(activeId, current.events, simulation.world.events ?? []);
          const nextStream: EventStream = { simId: activeId, events: merged.events, hydrated: true };
          eventStreamRef.current = nextStream;
          setEventStream(nextStream);

          const newVisuals = merged.added.filter(isVisualAction);
          if (newVisuals.length) {
            const known = new Set(queueRef.current.map((event) => eventKey(activeId, event)));
            const additions = newVisuals.filter((event) => !known.has(eventKey(activeId, event)));
            const nextQueue = [...queueRef.current, ...additions];
            queueRef.current = nextQueue;
            setQueue(nextQueue);
          }
        }

        if (activeId !== simId) onPick(activeId);
      } catch (e) {
        if (active && !controller.signal.aborted) setError((e as Error).message);
      } finally {
        inFlight = false;
      }
    };

    refreshRef.current = refresh;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [simId, onPick]);

  const queueHeadKey = simId && queue[0] ? eventKey(simId, queue[0]) : null;
  useEffect(() => {
    if (!isPlaying || !simId || !queueHeadKey) return;
    const next = queueRef.current[0];
    if (!next || eventKey(simId, next) !== queueHeadKey) return;

    setVisualEvent(next);
    setSelectedEvent(next);
    const timer = window.setTimeout(() => {
      const currentQueue = queueRef.current;
      if (currentQueue[0] && eventKey(simId, currentQueue[0]) === queueHeadKey) {
        const remaining = currentQueue.slice(1);
        queueRef.current = remaining;
        setQueue(remaining);
      }
      setVisualEvent(null);
    }, 1200 / playbackSpeed);
    return () => window.clearTimeout(timer);
  }, [isPlaying, queueHeadKey, playbackSpeed, simId]);

  const nations = useMemo(() => Object.values(world?.nations ?? {}), [world]);
  const visualHistory = useMemo(() => events.filter(isVisualAction), [events]);
  const matchingEvents = useMemo(() => {
    const query = eventSearch.trim().toLocaleLowerCase('en');
    return events.filter((event) => {
      if (eventStatus !== 'all' && event.status !== eventStatus) return false;
      if (eventNation !== 'all' && event.actorId !== eventNation && event.targetId !== eventNation) return false;
      if (!query) return true;
      const searchable = [event.type, event.actionId, event.actorId, event.targetId, event.message, event.reason, event.details]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('en');
      return searchable.includes(query);
    });
  }, [events, eventSearch, eventNation, eventStatus]);
  const visibleEvents = matchingEvents.slice(-EVENT_LIMIT);
  const turn = world?.turn ?? 0;
  const total = world?.totalTurns ?? sims.find((simulation) => simulation.id === simId)?.totalTurns ?? 1;
  const progress = total > 0 ? Math.min(100, Math.max(0, (turn / total) * 100)) : 0;
  const detailEvent = selectedEvent ?? visualEvent;

  const control = async (action: 'start' | 'stop') => {
    if (!simId) return;
    setControlBusy(true);
    setError(null);
    try {
      await api.control(simId, action);
      await refreshRef.current();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setControlBusy(false);
    }
  };

  const replaceQueue = (next: WorldEvent[]) => {
    queueRef.current = next;
    setQueue(next);
  };

  const stepEvent = () => {
    const next = queueRef.current[0];
    if (!next || isPlaying) return;
    setIsPlaying(false);
    setVisualEvent(next);
    setSelectedEvent(next);
    replaceQueue(queueRef.current.slice(1));
  };

  const stepTurn = () => {
    const pending = queueRef.current;
    if (!pending.length || isPlaying) return;
    const nextTurn = pending[0]!.turn;
    const thisTurn = pending.filter((event) => event.turn === nextTurn);
    const latestThisTurn = thisTurn[thisTurn.length - 1];
    if (!latestThisTurn) return;
    setIsPlaying(false);
    setVisualEvent(latestThisTurn);
    setSelectedEvent(latestThisTurn);
    replaceQueue(pending.filter((event) => event.turn > nextTurn));
  };

  const replayHistory = () => {
    replaceQueue(visualHistory);
    setVisualEvent(null);
    setSelectedEvent(null);
    setIsPlaying(true);
  };

  const jumpToLive = () => {
    replaceQueue([]);
    setVisualEvent(null);
    setSelectedEvent(null);
    setIsPlaying(true);
  };

  return (
    <div className="live-atlas-view">
      <section className="panel live-control-panel" aria-labelledby="live-controls">
        <div className="live-control-heading">
          <div>
            <p className="eyebrow">Run monitor</p>
            <h2 id="live-controls">Simulation controls</h2>
          </div>
          <p className="live-turn-count">Turn <strong>{turn}</strong> <span>/ {total}</span></p>
        </div>
        <div className="live-control-row">
          <label htmlFor="simulation-picker">Simulation</label>
          <select
            id="simulation-picker"
            value={simId ?? ''}
            onChange={(e) => { if (e.target.value) onPick(e.target.value); }}
            aria-label="Select simulation"
          >
            {!sims.length && <option value="">No simulation selected</option>}
            {sims.map((simulation) => (
              <option key={simulation.id} value={simulation.id}>
                {simulation.id} · {simulation.status} · t{simulation.turn}/{simulation.totalTurns}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void control('start')} disabled={!simId || controlBusy || status !== 'idle'}>Start</button>
          <button type="button" onClick={() => void control('stop')} disabled={!simId || controlBusy || status !== 'running'}>Stop</button>
          <span className="live-status" aria-live="polite">
            <span className={`status-dot ${status || 'unknown'}`} aria-hidden="true" />
            {status || 'No run selected'}{phase ? ` · ${phase}` : ''}
          </span>
        </div>
        <div className="progress live-progress" role="progressbar" aria-valuenow={turn} aria-valuemin={0} aria-valuemax={total} aria-label="Simulation progress">
          <div style={{ width: `${progress}%` }} />
        </div>
        <div className="live-run-context">
          <span>Scenario: {world?.scenarioId ?? '—'}</span>
          <span>Seed: {world?.seed ?? '—'}</span>
          <span>Visual playback is independent of simulation time</span>
        </div>
        {error && <p role="alert" className="notice live-error">{error}</p>}
      </section>

      <div className="atlas-live-layout">
        <div className="atlas-primary-column">
          <AtlasMap
            event={visualEvent ?? selectedEvent}
            animateEvent={Boolean(visualEvent && isPlaying)}
            onViewNation={onViewNation}
          />

          <section className="panel live-nation-panel" aria-labelledby="nation-cards">
            <div className="live-section-heading">
              <div>
                <p className="eyebrow">Synthetic state variables</p>
                <h2 id="nation-cards">Eight active agents</h2>
              </div>
              <span className="muted">Neutral map regions have no simulation state</span>
            </div>
            {nations.length ? (
              <div className="grid cols-3">
                {nations.map((nation) => (
                  <article className="panel live-nation-card" key={nation.id}>
                    <h3>{nationLabel(nation.id)}</h3>
                    {NATION_VARIABLES.map((key) => {
                      const value = nation.variables[key] ?? 0;
                      const max = key === 'nuclearCapability' ? 10 : 100;
                      return (
                        <div className="varbar" key={key}>
                          <span>{VARIABLE_LABELS[key]}</span>
                          <span className="bar"><span style={{ width: `${Math.min(100, Math.max(0, (value / max) * 100))}%` }} /></span>
                          <span>{Math.round(value * 10) / 10}</span>
                        </div>
                      );
                    })}
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">Create or select a simulation to see the eight active agents’ current synthetic values.</p>
            )}
          </section>
        </div>

        <aside className={`atlas-event-rail${railOpen ? ' is-open' : ''}`} aria-label="Ordered simulation event rail">
          <button
            className="atlas-rail-toggle"
            type="button"
            aria-expanded={railOpen}
            aria-controls="atlas-event-content"
            onClick={() => setRailOpen((open) => !open)}
          >
            <span>Event rail</span>
            <span className="atlas-rail-count">{events.length}</span>
            <span aria-hidden="true">{railOpen ? '−' : '+'}</span>
          </button>
          {railOpen && (
            <div id="atlas-event-content" className="atlas-event-content">
              <section className="atlas-playback" aria-labelledby="playback-heading">
                <div className="live-section-heading">
                  <div>
                    <p className="eyebrow">Visual-only queue</p>
                    <h2 id="playback-heading">Event playback</h2>
                  </div>
                  <span className="atlas-queue-count" aria-live="polite">{queue.length} queued</span>
                </div>
                <div className="atlas-playback-controls">
                  <button type="button" onClick={() => setIsPlaying((playing) => !playing)}>
                    {isPlaying ? 'Pause visuals' : 'Play visuals'}
                  </button>
                  <button type="button" onClick={stepEvent} disabled={!queue.length || isPlaying}>Step event</button>
                  <button type="button" onClick={stepTurn} disabled={!queue.length || isPlaying}>Step turn</button>
                </div>
                <div className="atlas-playback-secondary">
                  <label>
                    Speed
                    <select value={playbackSpeed} onChange={(e) => setPlaybackSpeed(Number(e.target.value))} aria-label="Visual playback speed">
                      <option value={0.5}>0.5×</option>
                      <option value={1}>1×</option>
                      <option value={1.5}>1.5×</option>
                      <option value={2}>2×</option>
                    </select>
                  </label>
                  <button type="button" onClick={replayHistory} disabled={!visualHistory.length}>Replay history</button>
                  <button type="button" onClick={jumpToLive}>Jump to live</button>
                </div>
                <p className="atlas-playback-note" role="note">
                  Map symbols are illustrative, not routes, units, logistics, or border changes. Playback never pauses or alters the simulation.
                </p>
              </section>

              <section className="atlas-event-history" aria-labelledby="event-history-heading">
                <div className="live-section-heading">
                  <div>
                    <p className="eyebrow">Ordered by turn and sequence</p>
                    <h2 id="event-history-heading">Event history</h2>
                  </div>
                  <span className="muted">{matchingEvents.length} matches</span>
                </div>
                <div className="atlas-event-filters">
                  <label>
                    Search
                    <input
                      type="search"
                      value={eventSearch}
                      onChange={(e) => setEventSearch(e.target.value)}
                      placeholder="Action, actor, message"
                      aria-label="Search event history"
                    />
                  </label>
                  <label>
                    Outcome
                    <select value={eventStatus} onChange={(e) => setEventStatus(e.target.value as typeof eventStatus)} aria-label="Filter events by outcome">
                      <option value="all">All outcomes</option>
                      <option value="accepted">Accepted</option>
                      <option value="rejected">Rejected</option>
                      <option value="info">Information</option>
                    </select>
                  </label>
                  <label>
                    Nation
                    <select value={eventNation} onChange={(e) => setEventNation(e.target.value as typeof eventNation)} aria-label="Filter events by nation">
                      <option value="all">All nations</option>
                      {Object.entries(ACTIVE_NATION_NAMES).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    </select>
                  </label>
                </div>
                {matchingEvents.length > EVENT_LIMIT && (
                  <p className="muted atlas-history-limit">Showing the most recent {EVENT_LIMIT} of {matchingEvents.length} matching events.</p>
                )}
                <ol className="atlas-event-list" aria-label="Events in turn and sequence order">
                  {visibleEvents.map((event) => (
                    <li key={event.id}>
                      <button
                        type="button"
                        className={`atlas-event-entry event ${event.status} ${event.type}${selectedEvent?.id === event.id ? ' is-selected' : ''}`}
                        aria-pressed={selectedEvent?.id === event.id}
                        onClick={() => {
                          setIsPlaying(false);
                          setVisualEvent(null);
                          setSelectedEvent(event);
                        }}
                      >
                        <span className="atlas-event-meta">
                          <span className="badge info">t{event.turn} · #{event.seq}</span>
                          <span className={`atlas-event-outcome ${event.status}`}>{event.status}</span>
                        </span>
                        <span className="atlas-event-summary">{eventSummary(event)}</span>
                        {event.status === 'rejected' && event.reason && <span className="atlas-event-reason">Reason: {event.reason}</span>}
                        {(event.severity === 'violent_escalation' || event.severity === 'nuclear_escalation') && event.status === 'accepted' && (
                          <span className="badge severe">Severe fictional event · {SEVERITY_TEXT[event.severity]}</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ol>
                {!events.length && <p className="muted atlas-empty-events">No simulation events yet. Newly accepted actions will enter visual playback; existing history is not animated until replay is selected.</p>}
                {events.length > 0 && !matchingEvents.length && <p className="muted atlas-empty-events">No events match these filters.</p>}
              </section>

              <section className="atlas-event-detail" aria-labelledby="selected-event-heading" aria-live="polite">
                <p className="eyebrow">Selected event</p>
                {detailEvent ? (
                  <>
                    <h2 id="selected-event-heading">{eventSummary(detailEvent)}</h2>
                    <p className="atlas-detail-meta">
                      Turn {detailEvent.turn} · sequence {detailEvent.seq} · {detailEvent.status}
                      {detailEvent.severity ? ` · ${SEVERITY_TEXT[detailEvent.severity] ?? detailEvent.severity}` : ''}
                    </p>
                    {detailEvent.reason && <p className="atlas-event-reason">Rejected: {detailEvent.reason}</p>}
                    {detailEvent.message && <p>{detailEvent.message}</p>}
                    {detailEvent.details && <p className="muted">{detailEvent.details}</p>}
                    {!!detailEvent.stateChanges.length && (
                      <div className="atlas-change-list">
                        <h3>State changes</h3>
                        <ul>
                          {detailEvent.stateChanges.map((change, index) => (
                            <li key={`${change.nationId}:${change.variable}:${index}`}>
                              {nationLabel(change.nationId)} · {VARIABLE_LABELS[change.variable] ?? change.variable}: {change.before} → {change.after}
                              {change.explanation ? ` · ${change.explanation}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {!!detailEvent.relChanges.length && (
                      <div className="atlas-change-list">
                        <h3>Relationship changes</h3>
                        <ul>
                          {detailEvent.relChanges.map((change, index) => (
                            <li key={`${change.pairKey}:${change.dimension}:${index}`}>
                              {change.pairKey} · {change.dimension}: {change.before} → {change.after}
                              {change.explanation ? ` · ${change.explanation}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : (
                  <p id="selected-event-heading" className="muted">Select an event to inspect its validated outcome and recorded state changes.</p>
                )}
              </section>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
