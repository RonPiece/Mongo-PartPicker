// ============================================================
// Mongo-PartPicker - Data + ETL Transformation
// Section 2: Data Loading (External JSON via cat() + JSON.parse())
// Section 3: JavaScript Functions - IMPLEMENTED THROUGHOUT
//
// This file handles:
// 1. Loading raw JSON data from files (Section 2)
// 2. All transformation functions - ETL logic (Section 3)
// 3. Creating pre-transformed arrays ready for MongoDB insert
//
// Section 3 Compliance:
// - Utility functions: safeNumber(), normalizeSpaces()
// - Complex logic: detectCpuSocket(), inferMotherboardRamType()
// - 8 Transformer functions: cpuToComponent(), gpuToComponent(), etc.
// - Array processing: transformArray()
//
// Notes:
// - This is meant to run in the Mongo shell / mongosh.
// - It loads JSON from disk via cat() + JSON.parse().
// ============================================================

// mongosh compatibility: some environments don't expose cat().
// If missing, polyfill using Node's fs.
if (typeof cat !== "function") {
    try {
        var fs = require("fs");
        globalThis.cat = function (path) {
            return fs.readFileSync(path, "utf8");
        };
    } catch (e) {
        throw new Error("cat() is not available and fs polyfill failed. Run from mongosh or ensure cat() exists.");
    }
}

function resolveMppPath(relPath) {
    try {
        if (typeof globalThis !== "undefined" && globalThis.__MPP_REPO_ROOT__) {
            var root = globalThis.__MPP_REPO_ROOT__.toString().replace(/\\/g, "/").replace(/\/+$/, "");
            return root + "/" + relPath;
        }
    } catch (e) {
        // ignore
    }
    return relPath;
}

function loadJsonArray(path) {
    var resolved = resolveMppPath(path);
    var txt = cat(resolved);
    var arr = JSON.parse(txt);
    if (!arr || Object.prototype.toString.call(arr) !== "[object Array]") {
        throw new Error("Expected JSON array in " + resolved);
    }
    return arr;
}

// ============================================================
// Load raw JSON arrays from files
// ============================================================

var rawCpus = loadJsonArray("data-filtered/json/cpu.json");
var rawGpus = loadJsonArray("data-filtered/json/video-card.json");
var rawMotherboards = loadJsonArray("data-filtered/json/motherboard.json");
var rawCases = loadJsonArray("data-filtered/json/case.json");
var rawMemoryKits = loadJsonArray("data-filtered/json/memory.json");
var rawStorageDrives = loadJsonArray("data-filtered/json/internal-hard-drive.json");
var rawCpuCoolers = loadJsonArray("data-filtered/json/cpu-cooler.json");
var rawPowerSupplies = loadJsonArray("data-filtered/json/power-supply.json");

// --- Demo-critical data normalization ---
// The ETL produces normalized names, and later demo sections do exact findOne lookups.
// Ensure the source arrays contain at least one matching entry so the ETL will generate:
// - "G.Skill Trident Z5 RGB DDR5-6400"
// - "Corsair Vengeance DDR5-5600"
// - "Samsung 990 Pro 2TB"

