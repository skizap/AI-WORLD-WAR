import type { Feature, FeatureCollection, MultiPolygon as GeoJSONMultiPolygon, Polygon as GeoJSONPolygon } from 'geojson';
import type { GeometryCollection, MultiPolygon, Polygon, Topology } from 'topojson-specification';

export const ACTIVE_NATION_IDS = ['amber', 'cobalt', 'crimson', 'ivory', 'jade', 'mauve', 'onyx', 'saffron'] as const;
export type ActiveNationId = (typeof ACTIVE_NATION_IDS)[number];

export const ACTIVE_NATION_NAMES: Record<ActiveNationId, string> = {
  amber: 'Amber',
  cobalt: 'Cobalt',
  crimson: 'Crimson',
  ivory: 'Ivory',
  jade: 'Jade',
  mauve: 'Mauve',
  onyx: 'Onyx',
  saffron: 'Saffron',
};

export interface AtlasRegionProperties {
  regionId: string;
  alias: string;
  continent: string;
  activeNationId: ActiveNationId | null;
  visualAnchor?: [number, number];
}

export type AtlasTopoGeometry = Polygon<AtlasRegionProperties> | MultiPolygon<AtlasRegionProperties>;
export type AtlasGeometryCollection = GeometryCollection<AtlasRegionProperties> & {
  geometries: AtlasTopoGeometry[];
};
export type AtlasTopology = Topology<{ regions: AtlasGeometryCollection }>;

export type AtlasRegionFeature = Feature<GeoJSONPolygon | GeoJSONMultiPolygon, AtlasRegionProperties>;
export type AtlasFeatureCollection = FeatureCollection<GeoJSONPolygon | GeoJSONMultiPolygon, AtlasRegionProperties>;

export interface ProjectedAtlasRegion {
  feature: AtlasRegionFeature;
  path: string;
  anchor: [number, number];
}
