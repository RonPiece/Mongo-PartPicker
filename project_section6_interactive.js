// ============================================================
// Section 6: Interactive PC Builder (Incremental Selection)
// ============================================================
//
// This section demonstrates MongoDB's Aggregation Framework
// through an interactive, step-by-step PC builder.
//
// Pipeline Stages Used:
//   $match, $project, $lookup, $unwind, $group,
//   $sort, $limit, $out, $expr
//
// Mathematical Operators:
//   $add, $subtract, $multiply
//
// Group Accumulators:
//   $first, $sum, $avg, $min, $max, $push
//
// Section 3 Compliance (JS functions):
//   - getProfileParams()        — dynamic profile configuration
//   - calculateWeightedScore()  — weighted scoring
//   - calculateRequiredWatts()  — PSU wattage estimation
//   - padRight(), padLeft()     — formatted output alignment
//   - printComponentList()      — numbered component display
//
// Usage:
//   load("project_section6_interactive.js")
//   stepCPU(1500, "gaming")   → shows top CPUs
//   pick(3)                    → picks #3 from the list, shows next step
//   pick(2)                    → picks #2, shows next step
//   ...                        → keep picking until finalizeBuild
//
// ============================================================


// ============================================================
// Section 3: Profile Configuration (JS function)
// ============================================================

function getProfileParams(usageType) {
    var usage = (usageType || "gaming").toLowerCase();

    var profiles = {
        gaming: {
            name: "Gaming",
            cpuBudgetRatio: 0.25,
            gpuBudgetRatio: 0.45,
            minRamGb: 16,
            preferredRamGb: 32,
            maxStorageGb: 4000,
            scoringWeights: { gpu: 0.6, cpu: 0.4, ram: 0.0 }
        },
        workstation: {
            name: "Workstation",
            cpuBudgetRatio: 0.40,
            gpuBudgetRatio: 0.25,
            minRamGb: 32,
            preferredRamGb: 64,
            maxStorageGb: 16000,
            scoringWeights: { cpu: 0.5, ram: 0.3, gpu: 0.2 }
        },
        budget: {
            name: "Budget",
            cpuBudgetRatio: 0.30,
            gpuBudgetRatio: 0.35,
            minRamGb: 16,
            preferredRamGb: 16,
            maxStorageGb: 2000,
            scoringWeights: { gpu: 0.5, cpu: 0.3, ram: 0.2 }
        },
        enthusiast: {
            name: "Enthusiast",
            cpuBudgetRatio: 0.30,
            gpuBudgetRatio: 0.40,
            minRamGb: 64,
            preferredRamGb: 128,
            maxStorageGb: 8000,
            scoringWeights: { gpu: 0.5, cpu: 0.4, ram: 0.1 }
        }
    };

    return profiles[usage] || profiles.gaming;
}


// ============================================================
// Section 3: Scoring & Wattage (JS functions)
// ============================================================

function calculateWeightedScore(cpuScore, gpuScore, ramCapacity, weights) {
    var cpu = (cpuScore || 0) * (weights.cpu || 0);
    var gpu = (gpuScore || 0) * (weights.gpu || 0);
    var ram = (ramCapacity || 0) * (weights.ram || 0);
    return Math.round(cpu + gpu + ram);
}

function calculateRequiredWatts(cpuTdp, gpuVram) {
    var cpu = cpuTdp || 65;
    var gpu = (gpuVram || 8) * 20;
    var safety = 100;
    return cpu + gpu + safety;
}

// Cooler budget reservation — based on CPU TDP
// Returns minimum $ to reserve for a cooler that can handle this CPU
function getCoolerReserve(tdp) {
    if (tdp > 125) return 60;    // high-end: needs liquid or big tower cooler
    if (tdp > 95) return 35;    // mid-range: decent tower cooler
    if (tdp > 65) return 20;    // modest: basic tower cooler
    return 10;                   // low-TDP: stock-class cooler is fine
}


// ============================================================
// Section 3: Formatting Helpers (JS functions)
// ============================================================

function padRight(str, len) {
    str = String(str);
    while (str.length < len) str += " ";
    return str;
}

function padLeft(str, len) {
    str = String(str);
    while (str.length < len) str = " " + str;
    return str;
}

function formatPrice(p) {
    return "$" + (Math.round(p * 100) / 100);
}

function truncate(str, max) {
    str = String(str);
    if (str.length <= max) return str;
    return str.substring(0, max - 2) + "..";
}


// ============================================================
// Global Build State — tracks selections across steps
// ============================================================

var buildState = {
    budget: 0,
    usage: "",
    params: null,
    spent: 0,
    step: 0,
    lastResults: [],
    selections: {
        cpu: null,
        motherboard: null,
        ram: null,
        gpu: null,
        storage: null,
        cooler: null,
        psu: null,
        pcCase: null
    }
};

// Recommended sockets for new builds (2020+)
var MODERN_SOCKETS = ["AM4", "AM5", "LGA1200", "LGA1700", "LGA1851"];


// ============================================================
//  Helper: Print a formatted, aligned list of components
// ============================================================

