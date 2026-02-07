// ============================================================
// Section 6: Advanced Aggregation — PC Auto-Builder
// ============================================================
//
// This section demonstrates MongoDB's Aggregation Framework:
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
// Architecture:
//   Pipeline #1 — "Auto-Builder": Self-Join aggregation
//                  (CPU → Motherboard → RAM) + component completion
//   Pipeline #2 — "Market Analysis": Statistics per component type
//   Pipeline #3 — "Manufacturer Breakdown": Products per manufacturer
//   Pipeline #4 — "High-Value Components": $expr demonstration
//
// Section 3 Compliance (JS functions — "שילוב בכל הסעיפים"):
//   - getProfileParams()        — dynamic profile configuration
//   - calculateRequiredWatts()  — PSU wattage estimation
//   - buildAutoPC()             — wrapper: builds pipeline + completes build
//   - buildCheapestPossible()   — fallback mechanism
//
// ============================================================


// ============================================================
// Section 3: JavaScript Helper Functions
// ============================================================

/**
 * מחזיר פרמטרים לפי פרופיל שימוש.
 * תומך ב-4 פרופילים: gaming, workstation, budget, enthusiast.
 *
 * חלוקת תקציב ל-8 רכיבים — כל רכיב מקבל אחוז מהתקציב הכולל.
 * כך Enthusiast ב-$10,000 לא יקנה לוח-אם ב-$99 ו-storage ב-$10.
 *
 * @param {string} usageType - סוג שימוש
 * @returns {object} פרמטרים: יחסי תקציב ל-8 רכיבים, RAM מינימלי
 */
function getProfileParams(usageType) {
    var usage = (usageType || "gaming").toLowerCase();

    // Budget ratios for all 8 component types.
    // Each ratio is a percentage of the total budget.
    // Sum of all ratios = 1.0 (100%)
    var profiles = {
        gaming: {
            name: "Gaming",
            // Gaming: GPU is king, then CPU, rest balanced
            cpu: 0.20,          // 20%
            gpu: 0.35,          // 35% — biggest chunk for GPU
            mobo: 0.10,         // 10%
            ram: 0.10,          // 10%
            storage: 0.08,      // 8%
            psu: 0.07,          // 7%
            pccase: 0.05,       // 5%
            cooler: 0.05,       // 5%
            minRamGb: 16,
            preferX3D: true     // prefer AMD X3D (large L3 cache)
        },
        workstation: {
            name: "Workstation",
            // Workstation: CPU is king, RAM important, moderate GPU
            cpu: 0.30,          // 30% — many cores needed
            gpu: 0.15,          // 15%
            mobo: 0.12,         // 12% — quality board for stability
            ram: 0.15,          // 15% — lots of RAM
            storage: 0.10,      // 10% — fast NVMe
            psu: 0.08,          // 8%
            pccase: 0.05,       // 5%
            cooler: 0.05,       // 5%
            minRamGb: 32,
            preferX3D: false
        },
        budget: {
            name: "Budget",
            // Budget: balanced, every dollar counts
            cpu: 0.22,          // 22%
            gpu: 0.28,          // 28%
            mobo: 0.10,         // 10%
            ram: 0.10,          // 10%
            storage: 0.10,      // 10%
            psu: 0.08,          // 8%
            pccase: 0.06,       // 6%
            cooler: 0.06,       // 6%
            minRamGb: 16,
            preferX3D: false
        },
        enthusiast: {
            name: "Enthusiast",
            // Enthusiast: everything high-end, no compromises
            cpu: 0.22,          // 22%
            gpu: 0.30,          // 30%
            mobo: 0.12,         // 12% — premium board
            ram: 0.10,          // 10%
            storage: 0.08,      // 8%
            psu: 0.08,          // 8% — quality PSU for stability
            pccase: 0.05,       // 5%
            cooler: 0.05,       // 5%
            minRamGb: 64,
            preferX3D: true
        }
    };

    return profiles[usage] || profiles.gaming;
}


/**
 * מחשב דרישת ספק כוח (PSU) בוואט.
 * נוסחה: CPU TDP + GPU VRAM × 20W + 100W safety margin.
 *
 * @param {number} cpuTdp  - TDP של ה-CPU (watts)
 * @param {number} gpuVram - VRAM של ה-GPU (GB)
 * @returns {number} דרישת PSU (watts)
 */
function calculateRequiredWatts(cpuTdp, gpuVram) {
    var cpu = cpuTdp || 65;
    var gpu = (gpuVram || 8) * 20;
    var safety = 100;
    return cpu + gpu + safety;
}


// ============================================================
// Main Function: buildAutoPC(budget, usageType)
// Section 3 (JS wrapper) + Section 6 (Aggregation Pipeline)
// ============================================================
//
// Algorithm:
//   Phase A — Aggregation Pipeline (Self-Join):
//     1. $match CPUs within CPU budget
//     2. $lookup Self-Join → find Motherboards (within mobo budget)
//     3. $lookup Self-Join → find RAM (within RAM budget)
//     4. $project with $add → calculate partial price
//     5. $out → save core build (CPU+Mobo+RAM)
//
//   Phase B — Component Completion (aggregate per component):
//     6. Find best GPU within GPU budget (aggregate)
//     7. Find compatible Case within case budget (aggregate)
//     8. Find PSU with sufficient wattage (aggregate)
//     9. Find Storage within storage budget (aggregate)
//    10. Find Cooler — liquid if TDP > 100W (aggregate)
//    11. Save complete build
//
// ============================================================

