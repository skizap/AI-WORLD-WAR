import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type RegionProperties = {
  regionId: string;
  alias: string;
  continent: string;
  activeNationId: string | null;
  visualAnchor?: [number, number];
};

type AtlasGeometry = {
  type: string;
  arcs: unknown;
  properties: RegionProperties;
  id?: string | number;
};

const atlas = JSON.parse(
  readFileSync(new URL('../public/atlas/aurelia-atlas.topo.json', import.meta.url), 'utf8'),
) as { type: string; objects: { regions: { geometries: AtlasGeometry[] } } };
const geometries = atlas.objects.regions.geometries;

describe('fictional atlas data', () => {
  it('preserves all 242 source features with unique opaque IDs and aliases', () => {
    expect(atlas.type).toBe('Topology');
    expect(geometries).toHaveLength(242);
    expect(new Set(geometries.map(({ properties }) => properties.regionId)).size).toBe(242);
    expect(new Set(geometries.map(({ properties }) => properties.alias.toLowerCase())).size).toBe(242);
    expect(geometries.every(({ properties }) => /^r_[a-f0-9]{12}$/.test(properties.regionId))).toBe(true);
    expect(geometries.every(({ type, arcs }) => ['Polygon', 'MultiPolygon'].includes(type) && arcs)).toBe(true);
  });

  it('maps eight distinct fictional agents and marks every other region neutral', () => {
    const activeNationIds = geometries
      .map(({ properties }) => properties.activeNationId)
      .filter((nationId): nationId is string => nationId !== null)
      .sort();

    expect(activeNationIds).toEqual(['amber', 'cobalt', 'crimson', 'ivory', 'jade', 'mauve', 'onyx', 'saffron']);
    expect(geometries.filter(({ properties }) => properties.activeNationId === null)).toHaveLength(234);
    expect(geometries.filter(({ properties }) => properties.activeNationId !== null)
      .every(({ properties }) => properties.visualAnchor?.length === 2)).toBe(true);
  });

  it('contains only the allowlisted fictional and geographic properties', () => {
    const allowedKeys = ['activeNationId', 'alias', 'continent', 'regionId', 'visualAnchor'];
    for (const geometry of geometries) {
      expect(geometry.id).toBeUndefined();
      expect(Object.keys(geometry.properties).sort()).toEqual(
        Object.keys(geometry.properties).filter((key) => allowedKeys.includes(key)).sort(),
      );
      expect(geometry.properties.continent).not.toMatch(/\0/);
      expect(geometry.properties.alias).not.toMatch(/\0/);
    }
  });
});