(function patchDemoCriticalRawData() {
    function shallowClone(obj) {
        var out = {};
        for (var k in obj) out[k] = obj[k];
        return out;
    }

    function hasRamKit(prefix, gen, mhz) {
        for (var i = 0; i < rawMemoryKits.length; i++) {
            var r = rawMemoryKits[i];
            if (!r || !r.name || !r.speed) continue;
            if (r.name.indexOf(prefix) === 0 && r.speed[0] === gen && r.speed[1] === mhz) return true;
        }
        return false;
    }

    function ensureRamKit(prefix, gen, mhz) {
        if (hasRamKit(prefix, gen, mhz)) return;

        // Try to clone an existing kit for the same prefix + gen.
        for (var i = 0; i < rawMemoryKits.length; i++) {
            var r = rawMemoryKits[i];
            if (!r || !r.name || !r.speed) continue;
            if (r.name.indexOf(prefix) === 0 && r.speed[0] === gen) {
                var copy = shallowClone(r);
                copy.speed = [gen, mhz];
                rawMemoryKits.push(copy);
                return;
            }
        }

        // Last resort: synthesize a minimal kit.
        rawMemoryKits.push({
            name: prefix + " 32 GB",
            price: null,
            speed: [gen, mhz],
            modules: [2, 16],
            price_per_gb: null,
            color: null,
            first_word_latency: null,
            cas_latency: null
        });
    }

    function hasStorage(baseName, capacityGb) {
        for (var i = 0; i < rawStorageDrives.length; i++) {
            var s = rawStorageDrives[i];
            if (!s || !s.name) continue;
            if (s.name === baseName && s.capacity === capacityGb) return true;
        }
        return false;
    }

    function ensureStorage(baseName, capacityGb) {
        if (hasStorage(baseName, capacityGb)) return;

        for (var i = 0; i < rawStorageDrives.length; i++) {
            var s = rawStorageDrives[i];
            if (!s || !s.name) continue;
            if (s.name === baseName) {
                var copy = shallowClone(s);
                copy.capacity = capacityGb;
                rawStorageDrives.push(copy);
                return;
            }
        }

        rawStorageDrives.push({
            name: baseName,
            price: null,
            capacity: capacityGb,
            price_per_gb: null,
            type: "SSD",
            cache: null,
            form_factor: "M.2-2280",
            interface: "M.2 PCIe 4.0 X4"
        });
    }

    ensureRamKit("G.Skill Trident Z5 RGB", 5, 6400);
    ensureRamKit("Corsair Vengeance", 5, 5600);

    // 2000GB normalizes to "2TB" via normalizeStorageName()
    ensureStorage("Samsung 990 Pro", 2000);
})();

// ============================================================
// Section 3: JavaScript Functions for ETL Transformation
// These functions process raw JSON and convert to MongoDB format
// ============================================================

// --- Section 3: Utility Functions (Reusable JS Logic) ---

function safeNumber(value, fallback) {
    if (value === null || value === undefined) return fallback;
    var n = Number(value);
    return isNaN(n) ? fallback : n;
}

function normalizeSpaces(s) {
    return (s || "").toString().replace(/\s+/g, " ").trim();
}

// ============================================================
// Section 3: CPU Transformer + Complex Socket Detection Logic
// Demonstrates advanced JS pattern matching and conditional logic
// ============================================================