function buildAutoPC(budget, usageType) {
    var usage = usageType || "gaming";
    var params = getProfileParams(usage);

    print("=".repeat(60));
    print("  Building " + params.name + " PC — Budget: $" + budget);
    print("=".repeat(60));

    // --- Budget Allocation per Component (Section 3: JS) ---
    var maxCpu     = Math.round(budget * params.cpu);
    var maxGpu     = Math.round(budget * params.gpu);
    var maxMobo    = Math.round(budget * params.mobo);
    var maxRam     = Math.round(budget * params.ram);
    var maxStorage = Math.round(budget * params.storage);
    var maxPsu     = Math.round(budget * params.psu);
    var maxCase    = Math.round(budget * params.pccase);
    var maxCooler  = Math.round(budget * params.cooler);
    var minRamGb   = params.minRamGb;

    print("\n  Budget allocation (" + params.name + "):");
    print("    CPU:     $" + maxCpu + " (" + (params.cpu * 100) + "%)");
    print("    GPU:     $" + maxGpu + " (" + (params.gpu * 100) + "%)");
    print("    Mobo:    $" + maxMobo + " (" + (params.mobo * 100) + "%)");
    print("    RAM:     $" + maxRam + " (" + (params.ram * 100) + "%)");
    print("    Storage: $" + maxStorage + " (" + (params.storage * 100) + "%)");
    print("    PSU:     $" + maxPsu + " (" + (params.psu * 100) + "%)");
    print("    Case:    $" + maxCase + " (" + (params.pccase * 100) + "%)");
    print("    Cooler:  $" + maxCooler + " (" + (params.cooler * 100) + "%)");
    print("    Min RAM: " + minRamGb + "GB");

    // --- Build CPU match criteria (Section 3: dynamic query) ---
    var cpuMatch = {
        type: "CPU",
        price: { $type: "number", $lte: maxCpu },
        "specs.score": { $type: "number" },
        "requirements.socket_match": { $exists: true, $ne: null }
    };

    // Gaming/Enthusiast: prefer X3D CPUs (larger L3 cache)
    if (params.preferX3D) {
        cpuMatch.name = { $regex: "X3D", $options: "i" };
    }

    // ========================================================
    // PHASE A: Aggregation Pipeline — Self-Join Auto-Builder
    // Section 6: db.components.aggregate([...])
    // ========================================================

    print("\n[Phase A] Running Aggregation Pipeline (Self-Join)...");

    // Clean target collection before $out
    db.recommended_combos.drop();

    var pipeline = [

        // -------------------------------------------------------
        // Stage 1: $match — Select CPU candidates
        // סינון CPUs לפי סוג, מחיר, וציון תקף
        // -------------------------------------------------------
        { $match: cpuMatch },

        // -------------------------------------------------------
        // Stage 2: $sort — Best CPUs first
        // ציון גבוה = CPU טוב יותר, מחיר נמוך = ערך טוב יותר
        // -------------------------------------------------------
        { $sort: { "specs.score": -1, price: 1 } },

        // -------------------------------------------------------
        // Stage 3: $limit — Top 5 candidates only
        // מונע פיצוץ זיכרון ב-Self-Join הבא
        // -------------------------------------------------------
        { $limit: 5 },

        // -------------------------------------------------------
        // Stage 4: $lookup — Self-Join #1 (CPU → Motherboard)
        // חיפוש לוחות-אם תואמים לפי socket
        // Self-Join: from "components" ON "components"!
        //
        // localField: requirements.socket_match (CPU socket)
        // foreignField: specs.socket (any component with that socket)
        // Result: array of ALL components with matching socket
        // (including other CPUs — filtered in Stage 6)
        // -------------------------------------------------------
        {
            $lookup: {
                from: "components",
                localField: "requirements.socket_match",
                foreignField: "specs.socket",
                as: "socket_matches"
            }
        },

        // -------------------------------------------------------
        // Stage 5: $unwind — Expand socket_matches array
        // כל צמד CPU×רכיב-תואם הופך למסמך נפרד
        // -------------------------------------------------------
        { $unwind: "$socket_matches" },

        // -------------------------------------------------------
        // Stage 6: $match — Keep only Motherboards in budget
        // ה-Self-Join הביא הכל (כולל CPUs אחרים עם אותו socket).
        // שומר רק לוחות-אם עם מחיר תקף, בתקציב, ו-ram_type ידוע.
        // -------------------------------------------------------
        { $match: {
            "socket_matches.type": "Motherboard",
            "socket_matches.price": { $type: "number", $lte: maxMobo },
            "socket_matches.specs.ram_type": { $ne: null }
        }},

        // -------------------------------------------------------
        // Stage 7: $sort — Best motherboard first (expensive = better)
        // CPU score DESC → mobo price DESC (best mobo within budget)
        // -------------------------------------------------------
        { $sort: { "specs.score": -1, "socket_matches.price": -1 } },

        // -------------------------------------------------------
        // Stage 8: $group — One motherboard per CPU
        // $first אחרי $sort בוחר את הלוח הזול ביותר לכל CPU
        //
        // Accumulators used: $first
        // -------------------------------------------------------
        {
            $group: {
                _id: "$_id",
                cpu_name: { $first: "$name" },
                cpu_price: { $first: "$price" },
                cpu_score: { $first: "$specs.score" },
                cpu_socket: { $first: "$specs.socket" },
                cpu_tdp: { $first: "$specs.tdp" },
                cpu_manufacturer: { $first: "$manufacturer" },
                mobo_name: { $first: "$socket_matches.name" },
                mobo_price: { $first: "$socket_matches.price" },
                mobo_socket: { $first: "$socket_matches.specs.socket" },
                mobo_ram_type: { $first: "$socket_matches.specs.ram_type" },
                mobo_form_factor: { $first: "$socket_matches.specs.form_factor" }
            }
        },

        // -------------------------------------------------------
        // Stage 9: $lookup — Self-Join #2 (Motherboard → RAM)
        // חיפוש RAM תואם לפי סוג זיכרון (DDR4/DDR5)
        //
        // localField: mobo_ram_type (e.g. "DDR5")
        // foreignField: specs.generation (e.g. "DDR5")
        // -------------------------------------------------------
        {
            $lookup: {
                from: "components",
                localField: "mobo_ram_type",
                foreignField: "specs.generation",
                as: "ram_matches"
            }
        },

        // -------------------------------------------------------
        // Stage 10: $unwind — Expand RAM matches
        // -------------------------------------------------------
        { $unwind: "$ram_matches" },

        // -------------------------------------------------------
        // Stage 11: $match — Filter valid RAM (in budget, min capacity)
        // -------------------------------------------------------
        { $match: {
            "ram_matches.type": "RAM",
            "ram_matches.specs.capacity_gb": { $gte: minRamGb },
            "ram_matches.price": { $type: "number", $lte: maxRam }
        }},

        // -------------------------------------------------------
        // Stage 12: $sort — Best RAM first (most capacity, then price)
        // -------------------------------------------------------
        { $sort: { cpu_score: -1, "ram_matches.specs.capacity_gb": -1, "ram_matches.price": -1 } },

        // -------------------------------------------------------
        // Stage 13: $group — One RAM per CPU+Mobo combination
        // $first בוחר את ה-RAM הזול ביותר (אחרי sort)
        //
        // Accumulators used: $first (×16 fields)
        // -------------------------------------------------------
        {
            $group: {
                _id: "$_id",
                cpu_name: { $first: "$cpu_name" },
                cpu_price: { $first: "$cpu_price" },
                cpu_score: { $first: "$cpu_score" },
                cpu_socket: { $first: "$cpu_socket" },
                cpu_tdp: { $first: "$cpu_tdp" },
                cpu_manufacturer: { $first: "$cpu_manufacturer" },
                mobo_name: { $first: "$mobo_name" },
                mobo_price: { $first: "$mobo_price" },
                mobo_socket: { $first: "$mobo_socket" },
                mobo_ram_type: { $first: "$mobo_ram_type" },
                mobo_form_factor: { $first: "$mobo_form_factor" },
                ram_name: { $first: "$ram_matches.name" },
                ram_price: { $first: "$ram_matches.price" },
                ram_capacity: { $first: "$ram_matches.specs.capacity_gb" },
                ram_generation: { $first: "$ram_matches.specs.generation" }
            }
        },

        // -------------------------------------------------------
        // Stage 14: $project — Calculate partial price
        // חישוב מחיר חלקי עם $add (CPU + Mobo + RAM)
        //
        // Note: $addFields was NOT taught — $project replaces it.
        // Must list ALL fields + new computed field.
        //
        // Mathematical operator: $add
        // -------------------------------------------------------
        {
            $project: {
                cpu_name: 1,
                cpu_price: 1,
                cpu_score: 1,
                cpu_socket: 1,
                cpu_tdp: 1,
                cpu_manufacturer: 1,
                mobo_name: 1,
                mobo_price: 1,
                mobo_socket: 1,
                mobo_ram_type: 1,
                mobo_form_factor: 1,
                ram_name: 1,
                ram_price: 1,
                ram_capacity: 1,
                ram_generation: 1,
                partial_price: { $add: ["$cpu_price", "$mobo_price", "$ram_price"] }
            }
        },

        // -------------------------------------------------------
        // Stage 15: $match — Budget filter + Socket validation
        //
        // $expr: compares cpu_socket vs mobo_socket (field-to-field)
        // This validates that the Self-Join matched correctly.
        // Also filters by total budget threshold.
        //
        // Demonstrates: $expr for field comparison (מצגת 9, שקף 10)
        // -------------------------------------------------------
        {
            $match: {
                $expr: { $eq: ["$cpu_socket", "$mobo_socket"] },
                partial_price: { $lte: budget }
            }
        },

        // -------------------------------------------------------
        // Stage 16: $sort — Best build first
        // -------------------------------------------------------
        { $sort: { cpu_score: -1, partial_price: 1 } },

        // -------------------------------------------------------
        // Stage 17: $limit — Single best option
        // -------------------------------------------------------
        { $limit: 1 },

        // -------------------------------------------------------
        // Stage 18: $out — Save to collection
        // שמירת הליבה (CPU+Mobo+RAM) ל-recommended_combos
        // -------------------------------------------------------
        { $out: "recommended_combos" }
    ];

    // Execute the aggregation pipeline
    db.components.aggregate(pipeline);

    // Read pipeline result
    var coreResult = db.recommended_combos.findOne();

    // ========================================================
    // Retry Logic (Section 3: JavaScript control flow)
    // ========================================================

    // Retry 1: If X3D preference yielded no results, try without it
    if (!coreResult && params.preferX3D) {
        print("  No X3D CPUs in budget. Retrying all CPUs...");
        pipeline[0] = { $match: {
            type: "CPU",
            price: { $type: "number", $lte: maxCpu },
            "specs.score": { $type: "number" },
            "requirements.socket_match": { $exists: true, $ne: null }
        }};
        db.recommended_combos.drop();
        db.components.aggregate(pipeline);
        coreResult = db.recommended_combos.findOne();
    }

    // Retry 2: If high RAM requirement yielded no results, try 16GB
    if (!coreResult && minRamGb > 16) {
        print("  No " + minRamGb + "GB RAM in budget. Retrying 16GB...");
        pipeline[10] = { $match: {
            "ram_matches.type": "RAM",
            "ram_matches.specs.capacity_gb": { $gte: 16 },
            "ram_matches.price": { $type: "number", $lte: maxRam }
        }};
        db.recommended_combos.drop();
        db.components.aggregate(pipeline);
        coreResult = db.recommended_combos.findOne();
    }

    // Retry 3: Ultimate fallback
    if (!coreResult) {
        print("  Pipeline returned no results. Using fallback...");
        return buildCheapestPossible(usage);
    }

    print("\n  [Phase A Complete] Core build (Aggregation):");
    print("    CPU:  " + coreResult.cpu_name + " ($" + coreResult.cpu_price + ")");
    print("    Mobo: " + coreResult.mobo_name + " ($" + coreResult.mobo_price + ")");
    print("    RAM:  " + coreResult.ram_name + " " + coreResult.ram_capacity + "GB ($" + coreResult.ram_price + ")");
    print("    Core subtotal: $" + coreResult.partial_price);


    // ========================================================
    // PHASE B: JavaScript Completion (Section 3)
    // ========================================================
    // PHASE B: Component Completion using aggregate()
    // Each component selected via db.components.aggregate([...])
    // to demonstrate more aggregation usage.
    //
    // No FK exists for GPU/Case/PSU/Storage/Cooler,
    // so each uses its own small aggregate pipeline.
    // ========================================================

    print("\n[Phase B] Selecting remaining components (aggregate)...");


    // --- GPU: Best score within GPU budget ---
    // aggregate: $match → $sort → $limit → $project

    var gpuResult = db.components.aggregate([
        { $match: {
            type: "GPU",
            price: { $type: "number", $lte: maxGpu },
            "specs.score": { $type: "number" }
        }},
        { $sort: { "specs.score": -1, price: 1 } },
        { $limit: 1 },
        { $project: {
            name: 1, price: 1,
            score: "$specs.score",
            vram: "$specs.vram",
            length_mm: "$specs.length_mm"
        }}
    ]).toArray();

    var gpu = gpuResult[0] || null;

    // Fallback: cheapest GPU if none within budget
    if (!gpu) {
        gpuResult = db.components.aggregate([
            { $match: { type: "GPU", price: { $type: "number" } } },
            { $sort: { price: 1 } },
            { $limit: 1 },
            { $project: {
                name: 1, price: 1,
                score: "$specs.score",
                vram: "$specs.vram",
                length_mm: "$specs.length_mm"
            }}
        ]).toArray();
        gpu = gpuResult[0] || null;
    }

    if (!gpu) {
        print("  ERROR: No GPU found!");
        return buildCheapestPossible(usage);
    }
    print("    GPU:     " + gpu.name + " ($" + gpu.price + ")");


    // --- Case: Must fit GPU length, within case budget ---
    // aggregate: $match → $sort → $limit → $project

    var gpuLength = gpu.length_mm || 0;

    var caseResult = db.components.aggregate([
        { $match: {
            type: "Case",
            price: { $type: "number", $lte: maxCase },
            "specs.max_gpu_length": { $gte: gpuLength }
        }},
        { $sort: { price: -1 } },   // best case within budget
        { $limit: 1 },
        { $project: {
            name: 1, price: 1,
            max_gpu_length: "$specs.max_gpu_length"
        }}
    ]).toArray();

    var pcCase = caseResult[0] || null;

    // Fallback: any case that fits GPU
    if (!pcCase) {
        caseResult = db.components.aggregate([
            { $match: {
                type: "Case",
                price: { $type: "number" },
                "specs.max_gpu_length": { $gte: gpuLength }
            }},
            { $sort: { price: 1 } },
            { $limit: 1 },
            { $project: { name: 1, price: 1, max_gpu_length: "$specs.max_gpu_length" } }
        ]).toArray();
        pcCase = caseResult[0] || null;
    }

    print("    Case:    " + (pcCase ? pcCase.name + " ($" + pcCase.price + ")" : "NOT FOUND"));


    // --- PSU: Must meet wattage requirement, within PSU budget ---
    // aggregate: $match → $sort → $limit → $project

    var cpuTdp = coreResult.cpu_tdp || 65;
    var gpuVram = gpu.vram || 8;
    var requiredWatts = calculateRequiredWatts(cpuTdp, gpuVram);

    var psuResult = db.components.aggregate([
        { $match: {
            type: "Power Supply",
            price: { $type: "number", $lte: maxPsu },
            "specs.wattage": { $gte: requiredWatts }
        }},
        { $sort: { "specs.wattage": -1, price: -1 } },  // best PSU within budget
        { $limit: 1 },
        { $project: {
            name: 1, price: 1,
            wattage: "$specs.wattage",
            efficiency: "$specs.efficiency"
        }}
    ]).toArray();

    var psu = psuResult[0] || null;

    // Fallback: cheapest PSU that meets wattage
    if (!psu) {
        psuResult = db.components.aggregate([
            { $match: {
                type: "Power Supply",
                price: { $type: "number" },
                "specs.wattage": { $gte: requiredWatts }
            }},
            { $sort: { price: 1 } },
            { $limit: 1 },
            { $project: { name: 1, price: 1, wattage: "$specs.wattage" } }
        ]).toArray();
        psu = psuResult[0] || null;
    }

    print("    PSU:     " + (psu ? psu.name + " (" + (psu.wattage || "?") + "W, $" + psu.price + ")" : "NOT FOUND"));


    // --- Storage: Best capacity within storage budget ---
    // aggregate: $match → $sort → $limit → $project

    var storageResult = db.components.aggregate([
        { $match: {
            type: "Storage",
            price: { $type: "number", $lte: maxStorage }
        }},
        { $sort: { "specs.capacity_gb": -1, price: -1 } },  // most storage within budget
        { $limit: 1 },
        { $project: {
            name: 1, price: 1,
            capacity_gb: "$specs.capacity_gb",
            storage_type: "$specs.storage_type"
        }}
    ]).toArray();

    var storage = storageResult[0] || null;

    // Fallback: cheapest storage
    if (!storage) {
        storageResult = db.components.aggregate([
            { $match: { type: "Storage", price: { $type: "number" } } },
            { $sort: { price: 1 } },
            { $limit: 1 },
            { $project: { name: 1, price: 1, capacity_gb: "$specs.capacity_gb" } }
        ]).toArray();
        storage = storageResult[0] || null;
    }

    print("    Storage: " + (storage ? storage.name + " ($" + storage.price + ")" : "NOT FOUND"));


    // --- CPU Cooler: Liquid if TDP > 100W, within cooler budget ---
    // aggregate: $match → $sort → $limit → $project

    // Section 3: JS decision — high-TDP CPUs need liquid cooling
    var preferLiquid = (cpuTdp > 100);

    var coolerMatch = {
        type: "CPU Cooler",
        price: { $type: "number", $lte: maxCooler }
    };
    if (preferLiquid) {
        coolerMatch["specs.kind"] = "Liquid";
    }

    var coolerResult = db.components.aggregate([
        { $match: coolerMatch },
        { $sort: { price: -1 } },  // best cooler within budget
        { $limit: 1 },
        { $project: {
            name: 1, price: 1,
            kind: "$specs.kind"
        }}
    ]).toArray();

    var cooler = coolerResult[0] || null;

    // Fallback: any cooler within budget (air is fine)
    if (!cooler) {
        coolerResult = db.components.aggregate([
            { $match: { type: "CPU Cooler", price: { $type: "number", $lte: maxCooler } } },
            { $sort: { price: -1 } },
            { $limit: 1 },
            { $project: { name: 1, price: 1, kind: "$specs.kind" } }
        ]).toArray();
        cooler = coolerResult[0] || null;
    }

    // Ultimate fallback: cheapest cooler
    if (!cooler) {
        coolerResult = db.components.aggregate([
            { $match: { type: "CPU Cooler", price: { $type: "number" } } },
            { $sort: { price: 1 } },
            { $limit: 1 },
            { $project: { name: 1, price: 1, kind: "$specs.kind" } }
        ]).toArray();
        cooler = coolerResult[0] || null;
    }

    print("    Cooler:  " + (cooler ? cooler.name + " (" + (cooler.kind || "Air") + ", $" + cooler.price + ")" : "NOT FOUND"));


    // ========================================================
    // PHASE C: Calculate totals + save complete build
    // ========================================================

    var gpuPrice     = gpu ? gpu.price : 0;
    var casePrice    = pcCase ? pcCase.price : 0;
    var psuPrice     = psu ? psu.price : 0;
    var storagePrice = storage ? storage.price : 0;
    var coolerPrice  = cooler ? cooler.price : 0;

    var totalPrice = coreResult.partial_price +
                     gpuPrice + casePrice + psuPrice +
                     storagePrice + coolerPrice;

    // Performance score: simple addition (CPU score + GPU score)
    var gpuScore = gpu ? (gpu.score || 0) : 0;
    var perfScore = (coreResult.cpu_score || 0) + gpuScore;

    // Budget check
    if (totalPrice > budget) {
        print("\n  WARNING: Total ($" + totalPrice + ") exceeds budget ($" + budget + ").");
        print("  Using fallback...");
        return buildCheapestPossible(usage);
    }

    // Build the complete document
    var completeBuild = {
        build_name: params.name + " Build for $" + budget,
        usage_type: usage,
        target_budget: budget,
        components: {
            cpu: coreResult.cpu_name,
            motherboard: coreResult.mobo_name,
            ram: coreResult.ram_name,
            gpu: gpu.name,
            case_name: pcCase ? pcCase.name : "N/A",
            psu: psu ? psu.name : "N/A",
            storage: storage ? storage.name : "N/A",
            cooler: cooler ? cooler.name : "N/A"
        },
        compatibility_details: {
            cpu_socket: coreResult.cpu_socket,
            motherboard_socket: coreResult.mobo_socket,
            ram_type_required: coreResult.mobo_ram_type,
            ram_type_selected: coreResult.ram_generation,
            ram_capacity_gb: coreResult.ram_capacity,
            gpu_length_mm: gpuLength,
            case_max_gpu_length_mm: pcCase ? pcCase.max_gpu_length : null,
            required_watts: requiredWatts,
            psu_wattage: psu ? psu.wattage : null
        },
        price_breakdown: {
            cpu: coreResult.cpu_price,
            motherboard: coreResult.mobo_price,
            ram: coreResult.ram_price,
            gpu: gpuPrice,
            case_price: casePrice,
            psu: psuPrice,
            storage: storagePrice,
            cooler: coolerPrice
        },
        performance_score: perfScore,
        total_price: totalPrice,
        generated_at: new Date()
    };

    // Save to collection
    db.recommended_combos.drop();
    db.recommended_combos.insertOne(completeBuild);

    print("\n" + "=".repeat(60));
    print("  BUILD COMPLETE!");
    print("    CPU:     " + completeBuild.components.cpu);
    print("    Mobo:    " + completeBuild.components.motherboard);
    print("    RAM:     " + completeBuild.components.ram + " (" + coreResult.ram_capacity + "GB)");
    print("    GPU:     " + completeBuild.components.gpu);
    print("    Case:    " + completeBuild.components.case_name);
    print("    PSU:     " + completeBuild.components.psu);
    print("    Storage: " + completeBuild.components.storage);
    print("    Cooler:  " + completeBuild.components.cooler);
    print("    ─────────────────────────────────────");
    print("    Total:   $" + totalPrice + " / $" + budget + " budget");
    print("    Score:   " + perfScore);
    print("=".repeat(60));

    return completeBuild;
}


