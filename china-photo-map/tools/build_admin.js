// 生成省 / 地级 / 县级三层边界（TopoJSON，三层共用一套弧线，边界严丝合缝）。
//
// 输入：
//   COUNTIES_DIR  echarts-china-counties-js@1.0.2 的 package/src 目录（几何，约 2017–2018 年区划）
//   ZONING_JSON   zoningjs@3.2025.0 的 package/0.json（民政部 2025 年县以上区划代码，用于更正名称与归属）
// 输出：
//   OUT_JS        window.CHINA_TOPO = {...}
//   REPORT        对账报告（哪些县是改名匹配的、哪些没匹配上、哪些新县没有几何）
//
// 用法：node build_admin.js COUNTIES_DIR ZONING_JSON OUT_JS REPORT
// 依赖：topojson-server@3.0.1 topojson-simplify@3.0.3 topojson-client@3.1.0 opencc-js@1.0.5

const fs = require('fs');
const path = require('path');
const { topology } = require('topojson-server');
const { presimplify, simplify, quantile } = require('topojson-simplify');
const { quantize } = require('topojson-client');
const OpenCC = require('opencc-js');
const t2s = OpenCC.Converter({ from: 'tw', to: 'cn' });

const [SRC, ZONING, OUT, REPORT] = process.argv.slice(2);
const KEEP = Number(process.env.KEEP || 0.02); // 保留的点比例（按 Visvalingam 权重分位）

// ---------- 2025 区划代码 ----------
const z = JSON.parse(fs.readFileSync(ZONING, 'utf8'));
const provName = {}, cityName = {}, countyName = {}, countyParent = {};
for (const { c, n } of z['0']) provName[String(c)] = n;
for (const p of Object.keys(provName)) for (const { c, n } of (z[p] || [])) {
  cityName[String(c)] = n;
  for (const k of (z[String(c)] || [])) {
    const code = String(k.c);
    if (code.length !== 6) continue;
    countyName[code] = k.n; countyParent[code] = String(c);
  }
}
const MUNI = new Set(['11', '12', '31', '50', '81', '82']);
const cityStem = (n) => n.replace(/(市|地区|盟|自治州)$/, '').replace(/(布依族|苗族|侗族|土家族|彝族|藏族|羌族|回族|蒙古族|朝鲜族|哈尼族|傣族|景颇族|白族|傈僳族|壮族|哈萨克族|柯尔克孜族|蒙古|黎族)+$/, '');
// 已确认的跨地级划转（旧所属/旧名 → 新所属地级名）
// 2017 年后一对一改名，或整体并入另一个现有单元（几何可直接沿用 / 合并）。
// 只收录确定的；拆分重划的（大同城区/矿区/南郊区、长治城区/郊区、伊春 2019 年调整、杭州江干区、邢台县等）
// 不收录，保留旧名并标记“旧区划”。
const RENAMES = {
  '宜宾市/宜宾县': '叙州区', '芜湖市/芜湖县': '湾沚区', '大同市/大同县': '云州区', '长治市/长治县': '上党区',
  '南宁市/横县': '横州市', '上饶市/上饶县': '广信区', '九江市/九江县': '柴桑区', '唐山市/滦县': '滦州市',
  '邢台市/任县': '任泽区', '株洲市/株洲县': '渌口区', '三明市/沙县': '沙县区', '那曲地区/那曲县': '色尼区',
  '六盘水市/盘县': '盘州市', '咸阳市/彬县': '彬州市',
  '南通市/港闸区': '崇川区', '南昌市/湾里区': '新建区', '洛阳市/吉利区': '孟津区', '烟台市/长岛县': '蓬莱区',
  '三明市/梅列区': '三元区', '杭州市/下城区': '拱墅区', '芜湖市/三山区': '弋江区',
};
const TRANSFERS = {
  '四平市/公主岭市': '长春市',
  '莱芜市/莱城区': '济南市',
  '莱芜市/钢城区': '济南市',
};
const shortProv = (n) => n.replace(/(省|市|壮族自治区|回族自治区|维吾尔自治区|自治区|特别行政区)$/, '');
const isDirectCounty = (city4) => /直辖县级/.test(cityName[city4] || '');

// 县级单元 → 所属“地级单元”的 key 与名字
function cityKeyOf(code6) {
  const p = code6.slice(0, 2), c4 = code6.slice(0, 4);
  if (MUNI.has(p)) return { key: p + '00', name: shortProv(provName[p]) };
  if (isDirectCounty(c4)) return { key: code6, name: countyName[code6] };
  return { key: c4, name: cityName[c4] || null };
}