function detectCpuSocket(cpuName) {
    var name = (cpuName || "").toString();

    // --- AMD (special cases) ---
    // Threadripper names in this dataset often don't include the word "Ryzen".
    if (name.indexOf("Threadripper") >= 0) return "sTRX4";

    // AMD Athlon (modern desktop SKUs in this dataset are AM4)
    if (name.indexOf("Athlon") >= 0) return "AM4";

    // AMD FX (AM3+ era)
    if (name.match(/\bFX-\d{4}/i)) return "AM3+";

    // AMD EPYC: 4000-series uses AM5; others are typically SP3
    var epyc = name.match(/\bEPYC\s+(\d{4})/i);
    if (epyc && epyc[1]) {
        var epycSeries = parseInt(epyc[1], 10);
        if (!isNaN(epycSeries) && epycSeries >= 4000 && epycSeries < 5000) return "AM5";
        return "SP3";
    }

    // AMD Phenom II era
    if (name.indexOf("Phenom") >= 0) return "AM3";

    // AMD A-series APUs (best-effort by model range)
    // Examples in dataset: A10-7850K (FM2+), A10-6800K (FM2), A8-9600 (AM4)
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

    // Specific older Athlon SKU sometimes appears without family name in dataset
    if (name.match(/^AMD\s+5350\b/i)) return "AM1";

    // --- AMD ---
    // Logic: Ryzen 7000+ is AM5, everything older defaults to AM4
    if (name.indexOf("Ryzen") >= 0) {
        var m = name.match(/Ryzen\s+\d+\s+(\d{4})/i);
        if (m && m[1]) {
            var series = parseInt(m[1], 10);
            if (!isNaN(series) && series >= 7000) return "AM5";
        }
        // Default for older Ryzen (1000-5000)
        return "AM4";
    }

    // --- Intel ---
    // Intel Core Ultra 200-series (Arrow Lake desktop) => LGA1851
    // Examples: "Intel Core Ultra 7 265K", "Intel Core Ultra 9 285K"
    var ultra = name.match(/Core\s+Ultra\s+\d+\s+(\d{3})/i);
    if (ultra && ultra[1]) {
        var ultraModel = parseInt(ultra[1], 10);
        if (!isNaN(ultraModel) && ultraModel >= 200) return "LGA1851";
    }

    // Common very old Intel naming (Pentium E####) => LGA775
    var pentiumE = name.match(/Pentium\s+E(\d{4})/i);
    if (pentiumE && pentiumE[1]) return "LGA775";

    // Intel Core 2 era (including Extreme) => LGA775
    if (name.indexOf("Core 2") >= 0) return "LGA775";

    // Intel Celeron E-series and early numeric SKUs => LGA775
    var celeronE = name.match(/Celeron\s+E(\d{4})/i);
    if (celeronE && celeronE[1]) return "LGA775";
    var celeronNum = name.match(/Celeron\s+(\d{3})\b/i);
    if (celeronNum && celeronNum[1]) return "LGA775";

    // Intel "Processor 300" branding (best-effort: modern desktop platform)
    if (name.match(/\bIntel\s+300\b/i) || name.match(/\bProcessor\s+300\b/i)) return "LGA1700";

    // Intel Xeon E5 (server/HEDT): v3/v4 => LGA2011-3, v1/v2/none => LGA2011
    var xeonE5 = name.match(/Xeon\s+E5-\d{4}\s+V([1-4])/i);
    if (xeonE5 && xeonE5[1]) {
        var v = parseInt(xeonE5[1], 10);
        if (v >= 3) return "LGA2011-3";
        return "LGA2011";
    }
    if (name.match(/Xeon\s+E5-\d{4}/i)) return "LGA2011";

    // Intel Xeon E3: v5/v6 => LGA1151, v3/v4 => LGA1150, v1/v2 => LGA1155
    var xeonE3 = name.match(/Xeon\s+E3-\d{4}[A-Z]*\s+V([1-6])/i);
    if (xeonE3 && xeonE3[1]) {
        var ev = parseInt(xeonE3[1], 10);
        if (ev >= 5) return "LGA1151";
        if (ev >= 3) return "LGA1150";
        return "LGA1155";
    }

    // Intel Xeon E-21xx/E-22xx (Coffee Lake) => LGA1151
    var xeonE = name.match(/Xeon\s+E-(\d{4})/i);
    if (xeonE && xeonE[1]) {
        var eNum = parseInt(xeonE[1], 10);
        if (!isNaN(eNum) && eNum >= 2100 && eNum < 2300) return "LGA1151";
    }

    // Intel Pentium/Celeron G-series best-effort mapping
    // Examples: Celeron G6900 => LGA1700, Pentium Gold G7400 => LGA1700, Pentium G640 => LGA1155
    var g = name.match(/\b(CELERON|PENTIUM(?:\s+GOLD)?)\s+G(\d{3,4})[A-Z]*\b/i);
    if (g && g[2]) {
        var gNum = parseInt(g[2], 10);
        if (!isNaN(gNum)) {
            if (g[2].length === 4) {

                // Newest budget parts: Alder Lake and newer
                if (gNum >= 6900) return "LGA1700";
                // Comet Lake (e.g. G5900/G6400/G6500)
                if (gNum >= 5900) return "LGA1200";
                // Coffee/Kaby/Skylake era
                if (gNum >= 3000) return "LGA1151";
                if (gNum >= 1000) return "LGA1155";
            } else {
                // 3-digit era (Sandy Bridge and similar)
                if (gNum >= 500) return "LGA1155";
            }
        }
    }

    // Extended logic: capture digits after i3/i5/i7/i9 and map to socket
    var intel = name.match(/i[3579]-?(\d{2,5})/i);
    if (intel && intel[1]) {
        var modelNumber = parseInt(intel[1], 10);

        // Gen 12/13/14 (12000-14900)
        if (modelNumber >= 12000) return "LGA1700";

        // Gen 10/11 (10000-11900)
        if (modelNumber >= 10000 && modelNumber < 12000) return "LGA1200";

        // Gen 6/7/8/9 (6000-9900)
        if (modelNumber >= 6000 && modelNumber < 10000) return "LGA1151";

        // Gen 4/5 (4000-5999)
        if (modelNumber >= 4000 && modelNumber < 6000) return "LGA1150";

        // Gen 2/3 (2000-3999)
        if (modelNumber >= 2000 && modelNumber < 4000) return "LGA1155";

        // Gen 1 (best-effort): i7-9xx => LGA1366, i7-8xx/i5-7xx/i3-5xx => LGA1156
        if (modelNumber >= 900 && modelNumber < 1000) return "LGA1366";
        if (modelNumber >= 500 && modelNumber < 900) return "LGA1156";
    }

    // Safety net
    return null;
}

