// ============================================================================
// src/gis_fetch/overpass_ql_builder.js
// Full-Fidelity Unstripped Overpass QL Query Builder (< 1,800 UTF-8 Bytes)
// Layer 1 (Pure stateless string builder — zero internal module dependencies)
// ============================================================================

(function (root) {
  const _MP_EXCL_CONTINENTAL =
    '[!building][!"building:part"][!route][!boundary][!restriction]' +
    '[natural!~"^(bay$|stra|peninsula|cape|moun|mass|dese|vall|sea$|ridg)"]' +
    '[place!~"^(sea$|ocea|peni|arch|cont|coun|stat|regi)"]';
  const _BR_VAL_RE = '^(yes|via|aqu|boa|can|cov|mov|sus|tre)';
  const _MAJ_HWY_CORE = 'motor|(trun|prim|seco|tert).*|uncl|resi|livi';

  function estimateOverpassQlBytes(query) {
    const str = String(query || '');
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str).byteLength;
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.byteLength(str, 'utf8');
    }
    return str.length;
  }

  function buildAdaptiveOverpassQL(south, west, north, east, lodTier = 'detail', timeoutSec = 20, lodOptions = null) {
    const bbox = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
    const wantTrees = (lodOptions && typeof lodOptions.wantTrees === 'boolean')
      ? lodOptions.wantTrees
      : (lodTier === 'detail' || lodTier === 'urban');
    const minBldM = (lodOptions && typeof lodOptions.minBuildingFootprintM === 'number')
      ? lodOptions.minBuildingFootprintM
      : 0;
    const roadDetail = (lodOptions && lodOptions.roadDetail) || 'all';

    const head =
      `[out:json][timeout:${timeoutSec}][bbox:${bbox}];way->.bw;rel(bw.bw)->.a;(.bw;.a;)->.c;` +
      `nw["bridge:support"]->.s;` +
      `(rel.a[type~"^(building|bridge)$"];rel.a[~"^(building(:part)?$|bridge:s)"~"."];wr.c[~"^(man_|attr)"~"^(bridge$|.*_wheel$)"];)->.k;rel.k->.b;rel(r.b)->.r;` +
      `rel.a[type=multipolygon]${_MP_EXCL_CONTINENTAL}->.mpr;(.bw;.mpr;)->.u;` +
      `wr.u[place~"^(isl|square$)"]->.i;rel.i->.isl;way(r.isl)->.islw;`;

    const treeN = ((lodTier === 'regional' || lodTier === 'mountain') ? (lodOptions && lodOptions.wantTrees === true) : wantTrees)
      ? 'node[natural=tree];'
      : '';
    const nwL2 = `nw[man_made][man_made~"^(wind_|(comm.*)?tower$|mast$|light|chim|cran)"]->.n;`;
    const foot = `(.r;.w;${treeN}node[power=generator][~":source$"~"^wind$"];node(r.b););out body qt;node(w.w);out skel qt;`;
    const bldClause = minBldM <= 0
      ? `way.bw[building];`
      : `way.bw[building][building!~"^(shed$|gara|hut$|cabi|kios|(all.*|green)house$|sty$|static|ger$)"];`;

    if (lodTier === 'detail') {
      const hwy = roadDetail === 'major'
        ? `way.bw[highway~"^(${_MAJ_HWY_CORE}|pede)"];way.bw[highway][bridge~"${_BR_VAL_RE}"];`
        : `way.bw[highway];`;
      const shared = `(wr.u[~"^(water(way)?|area:highway|building:p)"~"."];wr.u[~"^(natural|man_made|railway|public_transport)$"~"^(water$|wood$|scru|grass|heat|wetl|beach$|shin|shoa|mud$|bare|quay|pier|pont|brea|groy|jett|platf)"];rel.mpr[~"^(landuse|leisure|highway)$"~"^(reser|basi|fore|grass$|mead|(dog_)?park$|recr|ceme|vill|allo|farml|orch|vine|gard|natu|pitc|play|commo|golf|mari|swim.*p|pede)"];)->.x;`;
      const ways = `(.k;.i;.x;.s;.n;way.bw[~"^(building|landuse|leisure|railway)$"~"."];way.bw[~"^(natural|amenity|power|man_made)$"~"^(coast|tree_|fountain$|gener|(cool|stor).*_|silo$)"];${hwy}way(r.b);way(r.r);.islw;way.bw(r.x);)->.w;`;
      return head + nwL2 + shared + ways + foot;
    }

    if (lodTier === 'urban') {
      const hwy = roadDetail === 'major'
        ? `way.bw[highway~"^(${_MAJ_HWY_CORE}|pede)"];way.d[highway];`
        : `way.bw[highway~"^(${_MAJ_HWY_CORE}|pede|service$|cycl|foot|path$|step|trac|brid|corr)"];`;
      const brd = `way.bw[bridge~"${_BR_VAL_RE}"]->.d;`;
      const shared = `(wr.u[~"^(water(way)?|area:highway|building:p)"~"."];wr.u[highway=pedestrian];wr.u[~"^(natural|landuse|leisure|man_made|railway|public_transport)$"~"^(water$|wood$|scru|grass|heat|wetl|beach$|shin|shoa|mud$|bare|reser|basi|fore|mead|(dog_)?park$|recr|ceme|vill|allo|farml|orch|vine|gard|natu|pitc|play|commo|golf|mari|swim.*p|quay|pier|pont|brea|groy|jett|platf)"];)->.x;`;
      const ways = `${brd}(.k;.i;.x;.s;.n;${bldClause}${hwy}way.bw[~"^(natural|amenity|railway|power|man_made)$"~"^(coast|tree_|fountain$|(light_)?rail$|tram$|narro|funic|gener|(cool|stor).*_|silo$)"];way.d[railway~"^(mono|subw)"];way(r.b);way(r.r);.islw;way.bw(r.x);)->.w;`;
      return head + nwL2 + shared + ways + foot;
    }

    // Regional & wide-span ('mountain') tiers: zero artificial stripping of buildings, building:part, streets, or parks.
    const natPart = (lodOptions && lodOptions.wantTrees === true) ? 'coast|tree_' : 'coast';
    const hwy = roadDetail === 'major'
      ? `way.bw[highway~"^(${_MAJ_HWY_CORE}|pede)"];`
      : `way.bw[highway~"^(${_MAJ_HWY_CORE}|pede|service$|path$|cycl|step|trac|brid|corr)"];way.bw[highway=footway][footway!~"^(sid|cro|acc|isl)"];`;
    const brd = `way.bw[bridge~"${_BR_VAL_RE}"]->.d;`;
    const shared = `(wr.u[~"^(water(way)?|area:highway|building:p)"~"."];wr.u[~"^(nat|lan|lei|man_|railw|pub)"~"^(water$|wood$|scru|grass|heat|wetl|beach$|shin|shoa|mud$|bare|reser|basi|fore|mead|(dog_)?park$|recr|ceme|vill|allo|farml|orch|vine|gard|natu|pitc|play|commo|golf|mari|swim.*p|quay|pier|pont|brea|groy|jett|platf)"];rel.mpr[highway=pedestrian];)->.x;`;
    const ways = `${brd}(.k;.i;.x;.s;.n;${bldClause}${hwy}way.d[highway];way.bw[~"^(nat|amen|railw|pow|man_)"~"^(${natPart}|fountain$|(light_)?rail$|tram$|narro|funic|gener|(cool|stor).*_|silo$)"];way.d[railway~"^(mono|subw)"];way(r.b);way(r.r);.islw;way.bw(r.x);)->.w;`;
    return head + nwL2 + shared + ways + foot;
  }

  const exportsObj = {
    buildAdaptiveOverpassQL,
    estimateOverpassQlBytes,
  };

  Object.assign(root, exportsObj);
  if (typeof window !== 'undefined') Object.assign(window, exportsObj);
  if (typeof module !== 'undefined' && module.exports) module.exports = exportsObj;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