// ---------- 读取旧几何 ----------
const stem = (n) => n.replace(/(各族自治县|自治县|自治旗|林区|特区|新区|区|县|市|旗)$/, '').replace(/(土家族|苗族|侗族|黎族|彝族|藏族|羌族|回族|蒙古族|满族|壮族|瑶族|白族|傣族|哈尼族|傈僳族|佤族|拉祜族|纳西族|布依族|水族|仡佬族|畲族|土族|撒拉族|东乡族|保安族|裕固族|哈萨克族|塔吉克族|锡伯族|达斡尔族|鄂温克族|鄂伦春族|朝鲜族|毛南族|仫佬族|各族|普米族|怒族|独龙族|景颇族|阿昌族|德昂族|基诺族|布朗族)+$/, '');
const provDirs = fs.readdirSync(SRC).filter(d => fs.statSync(path.join(SRC, d)).isDirectory());
const old = [];
for (const pd of provDirs) for (const cd of fs.readdirSync(path.join(SRC, pd))) {
  const cdir = path.join(SRC, pd, cd);
  if (!fs.statSync(cdir).isDirectory()) continue;
  for (const f of fs.readdirSync(cdir).filter(f => f.endsWith('.geojson'))) {
    const fc = JSON.parse(fs.readFileSync(path.join(cdir, f), 'utf8'));
    // 数据里金门同时出现在“福建/泉州市/金门县”和“台湾/金门县/各乡镇”，几何重叠；按 2025 区划代码保留前者。
    if (pd === '台湾' && t2s(cd) === '金门县') continue;
    for (const feat of fc.features) {
      if (!feat.geometry) continue;
      old.push({ dirProv: pd, dirCity: t2s(cd), name: t2s(feat.properties.name || f.replace('.geojson', '')), id: String(feat.id || ''), geometry: feat.geometry });
    }
  }
}

// ---------- 对账 ----------
const provByShort = {};
for (const [c, n] of Object.entries(provName)) provByShort[shortProv(n)] = c;
provByShort['直辖市'] = null;
const countiesByProv = {};
for (const code of Object.keys(countyName)) (countiesByProv[code.slice(0, 2)] ||= []).push(code);
// 不设区的地级市（东莞、中山、儋州、嘉峪关）：没有县级子单元，地级本身当作县级单元
const citiesWithoutCounties = Object.keys(cityName).filter(c4 => !Object.keys(countyName).some(k => k.startsWith(c4)) && c4.length === 4 && c4.slice(2) !== '00');

const report = { byCode: 0, byName: [], unmatched: [], ambiguous: [] };
for (const o of old) {
  let p = provByShort[o.dirProv];
  if (p === null || p === undefined) p = provByShort[o.dirCity] || o.id.slice(0, 2);
  o.prov = p;
  let code = null;
  // 马祖（数据中位于“台湾/连江县”）按 2025 区划代码属福州市连江县
  if (o.dirProv === '台湾' && o.dirCity === '连江县') { o.prov = p = '35'; code = '350122'; report.byName.push(`台湾/连江县/${o.name} → 福州市连江县(350122)`); }
  if (!code && countyName[o.id] && o.id.slice(0, 2) === p) { code = o.id; report.byCode++; }
  if (!code && cityName[o.id.slice(0, 4)] && citiesWithoutCounties.includes(o.id.slice(0, 4)) && o.name === cityName[o.id.slice(0, 4)]) {
    code = o.id.slice(0, 4) + '00'; countyName[code] = o.name; countyParent[code] = o.id.slice(0, 4); report.byCode++;
  }
  if (!code && RENAMES[o.dirCity + '/' + o.name]) {
    const want = RENAMES[o.dirCity + '/' + o.name];
    const hit = (countiesByProv[p] || []).filter(k => countyName[k] === want && cityStem(cityName[k.slice(0, 4)] || '') === cityStem(o.dirCity));
    if (hit.length === 1) { code = hit[0]; report.byName.push(`${o.dirProv}/${o.dirCity}/${o.name} → ${countyName[code]}(${code}) [白名单]`); }
  }
  // 地级市本身作为一块几何（三沙市、不设区的地级市）
  if (!code && /00$/.test(o.id) && cityName[o.id.slice(0, 4)] && cityStem(cityName[o.id.slice(0, 4)]) === cityStem(o.name)) {
    code = o.id; countyName[code] = cityName[o.id.slice(0, 4)]; countyParent[code] = o.id.slice(0, 4); report.byCode++;
  }
  if (!code) {
    const s = o.dirCity === '莱芜市' && o.name === '莱城区' ? '莱芜' : stem(o.name);
    const oc = cityStem(o.dirCity);
    // 只在同一个地级（或其改名后的继任者）里按名称找，避免“城区/郊区/矿区”这类通名跨市误配
    let cands = (countiesByProv[p] || []).filter(k => stem(countyName[k]) === s && (
      MUNI.has(p) || isDirectCounty(k.slice(0, 4)) || cityStem(cityName[k.slice(0, 4)] || '') === oc ||
      (TRANSFERS[o.dirCity + '/' + o.name] === cityName[k.slice(0, 4)])));
    if (cands.length === 1) { code = cands[0]; report.byName.push(`${o.dirProv}/${o.dirCity}/${o.name}(${o.id}) → ${cityName[code.slice(0, 4)] || ''}${countyName[code]}(${code})`); }
    else if (cands.length > 1) report.ambiguous.push(`${o.dirProv}/${o.dirCity}/${o.name}: ${cands.map(k => countyName[k] + k).join(',')}`);
  }
  if (!code) {
    // 找不到对应：保留旧名，用旧 id 作为代码，挂在旧地级下
    report.unmatched.push(`${o.dirProv}/${o.dirCity}/${o.name}(${o.id})`);
    code = 'old' + (o.id || o.prov + o.dirCity + o.name);
    countyName[code] = o.name;
    // 港澳台按原名；大陆省份里没对上的说明 2017 年后被拆分重划，标记出来
    o.outdated = !['71', '81', '82'].includes(o.prov) && o.name !== '东沙群岛';
    o.fallbackCity = o.dirCity;
  }
  o.code = code;
}
const used = new Set(old.map(o => o.code));
report.missingGeometry = Object.keys(countyName).filter(k => !k.startsWith('old') && !used.has(k) && !['71', '81', '82'].includes(k.slice(0, 2)))
  .map(k => `${cityName[k.slice(0, 4)] || ''}${countyName[k]}(${k})`);

