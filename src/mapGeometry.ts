import {geoMercator,geoNaturalEarth1,geoInterpolate,geoPath,type GeoProjection} from 'd3-geo';
import type {FeatureCollection,MultiPolygon,MultiLineString} from 'geojson';
import {displayArc,routeGeometry,type Flight} from './domain.ts';

export type ChinaMap=FeatureCollection<MultiPolygon>&{boundary_layers:{outline:MultiLineString;provinces:MultiLineString;special:FeatureCollection<MultiLineString>}};
export type MapMode='china'|'world';
export const isChinaRegion=(code:string)=>['CN','HK','MO','TW'].includes(code);
export const automaticMapMode=(flights:Flight[]):MapMode=>flights.some(f=>!isChinaRegion(f.origin_airport.country)||!isChinaRegion(f.destination_airport.country))?'world':'china';
export function mapProjection(mode:MapMode,flights:Flight[]=[],fit=false){
  if(mode==='world'){
    const p=geoNaturalEarth1().rotate([-150,0]).fitExtent([[24,34],[1076,520]],{type:'Sphere'});
    if(fit&&flights.length)p.fitExtent([[100,85],[1000,470]],{type:'FeatureCollection',features:flights.map(f=>({type:'Feature',properties:{},geometry:routeGeometry(f.origin_airport,f.destination_airport)}))});
    return p;
  }
  const p=geoMercator().fitExtent([[125,40],[990,500]],{type:'MultiPoint',coordinates:[[73.498962,18],[135.087387,53.558498]]});
  const airports=[...new Map(flights.flatMap(f=>[f.origin_airport,f.destination_airport]).map(a=>[a.code,a])).values()];
  if(fit&&airports.length>1)p.fitExtent([[105,85],[995,470]],{type:'MultiPoint',coordinates:airports.map(a=>[a.longitude,a.latitude])});
  return p;
}
export function mapRoute(f:Flight,projection:GeoProjection,mode:MapMode){
  if(mode==='china'){
    const start=projection([f.origin_airport.longitude,f.origin_airport.latitude]),end=projection([f.destination_airport.longitude,f.destination_airport.latitude]);
    return start&&end?displayArc(start,end):null;
  }
  // D3 clips spherical lines at the projection seam; never join distant edge points with a screen-space line.
  const path=geoPath(projection)(routeGeometry(f.origin_airport,f.destination_airport));if(!path)return null;
  const at=geoInterpolate([f.origin_airport.longitude,f.origin_airport.latitude],[f.destination_airport.longitude,f.destination_airport.latitude]);
  for(const t of [.68,.35,.5]){
    const a=projection(at(t-.003)),b=projection(at(t+.003)),arrow=projection(at(t));
    if(a&&b&&arrow&&Math.abs(b[0]-a[0])<500)return {path,arrow,angle:Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI};
  }
  return null;
}