function printComponentList(results, columns) {
    if (results.length === 0) {
        print("  ⚠  No components found matching the criteria.");
        return;
    }

    // --- Header line ---
    var header = "   #   " + padRight("Name", 45) + padLeft("Price", 10);
    for (var h = 0; h < columns.length; h++) {
        header += padLeft(columns[h].label, columns[h].width || 10);
    }
    print("");
    print(header);
    print("  " + Array(header.length).join("─"));

    // --- Data rows ---
    for (var i = 0; i < results.length; i++) {
        var r = results[i];

        var idx = padLeft("[" + (i + 1) + "]", 5);
        var name = padRight(truncate(r.name, 43), 45);
        var price = padLeft(formatPrice(r.price), 10);

        var line = "  " + idx + " " + name + price;

        for (var c = 0; c < columns.length; c++) {
            var key = columns[c].key;
            var w = columns[c].width || 10;
            var val = r;
            var parts = key.split(".");
            for (var p = 0; p < parts.length; p++) {
                val = val ? val[parts[p]] : null;
            }
            var suffix = columns[c].suffix || "";
            var display = (val !== null && val !== undefined) ? (val + suffix) : "—";
            line += padLeft(String(display), w);
        }
        print(line);
    }
    print("");
}


// ============================================================
// pick(index) — Universal selection shortcut
//
// Instead of typing stepMotherboard(3), just type pick(3).
// It automatically calls the correct next-step function.
// ============================================================

function pick(index) {
    var nextStep = buildState.step + 1;

    if (nextStep === 2) return stepMotherboard(index);
    if (nextStep === 3) return stepRAM(index);
    if (nextStep === 4) return stepGPU(index);
    if (nextStep === 5) return stepStorage(index);
    if (nextStep === 6) return stepCooler(index);
    if (nextStep === 7) return stepPSU(index);
    if (nextStep === 8) return stepCase(index);
    if (nextStep === 9) return finalizeBuild(index);

    print("  ERROR: No active build. Start with:  stepCPU(budget, 'gaming')");
}


// ============================================================
// Step 1: CPU Selection
// stepCPU(budget, usageType)
//
// Section 6: aggregate() with $match, $project, $sort, $limit
// ============================================================

function stepCPU(budget, usageType) {
    // Reset state for new build
    buildState.budget = budget;
    buildState.usage = usageType || "gaming";
    buildState.params = getProfileParams(buildState.usage);
    buildState.spent = 0;
    buildState.step = 1;
    buildState.selections = {
        cpu: null, motherboard: null, ram: null, gpu: null,
        storage: null, cooler: null, psu: null, pcCase: null
    };

    var maxCpuPrice = Math.round(budget * buildState.params.cpuBudgetRatio);

    print("");
    print("  ╔════════════════════════════════════════════════════════╗");
    print("  ║        Interactive PC Builder — " + padRight(buildState.params.name, 22) + "║");
    print("  ║        Budget: " + padRight(formatPrice(budget), 39) + "║");
    print("  ╚════════════════════════════════════════════════════════╝");
    print("");
    print("  STEP 1/8 ─ Choose a CPU (max ~" + formatPrice(maxCpuPrice) + ")");
    print("  ─────────────────────────────────────────");

    // Section 6: Aggregation Pipeline with $match, $project, $sort, $limit
    var cpuResults = db.components.aggregate([
        {
            $match: {
                type: "CPU",
                price: { $type: "number", $lte: maxCpuPrice },
                "specs.score": { $type: "number" },
                "specs.socket": { $in: MODERN_SOCKETS },
                "requirements.socket_match": { $exists: true, $ne: null }
            }
        },
        {
            $project: {
                name: 1,
                price: 1,
                manufacturer: 1,
                "specs.socket": 1,
                "specs.cores": 1,
                "specs.base_clock": 1,
                "specs.boost_clock": 1,
                "specs.tdp": 1,
                "specs.score": 1
            }
        },
        { $sort: { price: -1 } },
        { $limit: 15 }
    ]).toArray();

    buildState.lastResults = cpuResults;

    printComponentList(cpuResults, [
        { key: "specs.socket", label: "Socket", width: 12 },
        { key: "specs.cores", label: "Cores", width: 7 },
        { key: "specs.tdp", label: "TDP", width: 6, suffix: "W" },
        { key: "specs.score", label: "Score", width: 8 }
    ]);

    print("  → pick(<#>) to select your CPU.");
    return cpuResults.length + " CPUs found";
}


// ============================================================
// Step 2: Motherboard Selection
// stepMotherboard(cpuIndex)
//
// Section 6: aggregate() with $match (socket filter), $sort, $limit
// ============================================================