// ---------- 拓扑与简化 ----------
const fc = { type: 'FeatureCollection', features: old.map((o, i) => ({ type: 'Feature', id: i, properties: {}, geometry: o.geometry })) };
let topo = topology({ all: fc }, 1e5);
topo = presimplify(topo);
topo = quantize(simplify(topo, quantile(topo, KEEP)), 1e5);
const geoms = topo.objects.all.geometries;

// 只输出县级几何（每个旧要素一条，属性写上 2025 代码/名称/所属地级/省）。
// 地级与省的形状在浏览器里由同一批县级多边形组合而成，边界线用 topojson.mesh 取，
// 不在这里 mergeArcs：源数据相邻县之间有细小缝隙/重叠，mergeArcs 会把环接错，画出横穿全省的直线。
const cityMeta = {};
for (const o of old) {
  const ck = o.code.startsWith('old') ? { key: 'old' + o.prov + o.fallbackCity, name: o.fallbackCity } : cityKeyOf(o.code);
  cityMeta[ck.key] ||= { n: null, p: o.prov };
  if (!cityMeta[ck.key].n) cityMeta[ck.key].n = ck.name || o.dirCity;
  o.cityKey = ck.key;
}
const out = { type: 'Topology', transform: topo.transform, arcs: topo.arcs, objects: {} };
out.objects.counties = {
  type: 'GeometryCollection',
  geometries: geoms.map((g, i) => {
    if (!g.type) return null;
    const o = old[i];
    const props = { k: o.code, n: countyName[o.code], c: o.cityKey, p: o.prov };
    if (o.outdated) props.old = 1;
    return { ...g, id: undefined, properties: props };
  }).filter(Boolean),
};
const used2 = new Set(out.objects.counties.geometries.map(g => g.properties.c));
out.names = {
  p: Object.fromEntries(Object.keys(provName).map(k => [k, shortProv(provName[k])])),
  c: Object.fromEntries(Object.entries(cityMeta).filter(([k]) => used2.has(k)).map(([k, v]) => [k, v.n])),
};
const uniq = (f) => new Set(out.objects.counties.geometries.map(g => g.properties[f])).size;

const js = '// 自动生成，勿手改。见 tools/build_admin.js 与 README「地图数据」。\nwindow.CHINA_TOPO = ' + JSON.stringify(out) + ';\n';
fs.writeFileSync(OUT, js);
const lines = [
  `旧几何要素: ${old.length}`, `按代码直接匹配: ${report.byCode}`, `按名称匹配（改名/升格/划转）: ${report.byName.length}`,
  `多义未决: ${report.ambiguous.length}`, `未匹配（保留旧名）: ${report.unmatched.length}`, `2025 有、几何缺失: ${report.missingGeometry.length}`,
  `输出: 省 ${uniq('p')} / 地级 ${uniq('c')} / 县级 ${uniq('k')}（几何 ${out.objects.counties.geometries.length} 条），${(js.length / 1048576).toFixed(2)} MB`,
  '', '## 按名称匹配', ...report.byName, '', '## 多义未决', ...report.ambiguous, '', '## 未匹配', ...report.unmatched, '', '## 2025 有、几何缺失', ...report.missingGeometry,
];
fs.writeFileSync(REPORT, lines.join('\n') + '\n');
console.log(lines.slice(0, 7).join('\n'));