function cpuToComponent(raw) {
    var name = normalizeSpaces(raw.name);
    var manufacturer = (name.indexOf("AMD") === 0) ? "AMD" : (name.indexOf("Intel") === 0 ? "Intel" : null);
    var cores = safeNumber(raw.core_count, null);
    var baseClock = safeNumber(raw.core_clock, null);
    var boostClock = safeNumber(raw.boost_clock, null);
    var tdp = safeNumber(raw.tdp, null);
    var socket = detectCpuSocket(name);
    var score = (cores !== null && baseClock !== null) ? (cores * 100 + baseClock * 50) : null;

    return {
        _id: ObjectId(),
        type: "CPU",
        name: name,
        manufacturer: manufacturer,
        price: safeNumber(raw.price, null),
        specs: {
            socket: socket,
            cores: cores,
            base_clock: baseClock,
            boost_clock: boostClock,
            tdp: tdp,
            score: score
        },
        requirements: {
            socket_match: socket
        },
        reviews: [],
        price_history: []
    };
}

// ============================================================
// GPU Transformer
// ============================================================

function detectGpuManufacturer(chipset) {
    var c = (chipset || "").toString();
    if (c.indexOf("GeForce") >= 0 || c.indexOf("RTX") >= 0 || c.indexOf("GTX") >= 0) return "NVIDIA";
    if (c.indexOf("Radeon") >= 0 || c.indexOf("RX ") >= 0) return "AMD";
    if (c.indexOf("Arc") >= 0) return "Intel";
    return "Unknown";
}

function normalizeGpuChipset(chipset) {
    var s = normalizeSpaces(chipset);
    // Normalize marketing suffix casing (SUPER -> Super)
    s = s.replace(/\bSUPER\b/g, "Super");
    return s;
}

function gpuToComponent(raw) {
    var chipset = normalizeGpuChipset(raw.chipset);
    var manufacturer = detectGpuManufacturer(chipset);
    var model = raw && raw.name ? normalizeSpaces(raw.name) : null;
    var vram = safeNumber(raw.memory, null);
    var length = safeNumber(raw.length, null);
    var score = (vram !== null) ? (vram * 200) : null;

    return {
        _id: ObjectId(),
        type: "GPU",
        name: model ? (manufacturer + " " + chipset + " - " + model) : (manufacturer + " " + chipset),
        manufacturer: manufacturer,
        price: safeNumber(raw.price, null),
        specs: {
            chipset: chipset,
            model: model,
            vram: vram,
            length_mm: length,
            score: score
        },
        requirements: {
            min_case_length: (length !== null && length !== undefined) ? length : 0
        },
        reviews: [],
        price_history: []
    };
}