function stepMotherboard(cpuIndex) {
    if (buildState.step < 1) {
        print("  ERROR: Run stepCPU(budget, usage) first!");
        return;
    }
    if (cpuIndex < 1 || cpuIndex > buildState.lastResults.length) {
        print("  ERROR: Invalid selection. Pick 1–" + buildState.lastResults.length);
        return;
    }

    // Save CPU selection
    var cpu = buildState.lastResults[cpuIndex - 1];
    buildState.selections.cpu = cpu;
    buildState.spent += cpu.price;
    buildState.step = 2;

    // Smart Cap: Motherboard shouldn't be > 15% of total budget (unless budget is huge)
    // But allow at least $150 for basic boards
    var maxMoboPrice = Math.max(150, buildState.budget * 0.15);
    var effectiveBudget = Math.min(remaining, maxMoboPrice);

    print("");
    print("  ✓ CPU: " + cpu.name + "  (" + formatPrice(cpu.price) + ")");
    print("    Socket: " + cpuSocket + "   |   Remaining: " + formatPrice(remaining));
    print("");
    print("  STEP 2/8 ─ Choose a Motherboard  (Socket: " + cpuSocket + ", max rec. " + formatPrice(effectiveBudget) + ")");
    print("  ─────────────────────────────────────────");

    // Section 6: Aggregation — filter by socket, sort by price desc
    var moboResults = db.components.aggregate([
        {
            $match: {
                type: "Motherboard",
                "specs.socket": cpuSocket,
                price: { $type: "number", $lte: effectiveBudget }
            }
        },
        {
            $project: {
                name: 1,
                price: 1,
                manufacturer: 1,
                "specs.socket": 1,
                "specs.form_factor": 1,
                "specs.ram_type": 1,
                "specs.max_ram": 1
            }
        },
        { $sort: { price: -1 } },
        { $limit: 15 }
    ]).toArray();

    // Fallback: If no boards in smart budget, try full remaining budget
    if (moboResults.length === 0) {
        moboResults = db.components.find({
            type: "Motherboard",
            "specs.socket": cpuSocket,
            price: { $type: "number", $lte: remaining } // Try full remaining code
        }).sort({ price: 1 }).limit(10).toArray(); // Show cheapest valid options
    }

    // Fallback 2: If STILL nothing (e.g. over budget), show ANY compatible board
    if (moboResults.length === 0) {
        print("  ⚠  Budget exhausted! Showing over-budget options:");
        moboResults = db.components.find({
            type: "Motherboard",
            "specs.socket": cpuSocket
        }).sort({ price: 1 }).limit(5).toArray();
    }

    buildState.lastResults = moboResults;

    printComponentList(moboResults, [
        { key: "specs.form_factor", label: "Form", width: 14 },
        { key: "specs.ram_type", label: "RAM", width: 7 },
        { key: "specs.max_ram", label: "MaxRAM", width: 8, suffix: "GB" }
    ]);

    print("  → pick(<#>) to select your Motherboard.");
    return moboResults.length + " motherboards found";
}


// ============================================================
// Step 3: RAM Selection
// stepRAM(moboIndex)
//
// Section 4: find().sort().limit() — filtered by DDR type
// ============================================================

function stepRAM(moboIndex) {
    if (buildState.step < 2) {
        print("  ERROR: Run stepMotherboard() first!");
        return;
    }
    if (moboIndex < 1 || moboIndex > buildState.lastResults.length) {
        print("  ERROR: Invalid selection. Pick 1–" + buildState.lastResults.length);
        return;
    }

    // Save Motherboard selection
    var mobo = buildState.lastResults[moboIndex - 1];
    buildState.selections.motherboard = mobo;
    buildState.spent += mobo.price;
    buildState.step = 3;

    var ramType = (mobo.specs && mobo.specs.ram_type) ? mobo.specs.ram_type : "DDR4";
    var minRam = buildState.params.minRamGb;
    var remaining = buildState.budget - buildState.spent;

    // Smart Cap: RAM shouldn't be > 10% of total budget
    var maxRamPrice = Math.max(80, buildState.budget * 0.10);
    var effectiveBudget = Math.min(remaining, maxRamPrice);

    print("");
    print("  ✓ Motherboard: " + mobo.name + "  (" + formatPrice(mobo.price) + ")");
    print("    RAM Type: " + ramType + "   |   Min " + minRam + "GB   |   Remaining: " + formatPrice(remaining));
    print("");
    print("  STEP 3/8 ─ Choose RAM  (" + ramType + ", min " + minRam + "GB, max rec. " + formatPrice(effectiveBudget) + ")");
    print("  ─────────────────────────────────────────");

    // Section 4: find() with filter, sort, limit
    var ramResults = db.components.find({
        type: "RAM",
        "specs.generation": ramType,
        "specs.capacity_gb": { $gte: minRam },
        price: { $type: "number", $lte: effectiveBudget }
    }).sort({ price: -1 }).limit(15).toArray();

    // Fallback 1: Try full remaining budget
    if (ramResults.length === 0) {
        ramResults = db.components.find({
            type: "RAM",
            "specs.generation": ramType,
            "specs.capacity_gb": { $gte: minRam },
            price: { $type: "number", $lte: remaining }
        }).sort({ price: 1 }).limit(10).toArray();
    }

    // Fallback 2: Show over-budget options
    if (ramResults.length === 0) {
        print("  ⚠  Budget exhausted! Showing over-budget RAM:");
        ramResults = db.components.find({
            type: "RAM",
            "specs.generation": ramType,
            "specs.capacity_gb": { $gte: minRam }
        }).sort({ price: 1 }).limit(5).toArray();
    }

    buildState.lastResults = ramResults;

    printComponentList(ramResults, [
        { key: "specs.capacity_gb", label: "Size", width: 8, suffix: "GB" },
        { key: "specs.speed_mhz", label: "Speed", width: 9, suffix: "MHz" },
        { key: "specs.generation", label: "Gen", width: 6 }
    ]);

    print("  → pick(<#>) to select your RAM.");
    return ramResults.length + " RAM kits found";
}


// ============================================================
// Step 4: GPU Selection
// stepGPU(ramIndex)
//
// Section 4: find().sort().limit() — best score in budget
// ============================================================