// ============================================================
// Fallback Mechanism: buildCheapestPossible(usageType)
// Called when budget is too low for any valid combination.
// Section 3: Error handling with JavaScript.
// ============================================================

function buildCheapestPossible(usageType) {
    print("\n" + "!".repeat(60));
    print("  FALLBACK: Building cheapest possible configuration...");
    print("!".repeat(60));

    var usage = usageType || "gaming";

    // Find cheapest CPU with valid socket
    var cpu = db.components.aggregate([
        { $match: { type: "CPU", price: { $type: "number" },
                    "requirements.socket_match": { $exists: true, $ne: null } } },
        { $sort: { price: 1 } },
        { $limit: 1 }
    ]).toArray()[0];

    if (!cpu) { print("  FATAL: No CPUs!"); return null; }

    // Find cheapest motherboard for that socket
    var mobo = db.components.aggregate([
        { $match: { type: "Motherboard",
                    "specs.socket": cpu.requirements.socket_match,
                    price: { $type: "number" } } },
        { $sort: { price: 1 } },
        { $limit: 1 }
    ]).toArray()[0];

    if (!mobo) { print("  FATAL: No motherboard for " + cpu.requirements.socket_match); return null; }

    var ramType = (mobo.specs && mobo.specs.ram_type) ? mobo.specs.ram_type : "DDR4";

    var ram = db.components.aggregate([
        { $match: { type: "RAM", "specs.generation": ramType,
                    price: { $type: "number" } } },
        { $sort: { price: 1 } },
        { $limit: 1 }
    ]).toArray()[0];

    var gpu = db.components.aggregate([
        { $match: { type: "GPU", price: { $type: "number" } } },
        { $sort: { price: 1 } },
        { $limit: 1 }
    ]).toArray()[0];

    var cooler = db.components.aggregate([
        { $match: { type: "CPU Cooler", price: { $type: "number" } } },
        { $sort: { price: 1 } },
        { $limit: 1 }
    ]).toArray()[0];

    var pcCase = db.components.aggregate([
        { $match: { type: "Case", price: { $type: "number" } } },
        { $sort: { price: 1 } },
        { $limit: 1 }
    ]).toArray()[0];

    var psu = db.components.aggregate([
        { $match: { type: "Power Supply", price: { $type: "number" } } },
        { $sort: { price: 1 } },
        { $limit: 1 }
    ]).toArray()[0];

    var storage = db.components.aggregate([
        { $match: { type: "Storage", price: { $type: "number" } } },
        { $sort: { price: 1 } },
        { $limit: 1 }
    ]).toArray()[0];

    if (!ram || !gpu || !cooler || !pcCase || !psu || !storage) {
        print("  FATAL: Missing essential components!");
        return null;
    }

    var totalPrice = cpu.price + mobo.price + ram.price + gpu.price +
                     cooler.price + pcCase.price + psu.price + storage.price;

    var result = {
        build_name: "Fallback — Cheapest Build",
        usage_type: usage,
        target_budget: 0,
        warning: "Budget too low. Showing cheapest possible configuration.",
        components: {
            cpu: cpu.name,
            motherboard: mobo.name,
            ram: ram.name,
            gpu: gpu.name,
            case_name: pcCase.name,
            psu: psu.name,
            storage: storage.name,
            cooler: cooler.name
        },
        compatibility_details: {
            cpu_socket: cpu.specs.socket,
            motherboard_socket: mobo.specs.socket,
            ram_type_required: ramType,
            ram_type_selected: ram.specs.generation
        },
        total_price: totalPrice,
        generated_at: new Date()
    };

    db.recommended_combos.drop();
    db.recommended_combos.insertOne(result);

    print("\n  Fallback build total: $" + totalPrice);
    print("  WARNING: Cheapest configuration — no optimization.");
    print("!".repeat(60));

    return result;
}


