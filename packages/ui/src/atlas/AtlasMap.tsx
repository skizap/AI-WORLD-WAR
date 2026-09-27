import { useEffect, useMemo, useRef, useState } from 'react';
import { geoCentroid, geoEqualEarth, geoGraticule10, geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import type { WorldEvent } from '@aiww/schemas';
import { api, SEVERITY_TEXT } from '../api';
import { assertAtlasTopology, atlasFeatures } from './atlasData';
import {
  ACTIVE_NATION_IDS,
  ACTIVE_NATION_NAMES,
  type ActiveNationId,
  type AtlasRegionFeature,
  type AtlasTopology,
  type ProjectedAtlasRegion,
} from './types';

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 510;

type AtlasMapProps = {
  event: WorldEvent | null;
  animateEvent?: boolean;
  onViewNation: (nationId: ActiveNationId) => void;
};

type EventSymbol = {
  actorId: ActiveNationId;
  targetId?: ActiveNationId;
  kind: 'diplomacy' | 'trade' | 'cyber' | 'military';
  path?: string;
  pulseAt: [number, number];
  severe: boolean;
};

function classifyAction(actionId: string): EventSymbol['kind'] {
  if (/cyber/i.test(actionId)) return 'cyber';
  if (/(trade|commerce|sanction|blockade)/i.test(actionId)) return 'trade';
  if (/(military|attack|invasion|strike|weapon|exercise|surveillance|nuclear)/i.test(actionId)) return 'military';
  return 'diplomacy';
}

function linkPath(from: [number, number], to: [number, number]): string {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.max(1, Math.hypot(dx, dy));
  const bend = Math.min(54, Math.max(14, distance * 0.16));
  const controlX = (from[0] + to[0]) / 2 - (dy / distance) * bend;
  const controlY = (from[1] + to[1]) / 2 + (dx / distance) * bend;
  return `M${from[0]},${from[1]} Q${controlX},${controlY} ${to[0]},${to[1]}`;
}

function describeParticipation(region: AtlasRegionFeature): string {
  const nationId = region.properties.activeNationId;
  return nationId ? `Active fictional nation ${ACTIVE_NATION_NAMES[nationId]}` : 'Neutral scenery; not a simulation participant';
}

export function AtlasMap({ event, animateEvent = false, onViewNation }: AtlasMapProps) {
  const [topology, setTopology] = useState<AtlasTopology | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [search, setSearch] = useState('');
  const [searchNotice, setSearchNotice] = useState('');
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [focusedRegionId, setFocusedRegionId] = useState<string | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const regionNodesRef = useRef(new Map<string, SVGPathElement>());

  useEffect(() => {
    let active = true;
    setLoadError(null);
    api.atlas()
      .then((payload) => {
        if (active) setTopology(assertAtlasTopology(payload));
      })
      .catch((error: Error) => {
        if (active) setLoadError(error.message);
      });
    return () => {
      active = false;
    };
  }, [retryCount]);

  const regions = useMemo<ProjectedAtlasRegion[]>(() => {
    if (!topology) return [];
    const collection = { type: 'FeatureCollection' as const, features: atlasFeatures(topology) };
    const projection = geoEqualEarth().fitExtent([[22, 16], [MAP_WIDTH - 22, MAP_HEIGHT - 16]], collection);
    const pathGenerator = geoPath(projection);

    return collection.features
      .map((feature) => {
        const center = feature.properties.visualAnchor ?? geoCentroid(feature);
        const projected: [number, number] = projection(center) ?? [MAP_WIDTH / 2, MAP_HEIGHT / 2];
        return {
          feature,
          path: pathGenerator(feature) ?? '',
          anchor: projected,
        };
      })
      .sort((left, right) => left.feature.properties.alias.localeCompare(right.feature.properties.alias));
  }, [topology]);

  const regionById = useMemo(
    () => new Map(regions.map((region) => [region.feature.properties.regionId, region])),
    [regions],
  );
  const regionByNation = useMemo(
    () => new Map(regions
      .filter((region) => region.feature.properties.activeNationId !== null)
      .map((region) => [region.feature.properties.activeNationId!, region])),
    [regions],
  );
  const selectedRegion = selectedRegionId ? regionById.get(selectedRegionId)?.feature ?? null : null;
  const activeRegions = ACTIVE_NATION_IDS.flatMap((nationId) => {
    const region = regionByNation.get(nationId);
    return region ? [{ nationId, region }] : [];
  });

  useEffect(() => {
    if (!regions.length) return;
    if (!focusedRegionId || !regionById.has(focusedRegionId)) {
      setFocusedRegionId(regions[0]?.feature.properties.regionId ?? null);
    }
  }, [regions, regionById, focusedRegionId]);

  useEffect(() => {
    const svgNode = svgRef.current;
    if (!svgNode) return;

    const selection = select<SVGSVGElement, unknown>(svgNode);
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 8])
      .extent([[0, 0], [MAP_WIDTH, MAP_HEIGHT]])
      .translateExtent([[0, 0], [MAP_WIDTH, MAP_HEIGHT]])
      .on('zoom.atlas', (event: D3ZoomEvent<SVGSVGElement, unknown>) => setTransform(event.transform));

    zoomRef.current = behavior;
    selection.call(behavior);
    return () => {
      selection.on('.zoom', null);
      zoomRef.current = null;
    };
  }, [topology]);

  useEffect(() => {
    const updateFullscreen = () => setIsFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', updateFullscreen);
    return () => document.removeEventListener('fullscreenchange', updateFullscreen);
  }, []);

  const eventSymbol = useMemo<EventSymbol | null>(() => {
    if (!event || event.type !== 'action' || event.status !== 'accepted' || !event.actionId || !event.actorId) {
      return null;
    }
    const actorId = event.actorId as ActiveNationId;
    const actor = regionByNation.get(actorId);
    if (!actor) return null;

    const targetId = event.targetId as ActiveNationId | undefined;
    if (targetId) {
      const target = regionByNation.get(targetId);
      if (!target || targetId === actorId) return null;
      return {
        actorId,
        targetId,
        kind: classifyAction(event.actionId),
        path: linkPath(actor.anchor, target.anchor),
        pulseAt: actor.anchor,
        severe: event.severity === 'violent_escalation' || event.severity === 'nuclear_escalation',
      };
    }

    return {
      actorId,
      kind: classifyAction(event.actionId),
      pulseAt: actor.anchor,
      severe: event.severity === 'violent_escalation' || event.severity === 'nuclear_escalation',
    };
  }, [event, regionByNation]);

  const focusRegion = (regionId: string) => {
    const region = regionById.get(regionId);
    if (!region) return;
    setSelectedRegionId(regionId);
    setFocusedRegionId(regionId);
    setSearchNotice(`${region.feature.properties.alias} focused on the atlas.`);

    const svgNode = svgRef.current;
    const behavior = zoomRef.current;
    if (svgNode && behavior) {
      const selection = select<SVGSVGElement, unknown>(svgNode);
      selection.call(behavior.scaleTo, 4, [MAP_WIDTH / 2, MAP_HEIGHT / 2]);
      selection.call(behavior.translateTo, region.anchor[0], region.anchor[1], [MAP_WIDTH / 2, MAP_HEIGHT / 2]);
    }

    const focus = () => regionNodesRef.current.get(regionId)?.focus();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus);
    else focus();
  };

  const moveKeyboardFocus = (currentId: string, key: string) => {
    if (!regions.length) return;
    const currentIndex = regions.findIndex((region) => region.feature.properties.regionId === currentId);
    const nextIndex = key === 'Home'
      ? 0
      : key === 'End'
        ? regions.length - 1
        : (currentIndex + ((key === 'ArrowRight' || key === 'ArrowDown') ? 1 : -1) + regions.length) % regions.length;
    const nextRegion = regions[nextIndex];
    if (!nextRegion) return;
    const nextId = nextRegion.feature.properties.regionId;
    setFocusedRegionId(nextId);
    setSelectedRegionId(nextId);
    regionNodesRef.current.get(nextId)?.focus();
  };

  const locateSearch = () => {
    const query = search.trim().toLocaleLowerCase('en');
    if (!query) {
      setSearchNotice('Enter a fictional region alias to focus it on the map.');
      return;
    }
    const match = regions.find((region) => region.feature.properties.alias.toLocaleLowerCase('en') === query)
      ?? regions.find((region) => region.feature.properties.alias.toLocaleLowerCase('en').includes(query));
    if (match) {
      focusRegion(match.feature.properties.regionId);
    } else {
      setSearchNotice(`No fictional region matched “${search.trim()}”.`);
    }
  };

  const zoomBy = (factor: number) => {
    const svgNode = svgRef.current;
    const behavior = zoomRef.current;
    if (svgNode && behavior) {
      select<SVGSVGElement, unknown>(svgNode).call(behavior.scaleBy, factor, [MAP_WIDTH / 2, MAP_HEIGHT / 2]);
    }
  };

  const resetZoom = () => {
    const svgNode = svgRef.current;
    const behavior = zoomRef.current;
    if (svgNode && behavior) select<SVGSVGElement, unknown>(svgNode).call(behavior.transform, zoomIdentity);
  };

  const toggleFullscreen = async () => {
    const shell = shellRef.current;
    if (!shell) return;
    setFullscreenError(null);
    try {
      if (document.fullscreenElement === shell) await document.exitFullscreen();
      else if (shell.requestFullscreen) await shell.requestFullscreen();
      else setFullscreenError('Fullscreen presentation is not available in this browser.');
    } catch {
      setFullscreenError('Fullscreen presentation could not be opened.');
    }
  };

  const graticulePath = useMemo(() => {
    if (!topology) return '';
    const collection = { type: 'FeatureCollection' as const, features: atlasFeatures(topology) };
    const projection = geoEqualEarth().fitExtent([[22, 16], [MAP_WIDTH - 22, MAP_HEIGHT - 16]], collection);
    return geoPath(projection)(geoGraticule10()) ?? '';
  }, [topology]);

  return (
    <section className="panel atlas-map-panel" aria-labelledby="atlas-heading" ref={shellRef}>
      <div className="atlas-heading-row">
        <div>
          <p className="eyebrow">Aurelia · fictional world atlas</p>
          <h2 id="atlas-heading">Live atlas</h2>
          <p className="muted atlas-summary">
            242 fictional aliases · 8 participating agents · neutral regions are scenery only
          </p>
        </div>
        <button type="button" className="quiet-button" onClick={toggleFullscreen} aria-pressed={isFullscreen}>
          {isFullscreen ? 'Exit fullscreen' : 'Fullscreen atlas'}
        </button>
      </div>

      <div className="atlas-tools">
        <form className="atlas-search" onSubmit={(e) => { e.preventDefault(); locateSearch(); }}>
          <label htmlFor="atlas-region-search">Find a region</label>
          <div className="atlas-search-control">
            <input
              id="atlas-region-search"
              type="search"
              list="atlas-region-aliases"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setSearchNotice(''); }}
              placeholder="Search fictional aliases"
              autoComplete="off"
            />
            <datalist id="atlas-region-aliases">
              {regions.map(({ feature }) => <option key={feature.properties.regionId} value={feature.properties.alias} />)}
            </datalist>
            <button type="submit">Locate</button>
          </div>
          <span id="atlas-search-help" className="sr-only">Search aliases, then use arrow keys on a region to browse the map.</span>
        </form>
        <div className="atlas-zoom-tools" aria-label="Map zoom controls">
          <button type="button" onClick={() => zoomBy(1.5)} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => zoomBy(1 / 1.5)} aria-label="Zoom out">−</button>
          <button type="button" onClick={resetZoom}>Reset view</button>
          <span className="atlas-zoom-level" aria-live="polite">{Math.round(transform.k * 100)}%</span>
        </div>
      </div>

      {searchNotice && <p className="atlas-search-notice" role="status">{searchNotice}</p>}
      {loadError && (
        <p className="notice atlas-error" role="alert">
          Atlas unavailable: {loadError}{' '}
          <button type="button" onClick={() => setRetryCount((count) => count + 1)}>Retry map</button>
        </p>
      )}
      {fullscreenError && <p className="notice" role="alert">{fullscreenError}</p>}

      {!topology && !loadError && <p className="muted atlas-loading" role="status">Loading local atlas data…</p>}

      {topology && (
        <>
          <div className="atlas-map-scene">
            <svg
              ref={svgRef}
              viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
              role="group"
              aria-label="Interactive map of fictional regions using Earth-derived reference boundaries"
              className="atlas-svg"
              data-zoom={transform.k.toFixed(2)}
            >
              <title>Fictional Aurelia atlas</title>
              <desc>Search fictional aliases or focus a region and use arrow keys to browse. Regions have Earth-derived boundaries only; no borders change in the simulation.</desc>
              <defs>
                <marker id="atlas-symbol-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M0,0 L8,4 L0,8 Z" className="atlas-symbol-arrowhead" />
                </marker>
              </defs>
              <rect width={MAP_WIDTH} height={MAP_HEIGHT} className="atlas-ocean" />
              <g transform={transform.toString()} className="atlas-world">
                <path d={graticulePath} className="atlas-graticule" aria-hidden="true" />
                {regions.map(({ feature, path }) => {
                  const { regionId, alias, continent, activeNationId } = feature.properties;
                  const isActor = event?.actorId === activeNationId;
                  const isTarget = event?.targetId === activeNationId;
                  const classes = [
                    'atlas-region',
                    activeNationId ? `nation-${activeNationId}` : 'is-neutral',
                    selectedRegionId === regionId ? 'is-selected' : '',
                    isActor ? 'is-event-actor' : '',
                    isTarget ? 'is-event-target' : '',
                  ].filter(Boolean).join(' ');
                  const participation = describeParticipation(feature);

                  return (
                    <path
                      key={regionId}
                      ref={(node) => {
                        if (node) regionNodesRef.current.set(regionId, node);
                        else regionNodesRef.current.delete(regionId);
                      }}
                      d={path}
                      className={classes}
                      role="button"
                      tabIndex={focusedRegionId === regionId ? 0 : -1}
                      aria-label={`${alias}, geographic label ${continent}. ${participation}.`}
                      aria-pressed={selectedRegionId === regionId}
                      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Enter Space Home End"
                      onClick={() => { setSelectedRegionId(regionId); setFocusedRegionId(regionId); }}
                      onKeyDown={(e) => {
                        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
                          e.preventDefault();
                          moveKeyboardFocus(regionId, e.key);
                        } else if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedRegionId(regionId);
                          setFocusedRegionId(regionId);
                        }
                      }}
                    >
                      <title>{alias} · {continent} · {participation}</title>
                    </path>
                  );
                })}

                {eventSymbol?.path && (
                  <path
                    d={eventSymbol.path}
                    className={`atlas-event-link ${eventSymbol.kind}${eventSymbol.severe ? ' is-severe' : ''}${animateEvent ? ' is-animating' : ''}`}
                    markerEnd="url(#atlas-symbol-arrow)"
                    aria-hidden="true"
                  >
                    <title>Illustrative event link only; no route, unit movement, or border change is simulated.</title>
                  </path>
                )}
                {eventSymbol && !eventSymbol.path && (
                  <circle
                    cx={eventSymbol.pulseAt[0]}
                    cy={eventSymbol.pulseAt[1]}
                    r="12"
                    className={`atlas-event-pulse ${eventSymbol.kind}${eventSymbol.severe ? ' is-severe' : ''}${animateEvent ? ' is-animating' : ''}`}
                    aria-hidden="true"
                  />
                )}

                <g className="atlas-agent-markers" aria-hidden="true">
                  {activeRegions.map(({ nationId, region }) => (
                    <g key={nationId} transform={`translate(${region.anchor[0]},${region.anchor[1]})`}>
                      <circle r="8" className={`atlas-agent-marker nation-${nationId}${event?.actorId === nationId || event?.targetId === nationId ? ' is-highlighted' : ''}`} />
                      <text y="3.5" textAnchor="middle" className="atlas-agent-initial">{ACTIVE_NATION_NAMES[nationId][0]}</text>
                    </g>
                  ))}
                  {selectedRegion && regionById.get(selectedRegionId!) && (
                    <circle
                      cx={regionById.get(selectedRegionId!)!.anchor[0]}
                      cy={regionById.get(selectedRegionId!)!.anchor[1]}
                      r="14"
                      className="atlas-focus-ring"
                    />
                  )}
                </g>
              </g>
            </svg>
            <p className="atlas-map-caption" role="note">
              Earth-derived boundary reference · fictional aliases and agents · symbols are illustrative, not simulated routes or movement.
            </p>
          </div>

          <div className="atlas-bottom-grid">
            <section className="atlas-region-detail" aria-labelledby="atlas-region-heading" aria-live="polite">
              <p className="eyebrow">Region details</p>
              {selectedRegion ? (
                <>
                  <h3 id="atlas-region-heading">{selectedRegion.properties.alias}</h3>
                  <p className="muted">Geographic label: {selectedRegion.properties.continent}</p>
                  {selectedRegion.properties.activeNationId ? (
                    <>
                      <p className="atlas-participation-label">
                        Active agent · {ACTIVE_NATION_NAMES[selectedRegion.properties.activeNationId]}
                      </p>
                      <button
                        type="button"
                        onClick={() => onViewNation(selectedRegion.properties.activeNationId!)}
                      >
                        Open {ACTIVE_NATION_NAMES[selectedRegion.properties.activeNationId]} nation detail
                      </button>
                    </>
                  ) : (
                    <p className="muted">Neutral scenery only. This region has no simulation state and cannot originate or receive simulation actions.</p>
                  )}
                </>
              ) : (
                <p className="muted" id="atlas-region-heading">Select or search a fictional region to inspect its role.</p>
              )}
            </section>

            <section className="atlas-legend" aria-labelledby="atlas-legend-heading">
              <p className="eyebrow" id="atlas-legend-heading">Active agents</p>
              <ul>
                {activeRegions.map(({ nationId, region }) => (
                  <li key={nationId}>
                    <span className={`atlas-legend-swatch nation-${nationId}`} aria-hidden="true" />
                    <span>{ACTIVE_NATION_NAMES[nationId]}</span>
                    <span className="muted">{region.feature.properties.alias}</span>
                  </li>
                ))}
                <li className="atlas-neutral-legend">
                  <span className="atlas-legend-swatch is-neutral" aria-hidden="true" />
                  <span>Neutral scenery</span>
                  <span className="muted">not a participant</span>
                </li>
              </ul>
            </section>
          </div>

          {event && (
            <p className="atlas-current-event" role="status">
              {event.severity && (event.severity === 'violent_escalation' || event.severity === 'nuclear_escalation') && (
                <span className="badge severe">Severe fictional event</span>
              )}
              {event.severity ? SEVERITY_TEXT[event.severity] ?? event.severity.replaceAll('_', ' ') : 'Selected event'}
              {' · '}turn {event.turn} · map effects remain illustrative
            </p>
          )}
        </>
      )}
    </section>
  );
}