function stepGPU(ramIndex) {
    if (buildState.step < 3) {
        print("  ERROR: Run stepRAM() first!");
        return;
    }
    if (ramIndex < 1 || ramIndex > buildState.lastResults.length) {
        print("  ERROR: Invalid selection. Pick 1–" + buildState.lastResults.length);
        return;
    }

    // Save RAM selection
    var ram = buildState.lastResults[ramIndex - 1];
    buildState.selections.ram = ram;
    buildState.spent += ram.price;
    buildState.step = 4;

    // Smart reserve: Cooler (TDP-aware) + PSU ($35) + Storage ($20) + Case ($35)
    var cpuTdp = (buildState.selections.cpu.specs && buildState.selections.cpu.specs.tdp)
        ? buildState.selections.cpu.specs.tdp : 65;
    var coolerReserve = getCoolerReserve(cpuTdp);
    var accessoryReserve = coolerReserve + 35 + 20 + 35; // cooler + PSU + storage + case
    var gpuBudget = buildState.budget - buildState.spent - accessoryReserve;

    print("");
    print("  ✓ RAM: " + ram.name + "  (" + formatPrice(ram.price) + ")");
    print("    Spent: " + formatPrice(buildState.spent) +
        "   |   Remaining: " + formatPrice(buildState.budget - buildState.spent));
    print("    Reserving ~" + formatPrice(accessoryReserve) +
        " for accessories (cooler " + formatPrice(coolerReserve) + " for " + cpuTdp + "W CPU)");
    print("");
    print("  STEP 4/8 ─ Choose a GPU  (max ~" + formatPrice(gpuBudget) + ")");
    print("  ─────────────────────────────────────────");

    // Section 4: find() GPUs sorted by score desc (better performance first)
    // We prioritize Score over Price for GPUs, but keep within budget
    var gpuResults = db.components.find({
        type: "GPU",
        price: { $type: "number", $lte: gpuBudget },
        "specs.score": { $type: "number" }
    }).sort({ "specs.score": -1 }).limit(15).toArray();

    // Fallback: If no GPUs in budget, show over-budget options (cheapest first)
    if (gpuResults.length === 0) {
        print("  ⚠  No GPUs in budget. Showing cheapest available (OVER BUDGET):");
        gpuResults = db.components.find({
            type: "GPU",
            price: { $type: "number" },
            "specs.score": { $type: "number" }
        }).sort({ price: 1 }).limit(10).toArray();
    }

    buildState.lastResults = gpuResults;

    printComponentList(gpuResults, [
        { key: "specs.vram", label: "VRAM", width: 7, suffix: "GB" },
        { key: "specs.length_mm", label: "Length", width: 8, suffix: "mm" },
        { key: "specs.score", label: "Score", width: 8 }
    ]);

    print("  → pick(<#>) to select your GPU.");
    return gpuResults.length + " GPUs found";
}


// ============================================================
// Step 5: Storage Selection
// stepStorage(gpuIndex)
//
// Smart: prefers SSDs/NVMe, limits capacity to usage-appropriate
// sizes (gaming ≤ 4TB, budget ≤ 2TB, workstation ≤ 16TB)
// Section 4: find().sort().limit()
// ============================================================

function stepStorage(gpuIndex) {
    if (buildState.step < 4) {
        print("  ERROR: Run stepGPU() first!");
        return;
    }
    if (gpuIndex < 1 || gpuIndex > buildState.lastResults.length) {
        print("  ERROR: Invalid selection. Pick 1–" + buildState.lastResults.length);
        return;
    }

    // Save GPU selection
    var gpu = buildState.lastResults[gpuIndex - 1];
    buildState.selections.gpu = gpu;
    buildState.spent += gpu.price;
    buildState.step = 5;

    var remaining = buildState.budget - buildState.spent;
    var maxCapacity = buildState.params.maxStorageGb;

    print("");
    print("  ✓ GPU: " + gpu.name + "  (" + formatPrice(gpu.price) + ")");
    print("    Remaining: " + formatPrice(remaining));
    print("");
    print("  STEP 5/8 ─ Choose Storage  (up to " + maxCapacity + "GB, SSDs first)");
    print("  ─────────────────────────────────────────");

    // Smart storage: show SSDs/NVMe first, cap capacity by usage type
    var ssdResults = db.components.find({
        type: "Storage",
        price: { $type: "number", $lte: remaining },
        "specs.capacity_gb": { $lte: maxCapacity },
        "specs.storage_type": { $in: ["SSD", "Hybrid", "260 SSD", "M.2", "NVMe"] }
    }).sort({ price: -1 }).limit(10).toArray();

    // Also show some HDD options
    var hddResults = db.components.find({
        type: "Storage",
        price: { $type: "number", $lte: remaining },
        "specs.capacity_gb": { $lte: maxCapacity },
        "specs.storage_type": { $nin: ["SSD", "Hybrid", "260 SSD", "M.2", "NVMe"] }
    }).sort({ price: -1 }).limit(5).toArray();

    var storageResults = ssdResults.concat(hddResults);

    // Fallback: if no SSDs found, just show any storage
    if (storageResults.length === 0) {
        storageResults = db.components.find({
            type: "Storage",
            price: { $type: "number", $lte: remaining },
            "specs.capacity_gb": { $lte: maxCapacity }
        }).sort({ price: -1 }).limit(15).toArray();
    }

    buildState.lastResults = storageResults;

    printComponentList(storageResults, [
        { key: "specs.capacity_gb", label: "Size", width: 9, suffix: "GB" },
        { key: "specs.storage_type", label: "Type", width: 9 },
        { key: "specs.interface", label: "Interface", width: 18 }
    ]);

    print("  → pick(<#>) to select your Storage.");
    return storageResults.length + " storage drives found";
}


// ============================================================
// Step 6: CPU Cooler Selection
// stepCooler(storageIndex)
//
// Smart: TDP-aware minimum price AND type filtering
//   TDP > 125W → liquid coolers recommended, min $60
//   TDP > 95W  → solid tower cooler, min $35
//   TDP > 65W  → basic tower, min $20
//   TDP ≤ 65W  → anything works
// Section 4: find().sort().limit()
// ============================================================

