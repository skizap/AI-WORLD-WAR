import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoContains } from 'd3-geo';
import { open as openShapefile } from 'shapefile';
import { topology } from 'topojson-server';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const uiDirectory = resolve(scriptDirectory, '..');
const repositoryDirectory = resolve(uiDirectory, '../..');
const sourceDirectory = resolve(repositoryDirectory, 'ne_50m_admin_0_countries');
const sourceShapePath = resolve(sourceDirectory, 'ne_50m_admin_0_countries.shp');
const sourceDbfPath = resolve(sourceDirectory, 'ne_50m_admin_0_countries.dbf');
const sourceVersionPath = resolve(sourceDirectory, 'ne_50m_admin_0_countries.VERSION.txt');
const outputPath = resolve(uiDirectory, 'public/atlas/aurelia-atlas.topo.json');

const EXPECTED_SOURCE_VERSION = '5.1.1';
const EXPECTED_FEATURE_COUNT = 242;
const TOPOLOGY_QUANTIZATION = 1_000_000;
const INSPECT_ONLY = process.argv.includes('--inspect');

const NATION_IDS = ['amber', 'cobalt', 'crimson', 'ivory', 'jade', 'mauve', 'onyx', 'saffron'];

// These coordinates are visual anchors only; they do not feed simulation state or distances.
const VISUAL_ANCHORS = {
  amber: [-105, 40],
  cobalt: [-62, -12],
  crimson: [30, 50],
  ivory: [22, -5],
  jade: [110, 30],
  mauve: [134, -25],
  onyx: [-42, 72],
  saffron: [42, 20],
};

// Filled with the region IDs discovered by `npm run build:atlas -- --inspect`.
const ACTIVE_REGION_IDS = {
  amber: 'r_004fd0210fce',
  cobalt: 'r_f85dcd892b29',
  crimson: 'r_4458a96b53cd',
  ivory: 'r_c64d336d7c94',
  jade: 'r_f9a6dfe6e9c8',
  mauve: 'r_aaa70a3c3524',
  onyx: 'r_c02c73a83ff5',
  saffron: 'r_48ba18060775',
};

const NAME_FIELDS = new Set([
  'ADMIN', 'SOVEREIGNT', 'GEOUNIT', 'SUBUNIT', 'NAME', 'NAME_LONG', 'BRK_NAME',
  'BRK_GROUP', 'ABBREV', 'FORMAL_EN', 'FORMAL_FR', 'NAME_CIAWF', 'NAME_SORT', 'NAME_ALT',
]);

const ALIAS_PREFIXES = [
  'Aven', 'Beler', 'Caelor', 'Dalen', 'Everen', 'Faran', 'Galen', 'Halen', 'Ilyr', 'Joren',
  'Kellen', 'Liora', 'Maren', 'Neris', 'Orrin', 'Paven', 'Quorin', 'Rellan', 'Soren', 'Tavren',
  'Uver', 'Veyra', 'Weldon', 'Xerel', 'Yaren', 'Zorin', 'Arven', 'Brevon', 'Ceryn', 'Dovar',
  'Elorin', 'Fendrel', 'Gavren', 'Hesper', 'Isen', 'Javrin', 'Kestrel', 'Lethen', 'Morven', 'Norlis',
  'Ovel', 'Perrin', 'Rhyven', 'Sable', 'Teren', 'Uldor', 'Vallon', 'Wren', 'Ysolde', 'Zephyr',
];

const ALIAS_SUFFIXES = [
  'ara', 'ia', 'ora', 'en', 'eth', 'on', 'is', 'or', 'el', 'an', 'eon', 'esse', 'alin', 'une', 'ir',
  'ael', 'wyn', 'os', 'un', 'in', 'ar', 'yne', 'ium', 'ess', 'ev', 'ail', 'and', 'ria', 'aine', 'ith',
  'ell', 'arae', 'orin', 'ethra', 'aven', 'orin', 'elle', 'yra', 'aith', 'oren', 'vane', 'mere', 'vale',
  'hollow', 'march', 'haven', 'cairn', 'holm', 'wold', 'shore', 'fen',
];

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function opaqueRegionId(sourceId) {
  return `r_${digest(`natural-earth-${EXPECTED_SOURCE_VERSION}:${sourceId}`).slice(0, 12)}`;
}

function normalize(value) {
  return String(value).replaceAll('\0', '').normalize('NFKC').trim().toLocaleLowerCase('en');
}

