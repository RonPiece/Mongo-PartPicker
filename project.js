// ============================================================
// Project: Mongo-PartPicker - Advanced Version
// NoSQL system for managing a hardware catalog and PC builds
// Uses Polymorphic Pattern, Self-Join Lookup, and advanced MapReduce
// ============================================================

// ============================================================
// Section 1: Data Modeling
// Submitted in a separate file: data_modeling.md
// ============================================================

// ============================================================
// Section 2: Setup (database + collections) + Inserts
// ============================================================

db = db.getSiblingDB("MongoPartPicker");

// Seed guard:
// - First load() seeds the DB.
// - Subsequent load() calls only re-define functions (no drop/reseed).
// To force a full re-seed in mongosh: `delete globalThis.__MPP_SEEDED__` then load() again.
if (!globalThis.__MPP_SEEDED__) {
    globalThis.__MPP_SEEDED__ = true;

// Drop existing collections for a clean run
db.components.drop()
db.builds.drop()
db.users.drop()
db.recommended_combos.drop()
db.best_builds_per_tier.drop()

db.createCollection("components")
db.createCollection("builds")
db.createCollection("users")

// ============================================================
// Section 2 (continued): Load JSON data (see data.js) and transform -> insertMany
// ============================================================
// Make relative loads work even if project.js is loaded from a different cwd.
// This is intentionally simple (no complex path-walking logic).
try {
    if (typeof process !== "undefined" && process.env && process.env.USERPROFILE) {
        var __mppRepo = process.env.USERPROFILE.replace(/\\/g, "/") + "/source/repos/MongopPcPartPicker";
        cd(__mppRepo);
    }
} catch (e) {
    // If cd() fails, the caller should run: cd("C:/Users/user/source/repos/MongopPcPartPicker")
}

load("./data.js");

function safeNumber(value, fallback) {
    if (value === null || value === undefined) return fallback;
    var n = Number(value);
    return isNaN(n) ? fallback : n;
}

function normalizeSpaces(s) {
    return (s || "").toString().replace(/\s+/g, " ").trim();
}

// CPUs
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
        tags: ["ETL"],
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

// GPUs
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
    var vram = safeNumber(raw.memory, null);
    var length = safeNumber(raw.length, null);
    var score = (vram !== null) ? (vram * 200) : null;

    return {
        _id: ObjectId(),
        type: "GPU",
        name: manufacturer + " " + chipset,
        manufacturer: manufacturer,
        price: safeNumber(raw.price, null),
        tags: ["ETL"],
        specs: {
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

// Motherboards
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
        tags: ["ETL"],
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

// Cases
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
        tags: ["ETL"],
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

// RAM
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
        tags: ["ETL"],
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

// Storage
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
        tags: ["ETL"],
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

// CPU Coolers
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
        tags: ["ETL"],
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

// Power Supplies (PSU)
function psuToComponent(raw) {
    var name = normalizeSpaces(raw.name);
    var manufacturer = normalizeSpaces(raw.name).split(" ")[0];
    return {
        _id: ObjectId(),
        type: "Power Supply",
        name: name,
        manufacturer: manufacturer,
        price: safeNumber(raw.price, null),
        tags: ["ETL"],
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

function transformAndInsert(rawArr, transformFn, batchSize, label) {
    batchSize = batchSize || 1000;
    var inserted = 0;
    var batch = [];
    for (var i = 0; i < rawArr.length; i++) {
        batch.push(transformFn(rawArr[i]));
        if (batch.length >= batchSize) {
            db.components.insertMany(batch);
            inserted += batch.length;
            batch = [];
        }
    }
    if (batch.length) {
        db.components.insertMany(batch);
        inserted += batch.length;
    }
}

function compactArray(arr) {
    var out = [];
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] !== null && arr[i] !== undefined) out.push(arr[i]);
    }
    return out;
}

transformAndInsert(rawCpus, cpuToComponent, 1000, "CPU");

transformAndInsert(rawGpus, gpuToComponent, 1000, "GPU");

transformAndInsert(rawMotherboards, motherboardToComponent, 1000, "Motherboard");

transformAndInsert(rawCases, caseToComponent, 1000, "Case");

transformAndInsert(rawMemoryKits, ramToComponent, 1000, "RAM");

transformAndInsert(rawStorageDrives, storageToComponent, 1000, "Storage");

transformAndInsert(rawCpuCoolers, cpuCoolerToComponent, 1000, "CPU Cooler");

transformAndInsert(rawPowerSupplies, psuToComponent, 1000, "Power Supply");


// ============================================================
// Seed data - builds collection (Referenced Data + compatibility)
// ============================================================

function pickGpuIdByChipset(manufacturer, chipset) {
    var q = { type: "GPU", manufacturer: manufacturer, "specs.chipset": chipset, price: { $type: "number" } };
    var doc = db.components.find(q, { _id: 1 }).sort({ price: 1 }).limit(1).toArray()[0];
    if (!doc) {
        doc = db.components.find({ type: "GPU", manufacturer: manufacturer, "specs.chipset": chipset }, { _id: 1 }).limit(1).toArray()[0];
    }
    if (!doc) {
        return null;
    }
    return doc._id;
}

function pickCheapestId(type, query) {
    query = query || {};
    query.type = type;
    var qPrice = {};
    for (var k in query) qPrice[k] = query[k];
    qPrice.price = { $type: "number" };
    var doc = db.components.find(qPrice, { _id: 1 }).sort({ price: 1 }).limit(1).toArray()[0];
    if (!doc) {
        doc = db.components.find(query, { _id: 1 }).limit(1).toArray()[0];
    }
    if (!doc) {
        return null;
    }
    return doc._id;
}

function pickPsuId(minWattage) {
    minWattage = minWattage || 650;
    var q = { type: "Power Supply", "specs.wattage": { $gte: minWattage } };
    var qPrice = {};
    for (var k in q) qPrice[k] = q[k];
    qPrice.price = { $type: "number" };
    var doc = db.components.find(qPrice, { _id: 1 }).sort({ price: 1 }).limit(1).toArray()[0];
    if (!doc) {
        doc = db.components.find(q, { _id: 1 }).limit(1).toArray()[0];
    }
    if (!doc) {
        // Fallback: any PSU (even if wattage is missing)
        var anyPsu = db.components.find({ type: "Power Supply" }, { _id: 1 }).limit(1).toArray()[0];
        if (anyPsu) return anyPsu._id;
        return null;
    }
    return doc._id;
}

function ensureBuildHasAllParts(parts, buildName) {
    var requiredTypes = [
        "Case",
        "Power Supply",
        "Motherboard",
        "CPU",
        "CPU Cooler",
        "RAM",
        "Storage",
        "GPU"
    ];

    parts = parts || [];
    var typeDocs = db.components.find({ _id: { $in: parts } }, { _id: 1, type: 1 }).toArray();
    var present = {};
    for (var i = 0; i < typeDocs.length; i++) {
        present[typeDocs[i].type] = true;
    }

    for (var j = 0; j < requiredTypes.length; j++) {
        var t = requiredTypes[j];
        if (!present[t]) {
            var id = null;
            if (t === "Power Supply") id = pickPsuId(650);
            else id = pickCheapestId(t);
            if (id) {
                parts.push(id);
                present[t] = true;
            }
        }
    }

    if (parts.length !== 8) {
        throw new Error("Build parts incomplete: " + buildName);
    }

    return parts;
}

var cpu_i9 = db.components.findOne({ name: "Intel Core i9-14900K" })._id
var cpu_i7 = db.components.findOne({ name: "Intel Core i7-14700K" })._id
var cpu_ryzen9 = db.components.findOne({ name: "AMD Ryzen 9 7950X" })._id
var cpu_ryzen7 = db.components.findOne({ name: "AMD Ryzen 7 7800X3D" })._id
var cpu_i5 = db.components.findOne({ name: "Intel Core i5-14600K" })._id

var gpu_4090 = pickGpuIdByChipset("NVIDIA", "GeForce RTX 4090")
var gpu_4070 = pickGpuIdByChipset("NVIDIA", "GeForce RTX 4070 Ti Super")
var gpu_7900 = pickGpuIdByChipset("AMD", "Radeon RX 7900 XTX")
var gpu_4060 = pickGpuIdByChipset("NVIDIA", "GeForce RTX 4060")

var psu_850 = pickPsuId(850)
var psu_750 = pickPsuId(750)
var cooler_any = pickCheapestId("CPU Cooler")
var case_any = pickCheapestId("Case")

var ram_gskill = db.components.findOne({ name: "G.Skill Trident Z5 RGB DDR5-6400" })._id
var ram_corsair = db.components.findOne({ name: "Corsair Vengeance DDR5-5600" })._id

var ssd_samsung = db.components.findOne({ name: "Samsung 990 Pro 2TB" })._id

var mb_asus = db.components.findOne({ name: "ASUS ROG Maximus Z790 Hero" })._id
var mb_msi = db.components.findOne({ name: "MSI MAG B650 Tomahawk WiFi" })._id
var mb_gigabyte = db.components.findOne({ name: "Gigabyte Z790 AORUS Elite AX" })._id

db.builds.insertMany([
    {
        _id: ObjectId(),
        build_name: "Ultimate Gaming Rig 2024",
        creator_name: "gamer2024",
        usage_type: "Gaming",
        tags: ["build", "gaming", "ultimate", "high-end"],
        parts: ensureBuildHasAllParts(compactArray([cpu_i9, gpu_4090, ram_gskill, ssd_samsung, mb_asus, psu_850, cooler_any, case_any]), "Ultimate Gaming Rig 2024"),
        total_price: 3185,
        compatibility_verified: true,
        created_at: ISODate("2024-11-01"),
        last_updated: ISODate("2024-12-20")
    },
    {
        _id: ObjectId(),
        build_name: "AMD Workstation Pro",
        creator_name: "videoeditor",
        usage_type: "Workstation",
        tags: ["build", "workstation", "amd"],
        parts: ensureBuildHasAllParts(compactArray([cpu_ryzen9, gpu_7900, ram_gskill, ssd_samsung, mb_msi, psu_850, cooler_any, case_any]), "AMD Workstation Pro"),
        total_price: 2035,
        compatibility_verified: true,
        created_at: ISODate("2024-10-15"),
        last_updated: ISODate("2024-12-15")
    },
    {
        _id: ObjectId(),
        build_name: "Sweet Spot Gaming",
        creator_name: "budgetgamer",
        usage_type: "Gaming",
        tags: ["build", "gaming", "value"],
        parts: ensureBuildHasAllParts(compactArray([cpu_ryzen7, gpu_4070, ram_corsair, ssd_samsung, mb_msi, psu_750, cooler_any, case_any]), "Sweet Spot Gaming"),
        total_price: 1596,
        compatibility_verified: true,
        created_at: ISODate("2024-09-01"),
        last_updated: ISODate("2024-11-30")
    },
    {
        _id: ObjectId(),
        build_name: "Budget Intel Build",
        creator_name: "firsttimebuilder",
        usage_type: "Budget",
        tags: ["build", "budget", "intel"],
        parts: ensureBuildHasAllParts(compactArray([cpu_i5, gpu_4060, ram_corsair, ssd_samsung, mb_gigabyte, psu_750, cooler_any, case_any]), "Budget Intel Build"),
        total_price: 1036,
        compatibility_verified: true,
        created_at: ISODate("2024-07-01"),
        last_updated: ISODate("2024-10-15")
    },
    {
        _id: ObjectId(),
        build_name: "High-End Intel Gaming",
        creator_name: "streamer1",
        usage_type: "Gaming",
        tags: ["build", "gaming", "intel", "high-end"],
        parts: ensureBuildHasAllParts(compactArray([cpu_i7, gpu_4070, ram_gskill, ssd_samsung, mb_asus, psu_850, cooler_any, case_any]), "High-End Intel Gaming"),
        total_price: 2205,
        compatibility_verified: true,
        created_at: ISODate("2024-08-01"),
        last_updated: ISODate("2024-12-01")
    }
])

// ============================================================
// Seed data - users collection with nested arrays
// Structure: User -> orders[] -> items[] (3-level hierarchy)
// ============================================================

var build_ultimate = db.builds.findOne({ build_name: "Ultimate Gaming Rig 2024" })._id
var build_amd = db.builds.findOne({ build_name: "AMD Workstation Pro" })._id
var build_sweetspot = db.builds.findOne({ build_name: "Sweet Spot Gaming" })._id
var build_budget = db.builds.findOne({ build_name: "Budget Intel Build" })._id
var build_highend = db.builds.findOne({ build_name: "High-End Intel Gaming" })._id

db.users.insertMany([
    {
        username: "gamer2024",
        email: "gamer2024@email.com",
        registered_date: ISODate("2024-01-15"),
        saved_builds: [build_ultimate, build_sweetspot],
        preferences: { preferred_manufacturer: "NVIDIA", budget_range: { min: 2000, max: 5000 }, usage: "Gaming" },
        // Nested arrays: orders -> items
        orders: [
            {
                order_id: 1001,
                date: ISODate("2024-02-15"),
                status: "completed",
                items: [
                    { part_id: gpu_4090, type: "GPU", name: "RTX 4090", price: 1599, quantity: 1 },
                    { part_id: cpu_i9, type: "CPU", name: "i9-14900K", price: 589, quantity: 1 },
                    { part_id: ram_gskill, type: "RAM", name: "Trident Z5", price: 189, quantity: 2 }
                ]
            },
            {
                order_id: 1002,
                date: ISODate("2024-06-20"),
                status: "completed",
                items: [
                    { part_id: ssd_samsung, type: "Storage", name: "990 Pro 2TB", price: 179, quantity: 1 }
                ]
            }
        ]
    },
    {
        username: "videoeditor",
        email: "video.editor@email.com",
        registered_date: ISODate("2024-02-01"),
        saved_builds: [build_amd],
        preferences: { preferred_manufacturer: "AMD", budget_range: { min: 3000, max: 6000 }, usage: "Workstation" },
        orders: [
            {
                order_id: 2001,
                date: ISODate("2024-03-10"),
                status: "completed",
                items: [
                    { part_id: gpu_7900, type: "GPU", name: "RX 7900 XTX", price: 899, quantity: 1 },
                    { part_id: cpu_ryzen9, type: "CPU", name: "Ryzen 9 7950X", price: 549, quantity: 1 },
                    { part_id: mb_msi, type: "Motherboard", name: "B650 Tomahawk", price: 219, quantity: 1 }
                ]
            }
        ]
    },
    {
        username: "budgetgamer",
        email: "budget.gamer@email.com",
        registered_date: ISODate("2024-03-10"),
        saved_builds: [build_sweetspot, build_budget],
        preferences: { preferred_manufacturer: "AMD", budget_range: { min: 1000, max: 2500 }, usage: "Gaming" },
        orders: [
            {
                order_id: 3001,
                date: ISODate("2024-04-05"),
                status: "completed",
                items: [
                    { part_id: gpu_4070, type: "GPU", name: "RTX 4070 Ti Super", price: 799, quantity: 1 },
                    { part_id: cpu_ryzen7, type: "CPU", name: "Ryzen 7 7800X3D", price: 449, quantity: 1 }
                ]
            },
            {
                order_id: 3002,
                date: ISODate("2024-07-15"),
                status: "completed",
                items: [
                    { part_id: ram_corsair, type: "RAM", name: "Vengeance DDR5", price: 129, quantity: 2 }
                ]
            }
        ]
    },
    {
        username: "streamer1",
        email: "streamer@email.com",
        registered_date: ISODate("2024-04-05"),
        saved_builds: [build_highend],
        preferences: { preferred_manufacturer: "Intel", budget_range: { min: 2000, max: 4000 }, usage: "Streaming" },
        orders: [
            {
                order_id: 4001,
                date: ISODate("2024-05-20"),
                status: "completed",
                items: [
                    { part_id: gpu_4070, type: "GPU", name: "RTX 4070 Ti Super", price: 799, quantity: 1 },
                    { part_id: cpu_i7, type: "CPU", name: "i7-14700K", price: 409, quantity: 1 },
                    { part_id: mb_asus, type: "Motherboard", name: "ROG Maximus Z790", price: 629, quantity: 1 }
                ]
            }
        ]
    },
    {
        username: "firsttimebuilder",
        email: "newbuilder@email.com",
        registered_date: ISODate("2024-05-20"),
        saved_builds: [build_budget],
        preferences: { preferred_manufacturer: "Intel", budget_range: { min: 500, max: 1500 }, usage: "Budget" },
        orders: [
            {
                order_id: 5001,
                date: ISODate("2024-08-01"),
                status: "completed",
                items: [
                    { part_id: gpu_4060, type: "GPU", name: "RTX 4060", price: 299, quantity: 1 },
                    { part_id: cpu_i5, type: "CPU", name: "i5-14600K", price: 319, quantity: 1 }
                ]
            }
        ]
    }
])

;

// ============================================================
// Seed Demo Data: reviews + price_history (so Sections 4-5 examples are meaningful)
// ============================================================

;(function seedDemoEngagement() {
    function isNumber(x) { return typeof x === "number" && !isNaN(x); }
    function mkHistory(p) {
        if (!isNumber(p)) return [];
        var p1 = Math.max(1, Math.round((p * 0.92) * 100) / 100);
        var p2 = Math.max(1, Math.round((p * 0.98) * 100) / 100);
        var p3 = Math.max(1, Math.round((p * 1.03) * 100) / 100);
        return [
            { date: ISODate("2024-01-15"), price: p1 },
            { date: ISODate("2024-06-01"), price: p2 },
            { date: ISODate("2024-11-20"), price: p3 }
        ];
    }

    var rtx4090 = db.components.find({ type: "GPU", manufacturer: "NVIDIA", "specs.chipset": "GeForce RTX 4090", price: { $type: "number" } }, { _id: 1, price: 1 }).sort({ price: 1 }).limit(1).toArray()[0];
    if (rtx4090) {
        db.components.updateOne(
            { _id: rtx4090._id },
            {
                $set: {
                    reviews: [
                        { user: "gamer2024", rating: 5, comment: "Insane performance for 4K.", date: ISODate("2024-05-01") },
                        { user: "streamer1", rating: 4, comment: "Great, but power hungry.", date: ISODate("2024-07-10") }
                    ],
                    price_history: mkHistory(rtx4090.price)
                }
            }
        );
    }

    var i9 = db.components.findOne({ name: "Intel Core i9-14900K" }, { _id: 1, price: 1 });
    if (i9) {
        db.components.updateOne(
            { _id: i9._id },
            {
                $set: {
                    reviews: [
                        { user: "videoeditor", rating: 5, comment: "Excellent for heavy multi-thread workloads.", date: ISODate("2024-03-18") }
                    ],
                    price_history: mkHistory(i9.price)
                }
            }
        );
    }

    var ryzen7800 = db.components.findOne({ name: "AMD Ryzen 7 7800X3D" }, { _id: 1, price: 1 });
    if (ryzen7800) {
        db.components.updateOne(
            { _id: ryzen7800._id },
            {
                $set: {
                    reviews: [
                        { user: "budgetgamer", rating: 5, comment: "Best gaming CPU for the money.", date: ISODate("2024-04-22") },
                        { user: "gamer2024", rating: 5, comment: "Cool and fast.", date: ISODate("2024-05-02") }
                    ],
                    price_history: mkHistory(ryzen7800.price)
                }
            }
        );
    }

    var ssd990 = db.components.findOne({ name: "Samsung 990 Pro 2TB" }, { _id: 1, price: 1 });
    if (ssd990) {
        db.components.updateOne(
            { _id: ssd990._id },
            {
                $set: {
                    reviews: [
                        { user: "firsttimebuilder", rating: 5, comment: "Super fast boot and load times.", date: ISODate("2024-08-10") }
                    ],
                    price_history: mkHistory(ssd990.price)
                }
            }
        );
    }

})();

}

// ============================================================
// סעיף 3: JSON + JavaScript (פונקציות ועיבוד)
// הערה: טעינת ה-JSON מתבצעת ב-data.js באמצעות cat() + JSON.parse()
// ============================================================

function getCheapCpuNames(limit) {
    var names = [];
    var n = limit || 5;

    // Deterministic: always return the cheapest CPUs with numeric prices
    db.components
        .find({ type: "CPU", price: { $type: "number" } }, { name: 1, price: 1, _id: 0 })
        .sort({ price: 1 })
        .limit(n)
        .forEach(function (doc) {
            names.push(doc.name);
        });

    // Fallback: if no numeric prices exist, still return some CPU names
    if (names.length === 0) {
        db.components
            .find({ type: "CPU" }, { name: 1, _id: 0 })
            .limit(n)
            .forEach(function (doc) {
                names.push(doc.name);
            });
    }
    return names;
}

function findInBudget(min, max) {
    var query = { price: { $gte: min, $lte: max } };
    return db.components.find(query, { name: 1, price: 1, _id: 0 }).limit(3).toArray();
}

function getRamCount() {
    try {
        return db.components.find({ type: "RAM" }).count();
    } catch (e) {
        return db.components.countDocuments({ type: "RAM" });
    }
}

// ============================================================
// סעיף 4: חיפוש/שליפה (find)
// כל הדוגמאות כאן עטופות בפונקציה כדי שהמרצה יוכל להריץ ידנית.
// ============================================================

function section4_findAndQuery() {
    // 1) Simple find with projection
    db.components
        .find({ type: "CPU" }, { name: 1, price: 1, _id: 0 })
        .pretty();

    // 2) Comparison operator $gt
    db.components
        .find({ type: "GPU", price: { $gt: 1000 } }, { name: 1, price: 1, _id: 0 })
        .pretty();

    // 3) Sort + Skip + Limit
    db.components
        .find({}, { name: 1, price: 1, type: 1, _id: 0 })
        .sort({ price: -1 })
        .skip(1)
        .limit(2)
        .pretty();

    // 4) Regex search
    db.components
        .find({ name: { $regex: "ASUS", $options: "i" } }, { name: 1, type: 1, _id: 0 })
        .limit(3)
        .pretty();

    // 5) Logical operator $or
    db.components
        .find({ $or: [{ type: "Case" }, { type: "Power Supply" }] }, { name: 1, type: 1, _id: 0 })
        .limit(4)
        .pretty();

    // 6) Count example
    return getRamCount();
}

// ============================================================
// סעיף 5: עדכונים ומחיקות
// עטוף בפונקציה כדי להריץ ידנית. כולל גם drop/rename/remove לפי הדרישה.
// ============================================================

function section5_updatesAndDeletes() {
    // $set - update a field
    db.components.updateOne(
        { name: "Intel Core i5-14600K" },
        { $set: { "specs.score": 33000, is_featured: true } }
    );

    // $push - add a review
    db.components.updateOne(
        { name: "AMD Ryzen 7 7800X3D" },
        { $push: { reviews: { user: "newreviewer", rating: 5, comment: "Excellent!", date: new Date() } } }
    );

    // $pull - remove a review
    db.components.updateOne(
        { name: "AMD Ryzen 7 7800X3D" },
        { $pull: { reviews: { user: "newreviewer" } } }
    );

    // updateMany - bulk update
    db.components.updateMany({}, { $set: { in_stock: true } });

    // $inc - increase price (and revert)
    var nvidiaIncResult = db.components.updateMany(
        { manufacturer: "NVIDIA", price: { $type: "number" } },
        { $inc: { price: 10 } }
    );
    db.components.updateMany(
        { manufacturer: "NVIDIA", price: { $type: "number" } },
        { $inc: { price: -10 } }
    );

    // $addToSet - add a tag without duplicates
    db.components.updateOne(
        { type: "GPU", manufacturer: "NVIDIA", "specs.chipset": "GeForce RTX 4090" },
        { $addToSet: { tags: "Best Seller" } }
    );

    // $pop - remove last array element
    db.components.updateOne({ name: "Samsung 990 Pro 2TB" }, { $pop: { price_history: 1 } });

    // $unset - remove a field
    db.components.updateOne({ name: "Intel Core i5-14600K" }, { $unset: { is_featured: "" } });

    // deleteOne - delete a document (demo only)
    db.components.insertOne({
        _id: ObjectId(),
        type: "Demo",
        name: "TEMP-DELETE-ME",
        manufacturer: "Demo",
        price: 1,
        tags: ["demo"],
        specs: {},
        requirements: {},
        reviews: [],
        price_history: []
    });
    db.components.deleteOne({ name: "TEMP-DELETE-ME" });

    // --- Collection backup (full) ---
    db.builds_backup.drop();
    db.builds.aggregate([{ $match: {} }, { $out: "builds_backup" }]);

    // Partial backup by criterion
    db.gaming_builds.drop();
    db.builds.aggregate([{ $match: { usage_type: "Gaming" } }, { $out: "gaming_builds" }]);

    // Drop the partial backup collection (drop requirement)
    db.gaming_builds.drop();

    // --- rename + remove requirement (demo on a separate collection) ---
    db.demo_ops.drop();
    db.components.aggregate([
        { $match: { type: "CPU" } },
        { $limit: 5 },
        { $out: "demo_ops" }
    ]);

    // rename
    db.demo_ops.renameCollection("demo_ops_renamed", true);

    // remove (deprecated in newer MongoDB; keep a fallback)
    try {
        db.demo_ops_renamed.remove({});
    } catch (e) {
        db.demo_ops_renamed.deleteMany({});
    }

    // drop
    db.demo_ops_renamed.drop();

    return nvidiaIncResult;
}

// ============================================================
// Section 6: Advanced aggregation - "The Auto-Builder"
// Self-Join Lookup for automatic PC building
// ============================================================

// ============================================================
// The Dynamic Auto-Builder (Function)
// Builds the best full PC possible under a given budget
// Includes physical compatibility checks:
// - CPU socket == Motherboard socket
// - GPU length fits the Case max length
// - PSU wattage meets an estimated requirement
// ============================================================

var buildComputerByBudget = function (maxBudget) {
    db.recommended_combos.drop();

    // Keep a literal string (avoid relying on $toString availability)
    var budgetLabel = maxBudget.toString();

    db.components.aggregate([
        // 1) CPU
        {
            $match: {
                type: "CPU",
                price: { $type: "number" },
                "specs.score": { $type: "number" },
                "requirements.socket_match": { $exists: true, $ne: null }
            }
        },
        { $sort: { "specs.score": -1, price: 1 } },
        { $limit: 30 },

        // 2) Motherboard - Socket compatibility
        {
            $lookup: {
                from: "components",
                let: { cpu_socket: "$requirements.socket_match" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$type", "Motherboard"] },
                                    { $eq: ["$specs.socket", "$$cpu_socket"] },
                                    { $eq: [{ $type: "$price" }, "number"] }
                                ]
                            }
                        }
                    },
                    { $sort: { price: 1 } },
                    { $limit: 5 }
                ],
                as: "mobo"
            }
        },
        { $unwind: "$mobo" },

        // 3) RAM - Generation compatibility (DDR4/DDR5)
        {
            $addFields: {
                required_ram_type: {
                    $ifNull: [
                        "$mobo.specs.ram_type",
                        {
                            $switch: {
                                branches: [
                                    { case: { $eq: ["$mobo.specs.socket", "AM5"] }, then: "DDR5" },
                                    { case: { $eq: ["$mobo.specs.socket", "AM4"] }, then: "DDR4" }
                                ],
                                default: null
                            }
                        }
                    ]
                }
            }
        },
        {
            $lookup: {
                from: "components",
                let: { ram_type: "$required_ram_type" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$type", "RAM"] },
                                    { $eq: [{ $type: "$price" }, "number"] },
                                    {
                                        $cond: [
                                            { $eq: ["$$ram_type", null] },
                                            true,
                                            { $eq: ["$specs.generation", "$$ram_type"] }
                                        ]
                                    }
                                ]
                            }
                        }
                    },
                    { $sort: { "specs.capacity_gb": -1, price: 1 } },
                    { $limit: 3 }
                ],
                as: "ram"
            }
        },
        { $unwind: "$ram" },

        // 4) GPU
        {
            $lookup: {
                from: "components",
                pipeline: [
                    {
                        $match: {
                            type: "GPU",
                            price: { $type: "number" },
                            "specs.score": { $type: "number" },
                            "specs.length_mm": { $type: "number" }
                        }
                    },
                    { $sort: { "specs.score": -1, price: 1 } },
                    { $limit: 10 }
                ],
                as: "gpu"
            }
        },
        { $unwind: "$gpu" },

        // 5) CPU Cooler
        {
            $lookup: {
                from: "components",
                pipeline: [
                    { $match: { type: "CPU Cooler", price: { $type: "number" } } },
                    { $sort: { price: 1 } },
                    { $limit: 1 }
                ],
                as: "cooler"
            }
        },
        { $unwind: "$cooler" },

        // 6) Case - GPU length + Motherboard form factor support
        {
            $lookup: {
                from: "components",
                let: { gpu_len: "$gpu.specs.length_mm", mobo_form: "$mobo.specs.form_factor" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$type", "Case"] },
                                    { $eq: [{ $type: "$price" }, "number"] },
                                    { $gte: ["$specs.max_gpu_length", "$$gpu_len"] },
                                    {
                                        $in: [
                                            "$$mobo_form",
                                            { $ifNull: ["$specs.supported_motherboards", ["ATX", "Micro ATX", "Mini ITX"]] }
                                        ]
                                    }
                                ]
                            }
                        }
                    },
                    { $sort: { price: 1 } },
                    { $limit: 1 }
                ],
                as: "pc_case"
            }
        },
        { $unwind: "$pc_case" },

        // 7) Power Supply - Wattage verification
        {
            $addFields: {
                estimated_required_watts: {
                    $add: [
                        { $ifNull: ["$specs.tdp", 65] },
                        { $multiply: [{ $ifNull: ["$gpu.specs.vram", 8] }, 20] },
                        200
                    ]
                }
            }
        },
        {
            $lookup: {
                from: "components",
                let: { required_watts: "$estimated_required_watts" },
                pipeline: [
                    {
                        $match: {
                            $expr: {
                                $and: [
                                    { $eq: ["$type", "Power Supply"] },
                                    { $eq: [{ $type: "$price" }, "number"] },
                                    { $eq: [{ $type: "$specs.wattage" }, "number"] },
                                    { $gte: ["$specs.wattage", "$$required_watts"] }
                                ]
                            }
                        }
                    },
                    { $sort: { price: 1 } },
                    { $limit: 1 }
                ],
                as: "psu"
            }
        },
        { $unwind: "$psu" },

        // 8) Storage
        {
            $lookup: {
                from: "components",
                pipeline: [
                    { $match: { type: "Storage", price: { $type: "number" }, "specs.capacity_gb": { $type: "number" } } },
                    { $sort: { "specs.capacity_gb": -1, price: 1 } },
                    { $limit: 1 }
                ],
                as: "storage"
            }
        },
        { $unwind: "$storage" },

        // Final output + compatibility report
        {
            $project: {
                _id: 0,
                build_name: {
                    $concat: [
                        "Real-World Build ($",
                        budgetLabel,
                        "): ",
                        "$name",
                        " + ",
                        "$gpu.name"
                    ]
                },
                components: {
                    cpu: "$name",
                    motherboard: "$mobo.name",
                    ram: "$ram.name",
                    gpu: "$gpu.name",
                    case: "$pc_case.name",
                    psu: "$psu.name",
                    storage: "$storage.name",
                    cooler: "$cooler.name"
                },
                compatibility_report: {
                    socket: "VERIFIED: CPU socket matches motherboard socket",
                    ram_generation: "VERIFIED: RAM generation matches motherboard requirement",
                    motherboard_fit: "VERIFIED: Motherboard form factor supported by case",
                    gpu_clearance: "VERIFIED: GPU length fits inside case",
                    power_supply: "VERIFIED: PSU wattage is sufficient"
                },
                compatibility_details: {
                    cpu_socket: "$requirements.socket_match",
                    motherboard_socket: "$mobo.specs.socket",
                    required_ram_type: "$required_ram_type",
                    selected_ram_generation: "$ram.specs.generation",
                    motherboard_form_factor: "$mobo.specs.form_factor",
                    case_supported_motherboards: "$pc_case.specs.supported_motherboards",
                    gpu_length_mm: "$gpu.specs.length_mm",
                    case_max_gpu_length_mm: "$pc_case.specs.max_gpu_length",
                    required_watts_estimate: "$estimated_required_watts",
                    psu_wattage: "$psu.specs.wattage"
                },
                total_price: {
                    $add: [
                        "$price",
                        "$cooler.price",
                        "$mobo.price",
                        "$ram.price",
                        "$gpu.price",
                        "$pc_case.price",
                        "$psu.price",
                        "$storage.price"
                    ]
                },
                performance_score: { $add: ["$specs.score", "$gpu.specs.score"] }
            }
        },

        // Budget filter + pick best
        { $match: { total_price: { $lte: maxBudget } } },
        { $sort: { performance_score: -1, total_price: 1 } },
        { $limit: 1 },
        { $out: "recommended_combos" }
    ]);

    var best = null;
    var count = db.recommended_combos.countDocuments();
    if (count > 0) {
        best = db.recommended_combos.findOne({}, { sort: { performance_score: -1 } });
    }
    return best;
};