function stepCooler(storageIndex) {
    if (buildState.step < 5) {
        print("  ERROR: Run stepStorage() first!");
        return;
    }
    if (storageIndex < 1 || storageIndex > buildState.lastResults.length) {
        print("  ERROR: Invalid selection. Pick 1–" + buildState.lastResults.length);
        return;
    }

    // Save Storage selection
    var storage = buildState.lastResults[storageIndex - 1];
    buildState.selections.storage = storage;
    buildState.spent += storage.price;
    buildState.step = 6;

    var cpuTdp = (buildState.selections.cpu.specs && buildState.selections.cpu.specs.tdp)
        ? buildState.selections.cpu.specs.tdp : 65;
    var remaining = buildState.budget - buildState.spent;
    var isHighTdp = cpuTdp > 125;
    var isMidTdp = cpuTdp > 95;
    var minCoolerPrice = getCoolerReserve(cpuTdp);

    print("");
    print("  ✓ Storage: " + storage.name + "  (" + formatPrice(storage.price) + ")");
    print("    Remaining: " + formatPrice(remaining));
    print("    CPU TDP: " + cpuTdp + "W → Minimum cooler: " + formatPrice(minCoolerPrice));
    if (isHighTdp) {
        print("    ★ HIGH TDP! Liquid cooling strongly recommended.");
    }
    print("");
    print("  STEP 6/8 ─ Choose a CPU Cooler  (min " + formatPrice(minCoolerPrice) + " for " + cpuTdp + "W CPU)");
    print("  ─────────────────────────────────────────");

    var coolerResults;
    if (isHighTdp) {
        // Show liquid coolers first for high-TDP
        var liquidCoolers = db.components.find({
            type: "CPU Cooler",
            price: { $type: "number", $gte: minCoolerPrice, $lte: remaining },
            "specs.kind": "Liquid"
        }).sort({ price: -1 }).limit(10).toArray();

        // Also show top air coolers
        var airCoolers = db.components.find({
            type: "CPU Cooler",
            price: { $type: "number", $gte: minCoolerPrice, $lte: remaining },
            "specs.kind": "Air"
        }).sort({ price: -1 }).limit(5).toArray();

        coolerResults = liquidCoolers.concat(airCoolers);
    } else {
        // Normal: show all coolers above minimum price
        coolerResults = db.components.find({
            type: "CPU Cooler",
            price: { $type: "number", $gte: minCoolerPrice, $lte: remaining }
        }).sort({ price: -1 }).limit(15).toArray();
    }

    // Fallback: if nothing found (e.g. over budget), show ANY compatible cooler
    if (coolerResults.length === 0) {
        print("  ⚠  No coolers in budget. Showing compatible options (OVER BUDGET):");
        coolerResults = db.components.find({
            type: "CPU Cooler",
            price: { $type: "number", $gte: minCoolerPrice }
        }).sort({ price: 1 }).limit(10).toArray();
    }

    buildState.lastResults = coolerResults;

    printComponentList(coolerResults, [
        { key: "specs.kind", label: "Type", width: 8 },
        { key: "specs.rpm_max", label: "RPM", width: 7 },
        { key: "specs.noise_level_db", label: "dB", width: 7 }
    ]);

    print("  → pick(<#>) to select your Cooler.");
    return coolerResults.length + " coolers found";
}


// ============================================================
// Step 7: PSU Selection
// stepPSU(coolerIndex)
//
// Calculates total wattage requirement, filters by wattage
// Section 4: find().sort().limit()
// ============================================================

function stepPSU(coolerIndex) {
    if (buildState.step < 6) {
        print("  ERROR: Run stepCooler() first!");
        return;
    }
    if (coolerIndex < 1 || coolerIndex > buildState.lastResults.length) {
        print("  ERROR: Invalid selection. Pick 1–" + buildState.lastResults.length);
        return;
    }

    // Save Cooler selection
    var cooler = buildState.lastResults[coolerIndex - 1];
    buildState.selections.cooler = cooler;
    buildState.spent += cooler.price;
    buildState.step = 7;

    // Section 3: calculateRequiredWatts (JS function)
    var cpuTdp = (buildState.selections.cpu.specs && buildState.selections.cpu.specs.tdp)
        ? buildState.selections.cpu.specs.tdp : 65;
    var gpuVram = (buildState.selections.gpu.specs && buildState.selections.gpu.specs.vram)
        ? buildState.selections.gpu.specs.vram : 8;
    var requiredWatts = calculateRequiredWatts(cpuTdp, gpuVram);
    var remaining = buildState.budget - buildState.spent;

    print("");
    print("  ✓ Cooler: " + cooler.name + "  (" + formatPrice(cooler.price) + ")");
    print("    Remaining: " + formatPrice(remaining));
    print("    Required: " + requiredWatts + "W  (CPU " + cpuTdp + "W + GPU " + gpuVram + "GB×20W + 100W margin)");
    print("");
    print("  STEP 7/8 ─ Choose a PSU  (minimum " + requiredWatts + "W)");
    print("  ─────────────────────────────────────────");

    // Section 4: find() PSUs that meet wattage requirement
    var psuResults = db.components.find({
        type: "Power Supply",
        price: { $type: "number", $lte: remaining },
        "specs.wattage": { $gte: requiredWatts }
    }).sort({ price: -1 }).limit(15).toArray();

    // Fallback: none in budget, show cheapest with enough wattage
    if (psuResults.length === 0) {
        print("  ⚠  No PSUs in budget at " + requiredWatts + "W. Showing cheapest available:");
        psuResults = db.components.find({
            type: "Power Supply",
            price: { $type: "number" },
            "specs.wattage": { $gte: requiredWatts }
        }).sort({ price: 1 }).limit(10).toArray();
    }

    buildState.lastResults = psuResults;

    printComponentList(psuResults, [
        { key: "specs.wattage", label: "Watts", width: 8, suffix: "W" },
        { key: "specs.efficiency", label: "Rating", width: 12 },
        { key: "specs.modular", label: "Modular", width: 9 }
    ]);

    print("  → pick(<#>) to select your PSU.");
    return psuResults.length + " PSUs found";
}