// ============================================================
// Pipeline #2: Market Analysis
// ============================================================
// Demonstrates:
//   $match, $group ($sum, $avg, $min, $max), $sort,
//   $project ($subtract), $out
// ============================================================

function runMarketAnalysis() {
    print("\n" + "-".repeat(50));
    print("  Pipeline #2: Market Analysis");
    print("-".repeat(50));

    db.market_analysis.drop();

    db.components.aggregate([

        // Stage 1: $match — components with valid price
        {
            $match: {
                price: { $type: "number" }
            }
        },

        // Stage 2: $group — statistics per component type
        // Accumulators: $sum, $avg, $min, $max
        {
            $group: {
                _id: "$type",
                count: { $sum: 1 },
                avg_price: { $avg: "$price" },
                min_price: { $min: "$price" },
                max_price: { $max: "$price" }
            }
        },

        // Stage 3: $sort — most expensive type first
        { $sort: { avg_price: -1 } },

        // Stage 4: $project — rename and calculate price range
        // Mathematical operator: $subtract
        {
            $project: {
                _id: 0,
                component_type: "$_id",
                count: 1,
                avg_price: 1,
                min_price: 1,
                max_price: 1,
                price_range: { $subtract: ["$max_price", "$min_price"] }
            }
        },

        // Stage 5: $out — save to collection
        { $out: "market_analysis" }
    ]);

    var results = db.market_analysis.find().sort({ avg_price: -1 }).toArray();
    print("  Generated " + results.length + " type analyses:");
    results.forEach(function (r) {
        print("    " + r.component_type + ": " +
            r.count + " items, avg $" + Math.round(r.avg_price) +
            " (range: $" + Math.round(r.price_range) + ")");
    });

    return results;
}