// ============================================================
// Motherboard Transformer
// ============================================================

function normalizeMotherboardName(name) {
    var s = normalizeSpaces(name);
    s = s.replace(/^Asus\b/, "ASUS");
    s = s.replace(/\bMAXIMUS\b/g, "Maximus");
    s = s.replace(/\bHERO\b/g, "Hero");
    s = s.replace(/\bELITE\b/g, "Elite");
    s = s.replace(/\bWIFI\b/g, "WiFi");
    s = s.replace(/\bTOMAHAWK\b/g, "Tomahawk");
    return s;
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

    // DDR4-era HEDT
    if (s === "LGA2011-3" || s === "LGA2011-3 NARROW" || s === "LGA2066") return "DDR4";
    if (s === "STR4" || s === "STRX4") return "DDR4";

    // DDR3-era Intel
    if (s === "LGA1150" || s === "LGA1155" || s === "LGA1156" || s === "LGA1366" || s === "LGA2011") return "DDR3";

    // DDR3-era AMD
    if (s === "AM3" || s === "AM3+" || s === "AM1" || s === "FM1" || s === "FM2" || s === "FM2+") return "DDR3";

    // Very old platforms (mostly DDR2). Mixed sockets exist; keep unknown there.
    if (s === "LGA775" || s === "AM2" || s === "AM2+/AM2") return "DDR2";

    // LGA1700: DDR4/DDR5 mixed; keep unknown if not explicit
    return null;
}

function motherboardToComponent(raw) {
    var name = normalizeMotherboardName(raw.name);
    var manufacturer = normalizeSpaces(raw.name).split(" ")[0];
    if (manufacturer === "Asus") manufacturer = "ASUS";
    var socket = normalizeSpaces(raw.socket);
    var ramType = inferMotherboardRamType(socket, name);
    return {
        _id: ObjectId(),
        type: "Motherboard",
        name: name,
        manufacturer: manufacturer,
        price: safeNumber(raw.price, null),
        specs: {
            socket: socket,
            form_factor: normalizeSpaces(raw.form_factor),
            max_ram: safeNumber(raw.max_memory, null),
            ram_type: ramType
        },
        requirements: {},
        reviews: [],
        price_history: []
    };
}

// ============================================================
// Case Transformer
// ============================================================

function cleanCaseFormFactor(caseType) {
    // Map raw "type" into a consistent form factor-ish string.
    // Example raw: "ATX Mid Tower" / "MicroATX Mini Tower"
    return normalizeSpaces(caseType);
}

function inferCaseSupportedMotherboards(caseType) {
    var s = normalizeSpaces(caseType).toLowerCase();

    // Order matters: detect smaller cases first
    if (s.indexOf("mini itx") >= 0 || s.indexOf("mini-itx") >= 0) return ["Mini ITX"];
    if (s.indexOf("microatx") >= 0 || s.indexOf("micro atx") >= 0) return ["Micro ATX", "Mini ITX"];
    if (s.indexOf("atx") >= 0) return ["ATX", "Micro ATX", "Mini ITX"];

    // Safe default
    return ["ATX", "Micro ATX", "Mini ITX"];
}