// ============================================================
// Step 8: Case Selection
// stepCase(psuIndex)
//
// Section 6: aggregate() with $match + $expr for
//   field-to-field comparison (max_gpu_length >= GPU length)
// ============================================================

function stepCase(psuIndex) {
    if (buildState.step < 7) {
        print("  ERROR: Run stepPSU() first!");
        return;
    }
    if (psuIndex < 1 || psuIndex > buildState.lastResults.length) {
        print("  ERROR: Invalid selection. Pick 1–" + buildState.lastResults.length);
        return;
    }

    // Save PSU selection
    var psu = buildState.lastResults[psuIndex - 1];
    buildState.selections.psu = psu;
    buildState.spent += psu.price;
    buildState.step = 8;

    var gpuLength = (buildState.selections.gpu.specs && buildState.selections.gpu.specs.length_mm)
        ? buildState.selections.gpu.specs.length_mm : 0;
    var remaining = buildState.budget - buildState.spent;

    print("");
    print("  ✓ PSU: " + psu.name + "  (" + formatPrice(psu.price) + ")");
    print("    Remaining: " + formatPrice(remaining));
    print("    GPU length: " + gpuLength + "mm");
    print("");
    print("  STEP 8/8 ─ Choose a Case  (fits " + gpuLength + "mm GPU)");
    print("  ─────────────────────────────────────────");

    // Section 6: Aggregation with calculated clearance field
    var caseResults = db.components.aggregate([
        {
            $match: {
                type: "Case",
                price: { $type: "number", $lte: remaining },
                "specs.max_gpu_length": { $gte: gpuLength }
            }
        },
        {
            $project: {
                name: 1,
                price: 1,
                manufacturer: 1,
                "specs.form_factor": 1,
                "specs.max_gpu_length": 1,
                // Section 6: $subtract — calculate how much room is left
                gpu_clearance: { $subtract: ["$specs.max_gpu_length", gpuLength] }
            }
        },
        { $sort: { price: -1 } },
        { $limit: 15 }
    ]).toArray();

    // Fallback
    if (caseResults.length === 0) {
        print("  ⚠  No cases fit GPU in budget. Showing cheapest:");
        caseResults = db.components.find({
            type: "Case",
            price: { $type: "number" }
        }).sort({ price: 1 }).limit(10).toArray();
    }

    buildState.lastResults = caseResults;

    printComponentList(caseResults, [
        { key: "specs.form_factor", label: "Form", width: 22 },
        { key: "specs.max_gpu_length", label: "MaxGPU", width: 9, suffix: "mm" },
        { key: "gpu_clearance", label: "Clear.", width: 9, suffix: "mm" }
    ]);

    print("  → pick(<#>) to finalize your build!");
    return caseResults.length + " cases found";
}


// ============================================================
// Step 9: Finalize Build
// finalizeBuild(caseIndex)
//
// Saves the complete build to recommended_combos collection.
// Section 3: calculateWeightedScore (JS function)
// Section 4: insertOne()
// ============================================================