// ============================================================
// סעיף 6: aggregate
// יש להריץ ידנית: buildComputerByBudget(<budget>)
// ============================================================

function section6_aggregate() {
    return buildComputerByBudget(3500);
}

// ============================================================
// סעיף 7: mapReduce
// עטוף בפונקציה כדי להריץ ידנית.
// ============================================================

function section7_mapReduce() {
    // MapReduce A: best build per budget tier
    var buildsWithScores = db.builds
        .aggregate([
            {
                $lookup: {
                    from: "components",
                    localField: "parts",
                    foreignField: "_id",
                    as: "part_details"
                }
            },
            {
                $project: {
                    build_name: 1,
                    total_price: 1,
                    cpu_score: {
                        $sum: {
                            $map: {
                                input: {
                                    $filter: {
                                        input: "$part_details",
                                        cond: { $eq: ["$$this.type", "CPU"] }
                                    }
                                },
                                in: "$$this.specs.score"
                            }
                        }
                    },
                    gpu_score: {
                        $sum: {
                            $map: {
                                input: {
                                    $filter: {
                                        input: "$part_details",
                                        cond: { $eq: ["$$this.type", "GPU"] }
                                    }
                                },
                                in: "$$this.specs.score"
                            }
                        }
                    }
                }
            },
            { $addFields: { synthetic_score: { $add: ["$cpu_score", "$gpu_score"] } } }
        ])
        .toArray();

    db.builds_with_scores.drop();
    if (buildsWithScores.length > 0) {
        db.builds_with_scores.insertMany(buildsWithScores);
    }

    var mapBudgetTier = function () {
        var tier = "";
        if (this.total_price < 1000) {
            tier = "$0-$1000";
        } else if (this.total_price < 1500) {
            tier = "$1000-$1500";
        } else if (this.total_price < 2000) {
            tier = "$1500-$2000";
        } else if (this.total_price < 3000) {
            tier = "$2000-$3000";
        } else {
            tier = "$3000+";
        }

        emit(tier, {
            build_id: this._id,
            build_name: this.build_name,
            score: this.synthetic_score,
            price: this.total_price
        });
    };

    var reduceBestBuild = function (key, values) {
        var best = values[0];
        values.forEach(function (v) {
            if (v.score > best.score) {
                best = v;
            }
        });
        return best;
    };

    var finalizeBestBuild = function (key, reducedValue) {
        return {
            budget_tier: key,
            winner: reducedValue.build_name,
            performance_score: reducedValue.score,
            actual_price: reducedValue.price
        };
    };

    db.best_builds_per_tier.drop();
    db.builds_with_scores.mapReduce(mapBudgetTier, reduceBestBuild, {
        out: "best_builds_per_tier",
        finalize: finalizeBestBuild
    });

    // MapReduce B: component stats per manufacturer (with query)
    var mapManufacturer = function () {
        emit(this.manufacturer, { count: 1, totalPrice: this.price });
    };

    var reduceManufacturer = function (key, values) {
        var result = { count: 0, totalPrice: 0 };
        values.forEach(function (v) {
            result.count += v.count;
            result.totalPrice += v.totalPrice;
        });
        return result;
    };

    var finalizeManufacturer = function (key, reducedValue) {
        return {
            manufacturer: key,
            productCount: reducedValue.count,
            avgPrice: Math.round(reducedValue.totalPrice / reducedValue.count)
        };
    };

    db.manufacturer_stats_mr.drop();
    db.components.mapReduce(mapManufacturer, reduceManufacturer, {
        out: "manufacturer_stats_mr",
        query: { price: { $gt: 200 } },
        finalize: finalizeManufacturer
    });

    // MapReduce C: rating distribution (works even if some docs have no reviews)
    var mapRatings = function () {
        if (this.reviews) {
            this.reviews.forEach(function (r) {
                emit(r.rating, 1);
            });
        }
    };

    var reduceRatings = function (key, values) {
        return Array.sum(values);
    };

    var finalizeRatings = function (key, reducedValue) {
        return { rating: key, count: reducedValue };
    };

    db.rating_distribution.drop();
    db.components.mapReduce(mapRatings, reduceRatings, {
        out: "rating_distribution",
        finalize: finalizeRatings
    });

    // MapReduce D: nested loops over users (orders -> items)
    var mapUserGPUSpending = function () {
        var totalGPUSpending = 0;
        var gpuCount = 0;

        if (this.orders) {
            for (var i = 0; i < this.orders.length; i++) {
                var order = this.orders[i];
                if (order.items) {
                    for (var j = 0; j < order.items.length; j++) {
                        var item = order.items[j];
                        if (item.type === "GPU") {
                            totalGPUSpending += item.price * item.quantity;
                            gpuCount += item.quantity;
                        }
                    }
                }
            }
        }

        emit(this.username, {
            totalGPU: totalGPUSpending,
            gpuCount: gpuCount,
            orderCount: this.orders ? this.orders.length : 0
        });
    };

    var reduceUserGPU = function (key, values) {
        var result = { totalGPU: 0, gpuCount: 0, orderCount: 0 };
        values.forEach(function (v) {
            result.totalGPU += v.totalGPU;
            result.gpuCount += v.gpuCount;
            result.orderCount += v.orderCount;
        });
        return result;
    };

    var finalizeUserGPU = function (key, reducedValue) {
        return {
            username: key,
            gpu_spending: reducedValue.totalGPU,
            gpus_purchased: reducedValue.gpuCount,
            total_orders: reducedValue.orderCount
        };
    };

    db.user_gpu_spending.drop();
    db.users.mapReduce(mapUserGPUSpending, reduceUserGPU, {
        out: "user_gpu_spending",
        finalize: finalizeUserGPU
    });

    return {
        best_builds_per_tier: db.best_builds_per_tier.countDocuments(),
        manufacturer_stats_mr: db.manufacturer_stats_mr.countDocuments(),
        rating_distribution: db.rating_distribution.countDocuments(),
        user_gpu_spending: db.user_gpu_spending.countDocuments()
    };
}

// ריצה ידנית מומלצת לפי סדר הסעיפים:
// 1) (כבר רץ למעלה) הקמה + insertMany/insertOne
// 2) section4_findAndQuery()
// 3) section5_updatesAndDeletes()
// 4) section6_aggregate() או buildComputerByBudget(<budget>)
// 5) section7_mapReduce()