function getSourceNames(properties) {
  return Object.entries(properties)
    .filter(([key]) => NAME_FIELDS.has(key) || key.startsWith('NAME_'))
    .map(([, value]) => normalize(value))
    .filter(Boolean);
}

function makeAlias(regionId, usedAliases, sourceNames) {
  const slotCount = ALIAS_PREFIXES.length * ALIAS_SUFFIXES.length;
  const start = Number.parseInt(digest(regionId).slice(0, 8), 16) % slotCount;

  for (let offset = 0; offset < slotCount; offset += 1) {
    const slot = (start + offset) % slotCount;
    const prefix = ALIAS_PREFIXES[Math.floor(slot / ALIAS_SUFFIXES.length)];
    const suffix = ALIAS_SUFFIXES[slot % ALIAS_SUFFIXES.length];
    const alias = `${prefix}${suffix}`;
    const key = normalize(alias);
    if (!usedAliases.has(key) && !sourceNames.has(key)) {
      usedAliases.add(key);
      return alias;
    }
  }

  throw new Error('Fictional alias registry exhausted its unique name space.');
}

function deriveActiveIdsByAnchor(regions) {
  const selected = {};
  const selectedIds = new Set();

  for (const nationId of NATION_IDS) {
    const anchor = VISUAL_ANCHORS[nationId];
    const matches = regions.filter((region) => geoContains(region.geometry, anchor));
    if (matches.length !== 1) {
      throw new Error(`Visual anchor for ${nationId} matched ${matches.length} regions; choose a point inside one feature.`);
    }
    const [region] = matches;
    if (selectedIds.has(region.regionId)) {
      throw new Error(`Visual anchor for ${nationId} duplicates another active region.`);
    }
    selected[nationId] = region.regionId;
    selectedIds.add(region.regionId);
  }

  return selected;
}

function validateActiveIds(regions) {
  const values = Object.values(ACTIVE_REGION_IDS);
  if (values.length !== NATION_IDS.length || values.some((id) => typeof id !== 'string' || !/^r_[a-f0-9]{12}$/.test(id))) {
    throw new Error('Run `npm run build:atlas -- --inspect`, then record each returned ID in ACTIVE_REGION_IDS.');
  }
  if (new Set(values).size !== NATION_IDS.length) {
    throw new Error('Every active nation must map to a unique atlas region.');
  }

  const ids = new Set(regions.map((region) => region.regionId));
  for (const nationId of NATION_IDS) {
    const regionId = ACTIVE_REGION_IDS[nationId];
    const region = regions.find((candidate) => candidate.regionId === regionId);
    if (!ids.has(regionId) || !region) {
      throw new Error(`Active region for ${nationId} is absent from the source dataset.`);
    }
    if (!geoContains(region.geometry, VISUAL_ANCHORS[nationId])) {
      throw new Error(`Curated visual anchor for ${nationId} is outside its explicitly mapped region.`);
    }
  }

  return ACTIVE_REGION_IDS;
}

function validateRuntimeTopology(topologyData) {
  const geometries = topologyData.objects?.regions?.geometries;
  if (topologyData.type !== 'Topology' || !Array.isArray(geometries)) {
    throw new Error('The output is not a TopoJSON topology with a regions object.');
  }
  if (geometries.length !== EXPECTED_FEATURE_COUNT) {
    throw new Error(`Expected ${EXPECTED_FEATURE_COUNT} output regions; got ${geometries.length}.`);
  }

  const aliases = new Set();
  const regionIds = new Set();
  const allowedKeys = new Set(['regionId', 'alias', 'continent', 'activeNationId', 'visualAnchor']);
  let activeCount = 0;

  for (const geometry of geometries) {
    const properties = geometry.properties ?? {};
    const keys = Object.keys(properties);
    if ('id' in geometry) {
      throw new Error('Source feature IDs must not appear in the runtime map asset.');
    }
    if (keys.some((key) => !allowedKeys.has(key))) {
      throw new Error(`Unexpected runtime map property: ${keys.find((key) => !allowedKeys.has(key))}.`);
    }
    if (!properties.regionId || !/^r_[a-f0-9]{12}$/.test(properties.regionId) || regionIds.has(properties.regionId)) {
      throw new Error('Region IDs must be present, opaque, and unique.');
    }
    if (!properties.alias || aliases.has(normalize(properties.alias))) {
      throw new Error('Every feature must have a unique fictional alias.');
    }
    if (typeof properties.continent !== 'string' || !properties.continent) {
      throw new Error(`Region ${properties.regionId} has no geographic continent label.`);
    }
    if (properties.activeNationId !== null) {
      if (!NATION_IDS.includes(properties.activeNationId)) {
        throw new Error(`Unknown active nation ID on ${properties.regionId}.`);
      }
      activeCount += 1;
      if (!Array.isArray(properties.visualAnchor) || properties.visualAnchor.length !== 2) {
        throw new Error(`Active region ${properties.regionId} is missing its visual anchor.`);
      }
    } else if ('visualAnchor' in properties) {
      throw new Error(`Neutral region ${properties.regionId} must not have an active visual anchor.`);
    }
    aliases.add(normalize(properties.alias));
    regionIds.add(properties.regionId);
  }

  if (activeCount !== NATION_IDS.length) {
    throw new Error(`Expected exactly ${NATION_IDS.length} active regions; got ${activeCount}.`);
  }
}