// ============================================================
// Pipeline #3: Manufacturer Breakdown
// ============================================================
// Demonstrates:
//   $match, $group (double), $push accumulator,
//   $sort (multiple), $out
// ============================================================

function runManufacturerBreakdown() {
    print("\n" + "-".repeat(50));
    print("  Pipeline #3: Manufacturer Breakdown");
    print("-".repeat(50));

    db.manufacturer_breakdown.drop();

    db.components.aggregate([

        // Stage 1: $match — valid entries
        {
            $match: {
                manufacturer: { $ne: null },
                price: { $type: "number" }
            }
        },

        // Stage 2: $group #1 — count per manufacturer + type
        // Accumulators: $sum, $avg
        {
            $group: {
                _id: { manufacturer: "$manufacturer", type: "$type" },
                count: { $sum: 1 },
                avg_price: { $avg: "$price" }
            }
        },

        // Stage 3: $sort — by manufacturer, then count desc
        { $sort: { "_id.manufacturer": 1, count: -1 } },

        // Stage 4: $group #2 — aggregate per manufacturer
        // Accumulator: $push (builds array of product lines)
        // Accumulator: $sum (counts total products)
        {
            $group: {
                _id: "$_id.manufacturer",
                product_lines: {
                    $push: {
                        type: "$_id.type",
                        count: "$count",
                        avg_price: "$avg_price"
                    }
                },
                total_products: { $sum: "$count" }
            }
        },

        // Stage 5: $sort — most productive manufacturer first
        { $sort: { total_products: -1 } },

        // Stage 6: $out — save results
        { $out: "manufacturer_breakdown" }
    ]);

    var results = db.manufacturer_breakdown.find()
        .sort({ total_products: -1 })
        .limit(10)
        .toArray();

    print("  Top 10 manufacturers:");
    results.forEach(function (r) {
        var types = [];
        for (var i = 0; i < r.product_lines.length; i++) {
            types.push(r.product_lines[i].type);
        }
        print("    " + r._id + ": " + r.total_products +
            " products (" + types.join(", ") + ")");
    });

    return results;
}