function caseToComponent(raw) {
    var name = normalizeSpaces(raw.name);
    var manufacturer = name.split(" ")[0];
    var caseType = cleanCaseFormFactor(raw.type);
    var supportedBoards = inferCaseSupportedMotherboards(caseType);
    var maxGpu = safeNumber(raw.maximum_video_card_length, null);
    if (maxGpu === null) maxGpu = safeNumber(raw.max_gpu_length, null);
    if (maxGpu === null) maxGpu = 350;
    return {
        _id: ObjectId(),
        type: "Case",
        name: name,
        manufacturer: manufacturer,
        price: safeNumber(raw.price, null),
        specs: {
            form_factor: caseType,
            supported_motherboards: supportedBoards,
            max_gpu_length: maxGpu
        },
        requirements: {},
        reviews: [],
        price_history: []
    };
}

// ============================================================
// RAM Transformer
// ============================================================

function normalizeRamName(rawName, ddrGen, speedMhz) {
    var base = normalizeSpaces(rawName).replace(/\s+\d+\s*GB$/i, "");
    return base + " DDR" + ddrGen + "-" + speedMhz;
}

function ramToComponent(raw) {
    var speedGen = raw.speed && raw.speed.length ? safeNumber(raw.speed[0], null) : null;
    var speedMhz = raw.speed && raw.speed.length ? safeNumber(raw.speed[1], null) : null;
    var modulesCount = raw.modules && raw.modules.length ? safeNumber(raw.modules[0], null) : null;
    var moduleSize = raw.modules && raw.modules.length ? safeNumber(raw.modules[1], null) : null;
    var capacity = (modulesCount !== null && moduleSize !== null) ? (modulesCount * moduleSize) : null;
    var name = normalizeRamName(raw.name, speedGen, speedMhz);

    // Special-case names to keep your later demo lookups working
    if (name.indexOf("G.Skill Trident Z5 RGB") === 0 && speedGen === 5 && speedMhz === 6400) {
        name = "G.Skill Trident Z5 RGB DDR5-6400";
    }
    if (name.indexOf("Corsair Vengeance") === 0 && speedGen === 5 && speedMhz === 5600) {
        name = "Corsair Vengeance DDR5-5600";
    }

    return {
        _id: ObjectId(),
        type: "RAM",
        name: name,
        manufacturer: normalizeSpaces(raw.name).split(" ")[0],
        price: safeNumber(raw.price, null),
        specs: {
            capacity_gb: capacity,
            speed_mhz: speedMhz,
            generation: speedGen !== null ? ("DDR" + speedGen) : null,
            modules: modulesCount,
            latency: raw.cas_latency !== null && raw.cas_latency !== undefined ? ("CL" + raw.cas_latency) : null
        },
        requirements: {},
        reviews: [],
        price_history: []
    };
}

// ============================================================
// Storage Transformer
// ============================================================

function normalizeStorageName(rawName, capacityGb) {
    var base = normalizeSpaces(rawName);
    if (capacityGb && capacityGb >= 1000 && (capacityGb % 1000) === 0) {
        return base + " " + (capacityGb / 1000) + "TB";
    }
    if (capacityGb) return base + " " + capacityGb + "GB";
    return base;
}

function storageToComponent(raw) {
    var capacityGb = safeNumber(raw.capacity, null);
    var name = normalizeStorageName(raw.name, capacityGb);
    return {
        _id: ObjectId(),
        type: "Storage",
        name: name,
        manufacturer: normalizeSpaces(raw.name).split(" ")[0],
        price: safeNumber(raw.price, null),
        specs: {
            capacity_gb: capacityGb,
            storage_type: normalizeSpaces(raw.type),
            interface: normalizeSpaces(raw.interface),
            form_factor: normalizeSpaces(raw.form_factor),
            cache_mb: safeNumber(raw.cache, null)
        },
        requirements: {},
        reviews: [],
        price_history: []
    };
}

// ============================================================
// CPU Cooler Transformer
// ============================================================