async function readSourceFeatures() {
  const sourceVersion = (await readFile(sourceVersionPath, 'utf8')).trim();
  if (sourceVersion !== EXPECTED_SOURCE_VERSION) {
    throw new Error(`Expected Natural Earth ${EXPECTED_SOURCE_VERSION}; found ${sourceVersion || '(empty version file)'}.`);
  }

  const source = await openShapefile(sourceShapePath, sourceDbfPath, { encoding: 'utf-8' });
  const records = [];
  const sourceNames = new Set();
  const regionIds = new Set();

  while (true) {
    const result = await source.read();
    if (result.done) break;
    const feature = result.value;
    const properties = feature.properties ?? {};
    const sourceId = properties.NE_ID;
    if (sourceId === undefined || sourceId === null || String(sourceId).trim() === '') {
      throw new Error('A source feature is missing the stable NE_ID key.');
    }
    if (!feature.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) {
      throw new Error(`Source feature ${String(sourceId)} is not a polygon.`);
    }

    const regionId = opaqueRegionId(String(sourceId));
    if (regionIds.has(regionId)) throw new Error('Opaque region ID collision detected.');
    regionIds.add(regionId);
    for (const name of getSourceNames(properties)) sourceNames.add(name);

    records.push({
      regionId,
      continent: String(properties.CONTINENT ?? '').replaceAll('\0', '').trim() || 'Unclassified',
      geometry: feature.geometry,
    });
  }

  if (records.length !== EXPECTED_FEATURE_COUNT) {
    throw new Error(`Expected ${EXPECTED_FEATURE_COUNT} source features; got ${records.length}.`);
  }

  records.sort((left, right) => left.regionId.localeCompare(right.regionId));
  const usedAliases = new Set();
  for (const record of records) record.alias = makeAlias(record.regionId, usedAliases, sourceNames);
  return records;
}

const regions = await readSourceFeatures();
const activeIds = INSPECT_ONLY ? deriveActiveIdsByAnchor(regions) : validateActiveIds(regions);

if (INSPECT_ONLY) {
  for (const nationId of NATION_IDS) {
    const region = regions.find((candidate) => candidate.regionId === activeIds[nationId]);
    console.log(`${nationId}: ${region.regionId} | ${region.alias} | ${region.continent} | anchor ${VISUAL_ANCHORS[nationId].join(', ')}`);
  }
  console.log(`Inspected ${regions.length} source features; no output file written.`);
} else {
  const nationByRegion = new Map(Object.entries(activeIds).map(([nationId, regionId]) => [regionId, nationId]));
  const features = regions.map((region) => {
    const activeNationId = nationByRegion.get(region.regionId) ?? null;
    return {
      type: 'Feature',
      properties: {
        regionId: region.regionId,
        alias: region.alias,
        continent: region.continent,
        activeNationId,
        ...(activeNationId ? { visualAnchor: VISUAL_ANCHORS[activeNationId] } : {}),
      },
      geometry: region.geometry,
    };
  });

  const topologyData = topology({
    regions: { type: 'FeatureCollection', features },
  }, TOPOLOGY_QUANTIZATION);
  validateRuntimeTopology(topologyData);

  const serialized = `${JSON.stringify(topologyData)}\n`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, 'utf8');
  console.log(`Wrote ${regions.length} fictional atlas regions (${Buffer.byteLength(serialized)} bytes) to ${outputPath}.`);
  for (const nationId of NATION_IDS) {
    const region = regions.find((candidate) => candidate.regionId === activeIds[nationId]);
    console.log(`${nationId}: ${region.regionId} | ${region.alias} | ${region.continent}`);
  }
}