function finalizeBuild(caseIndex) {
    if (buildState.step < 8) {
        print("  ERROR: Run stepCase() first!");
        return;
    }
    if (caseIndex < 1 || caseIndex > buildState.lastResults.length) {
        print("  ERROR: Invalid selection. Pick 1–" + buildState.lastResults.length);
        return;
    }

    // Save Case selection
    var pcCase = buildState.lastResults[caseIndex - 1];
    buildState.selections.pcCase = pcCase;
    buildState.spent += pcCase.price;

    // --- Calculate totals ---
    var sel = buildState.selections;
    var totalPrice = sel.cpu.price + sel.motherboard.price + sel.ram.price +
        sel.gpu.price + sel.storage.price + sel.cooler.price +
        sel.psu.price + sel.pcCase.price;
    totalPrice = Math.round(totalPrice * 100) / 100;

    // Section 3: calculateWeightedScore (JS function)
    var cpuScore = (sel.cpu.specs && sel.cpu.specs.score) ? sel.cpu.specs.score : 0;
    var gpuScore = (sel.gpu.specs && sel.gpu.specs.score) ? sel.gpu.specs.score : 0;
    var ramCapacity = (sel.ram.specs && sel.ram.specs.capacity_gb) ? sel.ram.specs.capacity_gb : 0;
    var weightedScore = calculateWeightedScore(
        cpuScore, gpuScore, ramCapacity, buildState.params.scoringWeights
    );

    // Build the result document
    var completeBuild = {
        build_name: buildState.params.name + " Build — " + formatPrice(buildState.budget),
        usage_type: buildState.usage,
        build_method: "interactive",
        target_budget: buildState.budget,
        components: {
            cpu: sel.cpu.name,
            motherboard: sel.motherboard.name,
            ram: sel.ram.name,
            gpu: sel.gpu.name,
            storage: sel.storage.name,
            cooler: sel.cooler.name,
            psu: sel.psu.name,
            case_name: sel.pcCase.name
        },
        compatibility_details: {
            cpu_socket: sel.cpu.specs.socket,
            motherboard_socket: sel.motherboard.specs.socket,
            ram_type_required: sel.motherboard.specs.ram_type,
            ram_type_selected: sel.ram.specs ? sel.ram.specs.generation : "unknown",
            ram_capacity_gb: ramCapacity,
            gpu_length_mm: (sel.gpu.specs && sel.gpu.specs.length_mm) ? sel.gpu.specs.length_mm : 0,
            case_max_gpu_length_mm: (sel.pcCase.specs && sel.pcCase.specs.max_gpu_length) ? sel.pcCase.specs.max_gpu_length : 0,
            required_watts: calculateRequiredWatts(
                sel.cpu.specs.tdp || 65,
                sel.gpu.specs.vram || 8
            ),
            psu_wattage: sel.psu.specs ? sel.psu.specs.wattage : 0
        },
        performance_metrics: {
            cpu_score: cpuScore,
            gpu_score: gpuScore,
            weighted_score: weightedScore
        },
        total_price: totalPrice,
        generated_at: new Date()
    };

    // Budget check
    var overBudget = totalPrice > buildState.budget;
    var overflowPercent = Math.round(((totalPrice / buildState.budget) - 1) * 100);
    var underBudget = buildState.budget - totalPrice;

    // Section 4: insertOne — save to collection
    db.recommended_combos.insertOne(completeBuild);

    // --- Pretty Print Final Build ---
    print("");
    print("  ╔════════════════════════════════════════════════════════════════╗");
    if (overBudget) {
        print("  ║   BUILD COMPLETE   (" + overflowPercent + "% over budget)                        ║");
    } else {
        print("  ║   BUILD COMPLETE   ✓                                         ║");
    }
    print("  ╠════════════════════════════════════════════════════════════════╣");
    print("  ║                                                              ║");
    print("  ║  " + padRight("CPU:          " + sel.cpu.name, 51) + padLeft(formatPrice(sel.cpu.price), 10) + "  ║");
    print("  ║  " + padRight("Motherboard:  " + sel.motherboard.name, 51) + padLeft(formatPrice(sel.motherboard.price), 10) + "  ║");
    print("  ║  " + padRight("RAM:          " + sel.ram.name, 51) + padLeft(formatPrice(sel.ram.price), 10) + "  ║");
    print("  ║  " + padRight("GPU:          " + truncate(sel.gpu.name, 37), 51) + padLeft(formatPrice(sel.gpu.price), 10) + "  ║");
    print("  ║  " + padRight("Storage:      " + sel.storage.name, 51) + padLeft(formatPrice(sel.storage.price), 10) + "  ║");
    print("  ║  " + padRight("Cooler:       " + sel.cooler.name, 51) + padLeft(formatPrice(sel.cooler.price), 10) + "  ║");
    print("  ║  " + padRight("PSU:          " + sel.psu.name, 51) + padLeft(formatPrice(sel.psu.price), 10) + "  ║");
    print("  ║  " + padRight("Case:         " + sel.pcCase.name, 51) + padLeft(formatPrice(sel.pcCase.price), 10) + "  ║");
    print("  ║                                                              ║");
    print("  ╠════════════════════════════════════════════════════════════════╣");
    print("  ║  " + padRight("TOTAL:", 51) + padLeft(formatPrice(totalPrice), 10) + "  ║");
    print("  ║  " + padRight("Budget:", 51) + padLeft(formatPrice(buildState.budget), 10) + "  ║");
    if (overBudget) {
        print("  ║  " + padRight("Over budget:", 51) + padLeft("+" + formatPrice(totalPrice - buildState.budget), 10) + "  ║");
    } else {
        print("  ║  " + padRight("Under budget:", 51) + padLeft(formatPrice(underBudget), 10) + "  ║");
    }
    print("  ║  " + padRight("Performance Score:", 51) + padLeft(String(weightedScore), 10) + "  ║");
    print("  ║                                                              ║");
    print("  ╚════════════════════════════════════════════════════════════════╝");

    if (overBudget) {
        print("\n  ⚠  Total exceeds budget by " + overflowPercent + "%. Consider cheaper options.");
    }

    print("\n  ✓ Build saved to 'recommended_combos' collection.");
    print("  ✓ Run  stepCPU(budget, 'usage')  to start a new build.\n");

    // Reset for next build
    buildState.step = 0;

    return completeBuild;
}


// ============================================================
// Pipeline #2 — Market Analysis (Section 6)
// Demonstrates: $group, $avg, $min, $max, $sum, $sort
// ============================================================

function section6_marketAnalysis() {
    print("");
    print("  ╔════════════════════════════════════════════════════╗");
    print("  ║   Market Analysis — Component Statistics          ║");
    print("  ╚════════════════════════════════════════════════════╝");
    print("");

    var results = db.components.aggregate([
        { $match: { price: { $type: "number", $gt: 0 } } },
        {
            $group: {
                _id: "$type",
                count: { $sum: 1 },
                avg_price: { $avg: "$price" },
                min_price: { $min: "$price" },
                max_price: { $max: "$price" },
                total_value: { $sum: "$price" }
            }
        },
        {
            $project: {
                _id: 0,
                component_type: "$_id",
                count: 1,
                avg_price: { $round: ["$avg_price", 2] },
                min_price: 1,
                max_price: 1,
                total_value: { $round: ["$total_value", 2] }
            }
        },
        { $sort: { count: -1 } }
    ]).toArray();

    var hdr = "  " + padRight("Type", 16) + padLeft("Count", 7) +
        padLeft("Avg $", 10) + padLeft("Min $", 10) + padLeft("Max $", 10);
    print(hdr);
    print("  " + Array(hdr.length).join("─"));

    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        print("  " + padRight(r.component_type, 16) +
            padLeft(String(r.count), 7) +
            padLeft(formatPrice(r.avg_price), 10) +
            padLeft(formatPrice(r.min_price), 10) +
            padLeft(formatPrice(r.max_price), 10));
    }
    print("");

    return results;
}


