import { feature as topologyFeature } from 'topojson-client';
import {
  ACTIVE_NATION_IDS,
  type ActiveNationId,
  type AtlasFeatureCollection,
  type AtlasRegionFeature,
  type AtlasTopology,
} from './types';

const EXPECTED_REGION_COUNT = 242;
const ALLOWED_PROPERTIES = new Set(['activeNationId', 'alias', 'continent', 'regionId', 'visualAnchor']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function assertAtlasTopology(value: unknown): AtlasTopology {
  if (!isRecord(value) || value.type !== 'Topology' || !isRecord(value.objects)) {
    throw new Error('The local atlas asset is not a TopoJSON topology.');
  }
  const regionObject = value.objects['regions'];
  if (!isRecord(regionObject) || regionObject.type !== 'GeometryCollection' || !Array.isArray(regionObject.geometries)) {
    throw new Error('The local atlas asset has no regions geometry collection.');
  }
  if (regionObject.geometries.length !== EXPECTED_REGION_COUNT) {
    throw new Error(`The atlas asset should contain ${EXPECTED_REGION_COUNT} regions.`);
  }

  const regionIds = new Set<string>();
  const aliases = new Set<string>();
  const activeNationIds = new Set<string>();

  for (const geometry of regionObject.geometries) {
    if (!isRecord(geometry) || !['Polygon', 'MultiPolygon'].includes(String(geometry.type)) || 'id' in geometry) {
      throw new Error('The atlas contains an invalid geometry or a source feature ID.');
    }
    if (!isRecord(geometry.properties)) throw new Error('An atlas region has no sanitized properties.');

    const properties = geometry.properties;
    if (Object.keys(properties).some((key) => !ALLOWED_PROPERTIES.has(key))) {
      throw new Error('The atlas contains a property outside the fictional metadata allowlist.');
    }
    if (typeof properties['regionId'] !== 'string' || !/^r_[a-f0-9]{12}$/.test(properties['regionId'])) {
      throw new Error('An atlas region has an invalid opaque ID.');
    }
    if (typeof properties['alias'] !== 'string' || properties['alias'].trim() === '') {
      throw new Error('An atlas region has no fictional alias.');
    }
    if (typeof properties['continent'] !== 'string' || properties['continent'].trim() === '') {
      throw new Error('An atlas region has no geographic continent label.');
    }
    if (regionIds.has(properties['regionId'])) throw new Error('The atlas contains duplicate opaque region IDs.');

    const aliasKey = properties['alias'].normalize('NFKC').trim().toLocaleLowerCase('en');
    if (aliases.has(aliasKey)) throw new Error('The atlas contains duplicate fictional aliases.');

    const activeNationId = properties['activeNationId'];
    if (activeNationId !== null) {
      if (typeof activeNationId !== 'string' || !ACTIVE_NATION_IDS.includes(activeNationId as ActiveNationId)) {
        throw new Error('The atlas contains an unknown active nation ID.');
      }
      if (activeNationIds.has(activeNationId)) throw new Error('An active nation maps to multiple regions.');
      const anchor = properties['visualAnchor'];
      if (!Array.isArray(anchor) || anchor.length !== 2 || !anchor.every((coordinate) => typeof coordinate === 'number')) {
        throw new Error('An active region is missing its curated visual anchor.');
      }
      activeNationIds.add(activeNationId);
    } else if ('visualAnchor' in properties) {
      throw new Error('Neutral scenery must not have a visual anchor.');
    }

    regionIds.add(properties['regionId']);
    aliases.add(aliasKey);
  }

  if (activeNationIds.size !== ACTIVE_NATION_IDS.length ||
      ACTIVE_NATION_IDS.some((nationId) => !activeNationIds.has(nationId))) {
    throw new Error('The atlas must map each of the eight active nations exactly once.');
  }

  return value as unknown as AtlasTopology;
}

export function atlasFeatures(topology: AtlasTopology): AtlasRegionFeature[] {
  const collection = topologyFeature(topology, topology.objects.regions) as AtlasFeatureCollection;
  return collection.features;
}