// ============================================================
// Pipeline #4: High-Value Components ($expr Demo)
// ============================================================
// Demonstrates:
//   $match with $expr, $multiply (field-to-field comparison),
//   $project with $subtract, $sort, $limit, $out
//
// Logic: Find components where score > price × 2
//        (high performance relative to cost)
// ============================================================

function runHighValueAnalysis() {
    print("\n" + "-".repeat(50));
    print("  Pipeline #4: High-Value Components ($expr)");
    print("-".repeat(50));

    db.high_value_components.drop();

    db.components.aggregate([

        // Stage 1: $match — components with both score and price
        {
            $match: {
                "specs.score": { $type: "number" },
                price: { $type: "number", $gt: 0 }
            }
        },

        // Stage 2: $match + $expr — field-to-field comparison
        // Finds components where score > price × 2
        // This demonstrates $expr with $multiply
        // (מצגת 9, שקף 10: {$match: {$expr: {<aggregation expression>}}})
        {
            $match: {
                $expr: {
                    $gt: [
                        "$specs.score",
                        { $multiply: ["$price", 2] }
                    ]
                }
            }
        },

        // Stage 3: $project — calculate value surplus
        // Mathematical operators: $subtract, $multiply
        {
            $project: {
                _id: 0,
                name: 1,
                type: 1,
                price: 1,
                score: "$specs.score",
                value_surplus: {
                    $subtract: [
                        "$specs.score",
                        { $multiply: ["$price", 2] }
                    ]
                }
            }
        },

        // Stage 4: $sort — best value first
        { $sort: { value_surplus: -1 } },

        // Stage 5: $limit — top 10
        { $limit: 10 },

        // Stage 6: $out — save results
        { $out: "high_value_components" }
    ]);

    var results = db.high_value_components.find().toArray();
    print("  Found " + results.length + " high-value components:");
    results.forEach(function (r) {
        print("    " + r.type + ": " + r.name +
            " — Score: " + r.score + ", Price: $" + r.price +
            ", Surplus: " + r.value_surplus);
    });

    return results;
}