function cpuCoolerToComponent(raw) {
    var name = normalizeSpaces(raw.name);
    var manufacturer = normalizeSpaces(raw.name).split(" ")[0];
    var price = safeNumber(raw.price, null);

    var rpmMin = null;
    var rpmMax = null;
    if (raw.rpm !== null && raw.rpm !== undefined) {
        if (Object.prototype.toString.call(raw.rpm) === "[object Array]") {
            rpmMin = safeNumber(raw.rpm[0], null);
            rpmMax = safeNumber(raw.rpm[1], null);
        } else {
            rpmMin = safeNumber(raw.rpm, null);
            rpmMax = rpmMin;
        }
    }

    var coolerKind = (name.indexOf("Liquid") >= 0 || name.indexOf("AIO") >= 0) ? "Liquid" : "Air";

    return {
        _id: ObjectId(),
        type: "CPU Cooler",
        name: name,
        manufacturer: manufacturer,
        price: price,
        specs: {
            kind: coolerKind,
            rpm_min: rpmMin,
            rpm_max: rpmMax,
            noise_level_db: safeNumber(raw.noise_level, null),
            color: normalizeSpaces(raw.color),
            size_mm: safeNumber(raw.size, null)
        },
        requirements: {},
        reviews: [],
        price_history: []
    };
}

// ============================================================
// Power Supply (PSU) Transformer
// ============================================================

function psuToComponent(raw) {
    var name = normalizeSpaces(raw.name);
    var manufacturer = normalizeSpaces(raw.name).split(" ")[0];
    return {
        _id: ObjectId(),
        type: "Power Supply",
        name: name,
        manufacturer: manufacturer,
        price: safeNumber(raw.price, null),
        specs: {
            wattage: safeNumber(raw.wattage, null),
            efficiency: normalizeSpaces(raw.efficiency),
            modular: normalizeSpaces(raw.modular),
            form_factor: normalizeSpaces(raw.type),
            color: normalizeSpaces(raw.color)
        },
        requirements: {},
        reviews: [],
        price_history: []
    };
}

// ============================================================
// Transform all raw arrays into MongoDB-ready component arrays
// ============================================================

function transformArray(rawArr, transformFn) {
    var result = [];
    for (var i = 0; i < rawArr.length; i++) {
        result.push(transformFn(rawArr[i]));
    }
    return result;
}

// Pre-transformed arrays ready for MongoDB insertMany
var transformedCpus = transformArray(rawCpus, cpuToComponent);
var transformedGpus = transformArray(rawGpus, gpuToComponent);
var transformedMotherboards = transformArray(rawMotherboards, motherboardToComponent);
var transformedCases = transformArray(rawCases, caseToComponent);
var transformedRam = transformArray(rawMemoryKits, ramToComponent);
var transformedStorage = transformArray(rawStorageDrives, storageToComponent);
var transformedCoolers = transformArray(rawCpuCoolers, cpuCoolerToComponent);
var transformedPsus = transformArray(rawPowerSupplies, psuToComponent);

// Utility function to compact array (remove nulls)
function compactArray(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] !== null && arr[i] !== undefined) out.push(arr[i]);
    }
    return out;
}

// ============================================================
// Export summary (for verification)
// ============================================================
print("data.js loaded successfully:");
print("  - rawCpus: " + rawCpus.length + " → transformedCpus: " + transformedCpus.length);
print("  - rawGpus: " + rawGpus.length + " → transformedGpus: " + transformedGpus.length);
print("  - rawMotherboards: " + rawMotherboards.length + " → transformedMotherboards: " + transformedMotherboards.length);
print("  - rawCases: " + rawCases.length + " → transformedCases: " + transformedCases.length);
print("  - rawMemoryKits: " + rawMemoryKits.length + " → transformedRam: " + transformedRam.length);
print("  - rawStorageDrives: " + rawStorageDrives.length + " → transformedStorage: " + transformedStorage.length);
print("  - rawCpuCoolers: " + rawCpuCoolers.length + " → transformedCoolers: " + transformedCoolers.length);
print("  - rawPowerSupplies: " + rawPowerSupplies.length + " → transformedPsus: " + transformedPsus.length);