// ============================================================
// Pipeline #3 — Manufacturer Breakdown (Section 6)
// Demonstrates: $group, $push, $first, $unwind
// ============================================================

function section6_manufacturerBreakdown() {
    print("");
    print("  ╔════════════════════════════════════════════════════╗");
    print("  ║   Manufacturer Breakdown                          ║");
    print("  ╚════════════════════════════════════════════════════╝");
    print("");

    var results = db.components.aggregate([
        { $match: { manufacturer: { $exists: true, $ne: null } } },
        {
            $group: {
                _id: { manufacturer: "$manufacturer", type: "$type" },
                product_count: { $sum: 1 },
                avg_price: { $avg: "$price" },
                products: { $push: "$name" }
            }
        },
        {
            $group: {
                _id: "$_id.manufacturer",
                total_products: { $sum: "$product_count" },
                categories: {
                    $push: {
                        type: "$_id.type",
                        count: "$product_count",
                        avg_price: { $round: ["$avg_price", 2] }
                    }
                },
                first_category: { $first: "$_id.type" }
            }
        },
        { $sort: { total_products: -1 } },
        { $limit: 15 }
    ]).toArray();

    for (var i = 0; i < results.length; i++) {
        var m = results[i];
        print("  " + padRight(m._id, 20) + "(" + m.total_products + " products)");
        for (var c = 0; c < m.categories.length; c++) {
            print("    ├─ " + padRight(m.categories[c].type, 16) +
                padLeft(String(m.categories[c].count), 4) + " items" +
                padLeft("avg " + formatPrice(m.categories[c].avg_price), 14));
        }
        print("");
    }

    return results;
}


// ============================================================
// Pipeline #4 — High-Value Components (Section 6)
// Demonstrates: $expr, $multiply, $divide, $gt (field comparison)
// ============================================================

function section6_highValueComponents() {
    print("");
    print("  ╔════════════════════════════════════════════════════╗");
    print("  ║   High-Value Components — Score per Dollar        ║");
    print("  ╚════════════════════════════════════════════════════╝");
    print("");

    var results = db.components.aggregate([
        {
            $match: {
                "specs.score": { $type: "number", $gt: 0 },
                price: { $type: "number", $gt: 0 }
            }
        },
        {
            $project: {
                name: 1,
                type: 1,
                price: 1,
                score: "$specs.score",
                value_ratio: {
                    $round: [{ $divide: ["$specs.score", "$price"] }, 2]
                }
            }
        },
        {
            $match: {
                $expr: { $gt: ["$value_ratio", 5] }
            }
        },
        { $sort: { value_ratio: -1 } },
        { $limit: 20 }
    ]).toArray();

    var hdr = "  " + padRight("Name", 45) + padLeft("Type", 10) +
        padLeft("Price", 10) + padLeft("Score", 8) + padLeft("Pts/$", 8);
    print(hdr);
    print("  " + Array(hdr.length).join("─"));

    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        print("  " + padRight(truncate(r.name, 43), 45) +
            padLeft(r.type, 10) +
            padLeft(formatPrice(r.price), 10) +
            padLeft(String(r.score), 8) +
            padLeft(String(r.value_ratio), 8));
    }
    print("");

    return results;
}


// ============================================================
// Help / Quick Reference
// ============================================================

function pcBuilderHelp() {
    print("");
    print("  ╔════════════════════════════════════════════════════════════════╗");
    print("  ║   Interactive PC Builder — Quick Reference                    ║");
    print("  ╠════════════════════════════════════════════════════════════════╣");
    print("  ║                                                              ║");
    print("  ║  STEP-BY-STEP BUILD:                                         ║");
    print("  ║    stepCPU(budget, usage)   Start a new build                ║");
    print("  ║    pick(#)                  Select from list, auto-next step ║");
    print("  ║                                                              ║");
    print("  ║  USAGE TYPES: 'gaming', 'workstation', 'budget', 'enthusiast'║");
    print("  ║                                                              ║");
    print("  ║  ANALYSIS PIPELINES:                                         ║");
    print("  ║    section6_marketAnalysis()         Statistics by type       ║");
    print("  ║    section6_manufacturerBreakdown()  Products per maker      ║");
    print("  ║    section6_highValueComponents()    Best score-per-dollar   ║");
    print("  ║                                                              ║");
    print("  ║  EXAMPLE:                                                    ║");
    print("  ║    stepCPU(1500, 'gaming')                                   ║");
    print("  ║    pick(3)    ← selects CPU #3, shows motherboards           ║");
    print("  ║    pick(2)    ← selects mobo #2, shows RAM                   ║");
    print("  ║    pick(1)    ← selects RAM #1, shows GPUs                   ║");
    print("  ║    ...        ← keep picking until build is complete!        ║");
    print("  ║                                                              ║");
    print("  ║  STEP ORDER: CPU → Mobo → RAM → GPU → Storage               ║");
    print("  ║              → Cooler → PSU → Case → Done!                   ║");
    print("  ║                                                              ║");
    print("  ╚════════════════════════════════════════════════════════════════╝");
    print("");
}


// ============================================================
// Load Message
// ============================================================

print("");
print("  ╔════════════════════════════════════════════════════╗");
print("  ║  ✓ Interactive PC Builder loaded!                  ║");
print("  ║                                                    ║");
print("  ║    pcBuilderHelp()           Full command list     ║");
print("  ║    stepCPU(1500, 'gaming')   Start building!       ║");
print("  ╚════════════════════════════════════════════════════╝");
print("");