// ============================================================
// Entry Point: section6_aggregate()
// Runs 4 build demos + 3 statistics pipelines
// ============================================================

function section6_aggregate() {
    print("\n" + "=".repeat(70));
    print("  SECTION 6: AGGREGATION — PC Auto-Builder");
    print("  Operators: $match, $project, $lookup (Self-Join), $unwind,");
    print("             $group, $sort, $limit, $out, $expr");
    print("  Math: $add, $subtract, $multiply");
    print("  Accumulators: $first, $sum, $avg, $min, $max, $push");
    print("=".repeat(70));

    // --------------------------------------------------------
    // Demo 1: Gaming Build ($1700)
    // --------------------------------------------------------
    print("\n\n>>> Demo 1: Gaming Build ($1700)");
    var gaming = buildAutoPC(1700, "gaming");

    // --------------------------------------------------------
    // Demo 2: Workstation Build ($2500)
    // --------------------------------------------------------
    print("\n\n>>> Demo 2: Workstation Build ($2500)");
    var workstation = buildAutoPC(2500, "workstation");

    // --------------------------------------------------------
    // Demo 3: Enthusiast Build ($5000)
    // --------------------------------------------------------
    print("\n\n>>> Demo 3: Enthusiast Build ($5000)");
    var enthusiast = buildAutoPC(5000, "enthusiast");

    // --------------------------------------------------------
    // Demo 4: Budget Build ($500) — Likely triggers fallback
    // --------------------------------------------------------
    print("\n\n>>> Demo 4: Budget Build ($500)");
    var budgetBuild = buildAutoPC(500, "budget");


    // --------------------------------------------------------
    // Save all builds to recommended_combos
    // --------------------------------------------------------
    db.recommended_combos.drop();
    var allBuilds = [gaming, workstation, enthusiast, budgetBuild];
    var validBuilds = [];
    for (var i = 0; i < allBuilds.length; i++) {
        if (allBuilds[i] !== null) {
            validBuilds.push(allBuilds[i]);
        }
    }
    if (validBuilds.length > 0) {
        db.recommended_combos.insertMany(validBuilds);
    }
    print("\n  Saved " + validBuilds.length + " builds to 'recommended_combos'");


    // --------------------------------------------------------
    // Statistics Pipelines
    // --------------------------------------------------------
    print("\n\n>>> Statistics Pipelines...");

    runMarketAnalysis();
    runManufacturerBreakdown();
    runHighValueAnalysis();


    // --------------------------------------------------------
    // Summary
    // --------------------------------------------------------
    print("\n\n" + "=".repeat(70));
    print("  SECTION 6 COMPLETE!");
    print("  Collections:");
    print("    - recommended_combos  (" + validBuilds.length + " builds)");
    print("    - market_analysis");
    print("    - manufacturer_breakdown");
    print("    - high_value_components");
    print("");
    print("  Operators used:");
    print("    Stages: $match, $project, $lookup (Self-Join x2),");
    print("            $unwind, $group, $sort, $limit, $out, $expr");
    print("    Math:   $add, $subtract, $multiply");
    print("    Accumulators: $first, $sum, $avg, $min, $max, $push");
    print("=".repeat(70));

    return {
        gaming: gaming,
        workstation: workstation,
        enthusiast: enthusiast,
        budget_fallback: budgetBuild
    };
}


// ============================================================
// Load Confirmation
// ============================================================
print("\n✓ project_section6_final.js loaded successfully!");
print("  Run:  section6_aggregate()");
print("  Or:   buildAutoPC(1700, 'gaming')");
print("        buildAutoPC(2500, 'workstation')");
print("        buildAutoPC(5000, 'enthusiast')");
print("        buildAutoPC(500, 'budget')");
