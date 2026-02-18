// ============================================================
// Mongo-PartPicker - Data (extracted)
//
// This file defines the raw* arrays used by the ETL in project.js.
// It intentionally keeps the main script smaller.
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
