/*
  Quick catalog validator for MongopPcPartPicker.
  Usage:
    node tools/validate_catalog.js

  Goals:
  - Detect items that would become unusable due to null/inconsistent inferred fields
    (CPU socket, motherboard RAM type, missing lengths, etc.).
  - Highlight compatibility gaps between datasets (CPU<->Motherboard sockets, RAM gen).
*/

const path = require('path');
const fs = require('fs');

function readJsonArray(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Expected array in ${filePath}`);
  }
  return parsed;
}

function normalizeSpaces(s) {
  return (s || '').toString().replace(/\s+/g, ' ').trim();
}

function detectCpuSocket(cpuName) {
  var name = (cpuName || "").toString();

  // --- AMD (special cases) ---
  if (name.indexOf("Threadripper") >= 0) return "sTRX4";

  if (name.indexOf("Athlon") >= 0) return "AM4";
  if (name.match(/\bFX-\d{4}/i)) return "AM3+";

  var epyc = name.match(/\bEPYC\s+(\d{4})/i);
  if (epyc && epyc[1]) {
    var epycSeries = parseInt(epyc[1], 10);
    if (!isNaN(epycSeries) && epycSeries >= 4000 && epycSeries < 5000) return "AM5";
    return "SP3";
  }

  if (name.indexOf("Phenom") >= 0) return "AM3";

  var aSeries = name.match(/\bA(?:4|6|8|10|12)-(\d{4})/i);
  if (aSeries && aSeries[1]) {
    var aNum = parseInt(aSeries[1], 10);
    if (!isNaN(aNum)) {
      if (aNum >= 9000) return "AM4";
      if (aNum >= 7000) return "FM2+";
      if (aNum >= 6000) return "FM2";
      return "FM1";
    }
  }

  if (name.match(/^AMD\s+5350\b/i)) return "AM1";

  // --- AMD ---
  // Logic: Ryzen 7000+ is AM5, everything older defaults to AM4
  if (name.indexOf("Ryzen") >= 0) {
      var m = name.match(/Ryzen\s+\d+\s+(\d{4})/i);
      // Threadripper (optional): avoid mis-detecting as AM4/AM5
      if (name.indexOf("Threadripper") >= 0) return "sTRX4";

      if (m && m[1]) {
          var series = parseInt(m[1], 10);
          if (!isNaN(series) && series >= 7000) return "AM5";
      }
      // Default for older Ryzen (1000-5000)
      return "AM4";
  }

    // --- Intel ---
    var ultra = name.match(/Core\s+Ultra\s+\d+\s+(\d{3})/i);
    if (ultra && ultra[1]) {
      var ultraModel = parseInt(ultra[1], 10);
      if (!isNaN(ultraModel) && ultraModel >= 200) return "LGA1851";
    }

    var pentiumE = name.match(/Pentium\s+E(\d{4})/i);
    if (pentiumE && pentiumE[1]) return "LGA775";

    if (name.indexOf("Core 2") >= 0) return "LGA775";

    var celeronE = name.match(/Celeron\s+E(\d{4})/i);
    if (celeronE && celeronE[1]) return "LGA775";
    var celeronNum = name.match(/Celeron\s+(\d{3})\b/i);
    if (celeronNum && celeronNum[1]) return "LGA775";

    if (name.match(/\bIntel\s+300\b/i) || name.match(/\bProcessor\s+300\b/i)) return "LGA1700";

    var xeonE5 = name.match(/Xeon\s+E5-\d{4}\s+V([1-4])/i);
    if (xeonE5 && xeonE5[1]) {
      var v = parseInt(xeonE5[1], 10);
      if (v >= 3) return "LGA2011-3";
      return "LGA2011";
    }
    if (name.match(/Xeon\s+E5-\d{4}/i)) return "LGA2011";

    var xeonE3 = name.match(/Xeon\s+E3-\d{4}[A-Z]*\s+V([1-6])/i);
    if (xeonE3 && xeonE3[1]) {
      var ev = parseInt(xeonE3[1], 10);
      if (ev >= 5) return "LGA1151";
      if (ev >= 3) return "LGA1150";
      return "LGA1155";
    }

    var xeonE = name.match(/Xeon\s+E-(\d{4})/i);
    if (xeonE && xeonE[1]) {
      var eNum = parseInt(xeonE[1], 10);
      if (!isNaN(eNum) && eNum >= 2100 && eNum < 2300) return "LGA1151";
    }

    var g = name.match(/\b(CELERON|PENTIUM(?:\s+GOLD)?)\s+G(\d{3,4})[A-Z]*\b/i);
    if (g && g[2]) {
      var gNum = parseInt(g[2], 10);
      if (!isNaN(gNum)) {
        if (g[2].length === 4) {
          if (gNum >= 6900) return "LGA1700";
          if (gNum >= 5900) return "LGA1200";
          if (gNum >= 3000) return "LGA1151";
          if (gNum >= 1000) return "LGA1155";
        } else {
          if (gNum >= 500) return "LGA1155";
        }
      }
    }

    // Extended logic: capture digits after i3/i5/i7/i9 and map to socket
    var intel = name.match(/i[3579]-?(\d{2,5})/i);
    if (intel && intel[1]) {
      var modelNumber = parseInt(intel[1], 10);

      if (modelNumber >= 12000) return "LGA1700";
      if (modelNumber >= 10000 && modelNumber < 12000) return "LGA1200";
      if (modelNumber >= 6000 && modelNumber < 10000) return "LGA1151";
      if (modelNumber >= 4000 && modelNumber < 6000) return "LGA1150";
      if (modelNumber >= 2000 && modelNumber < 4000) return "LGA1155";
      if (modelNumber >= 900 && modelNumber < 1000) return "LGA1366";
      if (modelNumber >= 500 && modelNumber < 900) return "LGA1156";
    }

  // Safety net
  return null;
}

function inferMotherboardRamType(socket, boardName) {
  var s = normalizeSpaces(socket).toUpperCase();
  var n = normalizeSpaces(boardName).toUpperCase();

  // 1. Explicit board-name detection (includes D4/D5 suffixes)
  if (n.indexOf("DDR5") >= 0) return "DDR5";
  if (n.indexOf("DDR4") >= 0) return "DDR4";
  if (n.indexOf("DDR3") >= 0) return "DDR3";
  if (n.indexOf("DDR2") >= 0) return "DDR2";

  // Detect suffixes like " Z790 D5" or " B760M D4".
  // Leading space before D* prevents false positives like "UD5".
  if (n.indexOf(" D5") >= 0 || n.endsWith(" D5")) return "DDR5";
  if (n.indexOf(" D4") >= 0 || n.endsWith(" D4")) return "DDR4";

  // 2. Socket rules
  if (s === "AM5") return "DDR5";
  if (s === "AM4") return "DDR4";

  if (s === "LGA1851") return "DDR5";

  if (s === "LGA1200" || s === "LGA1151") return "DDR4";
  if (s === "LGA2011-3" || s === "LGA2011-3 NARROW" || s === "LGA2066") return "DDR4";
  if (s === "STR4" || s === "STRX4") return "DDR4";

  if (s === "LGA1150" || s === "LGA1155" || s === "LGA1156" || s === "LGA1366" || s === "LGA2011") return "DDR3";
  if (s === "AM3" || s === "AM3+" || s === "AM1" || s === "FM1" || s === "FM2" || s === "FM2+") return "DDR3";

  if (s === "LGA775" || s === "AM2" || s === "AM2+/AM2") return "DDR2";

  // LGA1700 (and mixed/unknown platforms)
  return null;
}

function countBy(arr, keyFn) {
  const m = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function topExamples(arr, take = 10, mapFn = (x) => x) {
  const out = [];
  for (const item of arr) {
    out.push(mapFn(item));
    if (out.length >= take) break;
  }
  return out;
}

function formatMap(map) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}

function main() {
  const root = path.resolve(__dirname, '..');
  const jsonDir = path.join(root, 'data-filtered', 'json');

  const cpuPath = path.join(jsonDir, 'cpu.json');
  const moboPath = path.join(jsonDir, 'motherboard.json');
  const ramPath = path.join(jsonDir, 'memory.json');
  const gpuPath = path.join(jsonDir, 'video-card.json');
  const casePath = path.join(jsonDir, 'case.json');
  const psuPath = path.join(jsonDir, 'power-supply.json');
  const storagePath = path.join(jsonDir, 'internal-hard-drive.json');
  const coolerPath = path.join(jsonDir, 'cpu-cooler.json');

  const cpus = readJsonArray(cpuPath);
  const mobos = readJsonArray(moboPath);
  const rams = readJsonArray(ramPath);
  const gpus = readJsonArray(gpuPath);
  const cases = readJsonArray(casePath);
  const psus = readJsonArray(psuPath);
  const storage = readJsonArray(storagePath);
  const coolers = readJsonArray(coolerPath);

  console.log('=== Catalog Validation Report ===');
  console.log(`CPU: ${cpus.length} | Motherboards: ${mobos.length} | RAM kits: ${rams.length} | GPUs: ${gpus.length}`);
  console.log(`Cases: ${cases.length} | PSUs: ${psus.length} | Storage: ${storage.length} | Coolers: ${coolers.length}`);

  // CPUs: socket inference coverage
  const cpuSockets = cpus.map(c => ({ name: normalizeSpaces(c.name), socket: detectCpuSocket(normalizeSpaces(c.name)) }));
  const unknownCpus = cpuSockets.filter(x => !x.socket);
  console.log('\n[CPU] Inferred sockets:', formatMap(countBy(cpuSockets, x => x.socket || 'NULL')));
  if (unknownCpus.length) {
    console.log(`[CPU] WARNING: ${unknownCpus.length} CPUs have NULL socket (would be dropped/weakly match). Examples:`);
    console.log('  - ' + topExamples(unknownCpus, 15, x => x.name).join('\n  - '));
  }

  // Motherboards: RAM type inference + socket normalization
  const moboInfo = mobos.map(b => {
    const name = normalizeSpaces(b.name);
    const socket = normalizeSpaces(b.socket);
    return {
      name,
      socket,
      ramType: inferMotherboardRamType(socket, name),
      formFactor: normalizeSpaces(b.form_factor),
    };
  });

  const moboRamNull = moboInfo.filter(x => !x.ramType);
  console.log('\n[Motherboard] Socket distribution:', formatMap(countBy(moboInfo, x => x.socket || 'NULL')));
  console.log('[Motherboard] Inferred RAM type distribution:', formatMap(countBy(moboInfo, x => x.ramType || 'NULL')));
  if (moboRamNull.length) {
    const bySocket = countBy(moboRamNull, x => x.socket || 'NULL');
    console.log(`[Motherboard] NOTE: ${moboRamNull.length} boards have NULL RAM type (expected for LGA1700 when not explicit). By socket: ${formatMap(bySocket)}`);
    console.log('  Examples:');
    console.log('  - ' + topExamples(moboRamNull, 15, x => `${x.socket} | ${x.name}`).join('\n  - '));
  }

  // CPU <-> Motherboard socket cross coverage
  const cpuSocketSet = new Set(cpuSockets.map(x => x.socket).filter(Boolean));
  const moboSocketSet = new Set(moboInfo.map(x => x.socket).filter(Boolean));
  const cpuOnly = Array.from(cpuSocketSet).filter(s => !moboSocketSet.has(s));
  const moboOnly = Array.from(moboSocketSet).filter(s => !cpuSocketSet.has(s));

  console.log('\n[Compatibility] Socket overlap:');
  console.log('  CPU sockets:', Array.from(cpuSocketSet).sort().join(', ') || '(none)');
  console.log('  Mobo sockets:', Array.from(moboSocketSet).sort().join(', ') || '(none)');
  if (cpuOnly.length) console.log('  WARNING: CPU sockets with no matching motherboards:', cpuOnly.sort().join(', '));
  if (moboOnly.length) console.log('  WARNING: Motherboard sockets with no matching CPUs:', moboOnly.sort().join(', '));

  // RAM kits: generation coverage
  const ramInfo = rams.map(r => {
    const speed = Array.isArray(r.speed) ? r.speed[0] : null;
    const gen = (speed === 2 || speed === 3 || speed === 4 || speed === 5) ? `DDR${speed}` : null;
    return {
      name: normalizeSpaces(r.name),
      gen,
      speed,
    };
  });
  const ramUnknown = ramInfo.filter(x => !x.gen);
  console.log('\n[RAM] Generation distribution:', formatMap(countBy(ramInfo, x => x.gen || 'NULL')));
  if (ramUnknown.length) {
    console.log(`[RAM] WARNING: ${ramUnknown.length} kits have unknown generation. Examples:`);
    console.log('  - ' + topExamples(ramUnknown, 15, x => `${x.name} (speed=${x.speed})`).join('\n  - '));
  }

  // RAM <-> Motherboard RAM type overlap (coarse)
  const moboRamTypes = new Set(moboInfo.map(x => x.ramType).filter(Boolean));
  const ramGens = new Set(ramInfo.map(x => x.gen).filter(Boolean));
  const ramOnly = Array.from(ramGens).filter(g => !moboRamTypes.has(g));
  const moboOnlyRam = Array.from(moboRamTypes).filter(g => !ramGens.has(g));
  console.log('\n[Compatibility] RAM type overlap:');
  console.log('  Motherboard RAM types:', Array.from(moboRamTypes).sort().join(', ') || '(none)');
  console.log('  RAM kit generations:', Array.from(ramGens).sort().join(', ') || '(none)');
  if (ramOnly.length) console.log('  WARNING: RAM gen exists but no boards inferred for it:', ramOnly.join(', '));
  if (moboOnlyRam.length) console.log('  WARNING: Board RAM type exists but no RAM kits for it:', moboOnlyRam.join(', '));

  // GPUs: length coverage
  const gpuInfo = gpus.map(g => ({
    name: normalizeSpaces(g.name || (g.chipset ? `${g.chipset}` : 'UNKNOWN')),
    length: (g.length === null || g.length === undefined) ? null : Number(g.length),
  }));
  const gpuLenNull = gpuInfo.filter(x => x.length === null || Number.isNaN(x.length));
  const gpuLenBad = gpuInfo.filter(x => x.length !== null && !Number.isFinite(x.length));
  console.log('\n[GPU] Length coverage:');
  console.log(`  null/NaN: ${gpuLenNull.length} | non-finite: ${gpuLenBad.length} | total: ${gpuInfo.length}`);
  if (gpuLenNull.length) {
    console.log('  Examples:');
    console.log('  - ' + topExamples(gpuLenNull, 15, x => x.name).join('\n  - '));
  }

  // Cases: max GPU length coverage
  const caseInfo = cases.map(c => {
    const max = c.maximum_video_card_length ?? c.max_gpu_length;
    const maxLen = (max === null || max === undefined) ? null : Number(max);
    return {
      name: normalizeSpaces(c.name),
      type: normalizeSpaces(c.type),
      // ETL defaults to 350mm when missing
      maxGpuLen: Number.isFinite(maxLen) ? maxLen : 350,
    };
  });
  const caseDefaulted = caseInfo.filter(x => x.maxGpuLen === 350).length;
  console.log('\n[Case] Max GPU length coverage:');
  console.log(`  defaulted-to-350: ${caseDefaulted} | total: ${caseInfo.length}`);

  // High-level “can we ever fit the longest GPU?” sanity
  const maxGpu = gpuInfo.filter(x => Number.isFinite(x.length)).reduce((a, b) => (a.length > b.length ? a : b), { length: -1, name: null });
  const maxCase = caseInfo.filter(x => Number.isFinite(x.maxGpuLen)).reduce((a, b) => (a.maxGpuLen > b.maxGpuLen ? a : b), { maxGpuLen: -1, name: null });
  if (maxGpu.length > 0 && maxCase.maxGpuLen > 0) {
    console.log('\n[Fit] Longest GPU vs largest case:');
    console.log(`  Longest GPU: ${maxGpu.length}mm | ${maxGpu.name}`);
    console.log(`  Largest case clearance: ${maxCase.maxGpuLen}mm | ${maxCase.name}`);
    if (maxGpu.length > maxCase.maxGpuLen) {
      console.log('  WARNING: Longest GPU does not fit in any case (by clearance numbers).');
    }
  }

  // PSUs: wattage coverage
  const psuInfo = psus.map(p => ({ name: normalizeSpaces(p.name), wattage: p.wattage === null || p.wattage === undefined ? null : Number(p.wattage) }));
  const psuBad = psuInfo.filter(x => x.wattage === null || !Number.isFinite(x.wattage));
  console.log('\n[PSU] Wattage coverage:');
  console.log(`  null/invalid: ${psuBad.length} | total: ${psuInfo.length}`);
  if (psuBad.length) {
    console.log('  Examples:');
    console.log('  - ' + topExamples(psuBad, 15, x => x.name).join('\n  - '));
  }

  // Storage: capacity coverage
  const storageInfo = storage.map(d => ({ name: normalizeSpaces(d.name), capacity: d.capacity === null || d.capacity === undefined ? null : Number(d.capacity) }));
  const storageBad = storageInfo.filter(x => x.capacity === null || !Number.isFinite(x.capacity));
  console.log('\n[Storage] Capacity coverage:');
  console.log(`  null/invalid: ${storageBad.length} | total: ${storageInfo.length}`);

  // Coolers: size field coverage
  const coolerSizeNull = coolers.filter(c => c.size === null || c.size === undefined).length;
  console.log('\n[CPU Cooler] Size field coverage:');
  console.log(`  size null/undefined: ${coolerSizeNull} | total: ${coolers.length}`);

  console.log('\n=== End Report ===');
}

main();
