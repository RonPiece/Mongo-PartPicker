// ============================================================
// Section 6: Advanced Aggregation — PC Auto-Builder (Final)
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
//                  (CPU → Motherboard → RAM) + JS completion
//   Pipeline #2 — "Market Analysis": Statistics per component type
//   Pipeline #3 — "Manufacturer Breakdown": Products per manufacturer
//   Pipeline #4 — "High-Value Components": $expr demonstration
//
// Section 3 Compliance (JS functions — "שילוב בכל הסעיפים"):
//   - getProfileParams()        — dynamic profile configuration
//   - calculateWeightedScore()  — weighted scoring
//   - calculateRequiredWatts()  — PSU wattage estimation
//   - buildAutoPC()             — wrapper that builds pipeline + completes build
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
 * @param {string} usageType - סוג שימוש
 * @returns {object} פרמטרים: יחסי תקציב, RAM מינימלי, משקלות ציון
 */
function getProfileParams(usageType) {
    var usage = (usageType || "gaming").toLowerCase();

    var profiles = {
        gaming: {
            name: "Gaming",
            cpuBudgetRatio: 0.25,       // 25% of budget for CPU
            gpuBudgetRatio: 0.45,       // 45% of budget for GPU
            minRamGb: 16,
            preferredRamGb: 32,
            preferX3D: true,            // prefer AMD X3D (large L3 cache)
            scoringWeights: {
                gpu: 0.6,               // GPU most important for gaming
                cpu: 0.4,
                ram: 0.0
            }
        },
        workstation: {
            name: "Workstation",
            cpuBudgetRatio: 0.40,       // 40% — need many cores
            gpuBudgetRatio: 0.25,
            minRamGb: 32,
            preferredRamGb: 64,
            preferX3D: false,
            scoringWeights: {
                cpu: 0.5,               // CPU most important
                ram: 0.3,               // RAM matters for workloads
                gpu: 0.2
            }
        },
        budget: {
            name: "Budget",
            cpuBudgetRatio: 0.30,
            gpuBudgetRatio: 0.35,
            minRamGb: 16,
            preferredRamGb: 16,
            preferX3D: false,
            scoringWeights: {
                gpu: 0.5,
                cpu: 0.3,
                ram: 0.2
            }
        },
        enthusiast: {
            name: "Enthusiast",
            cpuBudgetRatio: 0.30,
            gpuBudgetRatio: 0.40,
            minRamGb: 64,
            preferredRamGb: 128,
            preferX3D: true,
            scoringWeights: {
                gpu: 0.5,
                cpu: 0.4,
                ram: 0.1
            }
        }
    };

    return profiles[usage] || profiles.gaming;
}


/**
 * מחשב ציון ביצועים משוקלל לפי פרופיל.
 *
 * @param {number} cpuScore  - ציון CPU (cores*100 + baseClock*50)
 * @param {number} gpuScore  - ציון GPU (vram*200)
 * @param {number} ramCapacity - קיבולת RAM (GB)
 * @param {object} weights   - משקלות {cpu, gpu, ram}
 * @returns {number} ציון משוקלל (מעוגל)
 */
function calculateWeightedScore(cpuScore, gpuScore, ramCapacity, weights) {
    var cpu = (cpuScore || 0) * (weights.cpu || 0);
    var gpu = (gpuScore || 0) * (weights.gpu || 0);
    var ram = (ramCapacity || 0) * (weights.ram || 0);
    return Math.round(cpu + gpu + ram);
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
//     1. $match CPUs within budget
//     2. $lookup Self-Join → find Motherboards by socket
//     3. $lookup Self-Join → find RAM by generation
//     4. $project with $add → calculate partial price
//     5. $out → save core build (CPU+Mobo+RAM)
//
//   Phase B — JavaScript Completion (Section 3):
//     6. Find best GPU within remaining budget
//     7. Find compatible Case (GPU length check)
//     8. Find PSU with sufficient wattage
//     9. Find cheapest Storage and CPU Cooler
//    10. Calculate weighted score
//    11. Save complete build
//
// ============================================================

function buildAutoPC(budget, usageType) {
    var usage = usageType || "gaming";
    var params = getProfileParams(usage);

    print("=".repeat(60));
    print("  Building " + params.name + " PC — Budget: $" + budget);
    print("=".repeat(60));

    // --- Budget Allocation (Section 3: Constraint Relaxation) ---
    // Instead of fixed per-component caps, we use budgetForCore as the
    // total constraint, and allow CPU up to 85% of it (safeguard against
    // budget starvation — prevents CPU from consuming all core budget).
    var budgetForCore = Math.round(budget * (1 - params.gpuBudgetRatio));
    var maxCpuPrice = Math.round(budgetForCore * 0.85);
    var minRamGb = params.minRamGb;

    print("\n  Budget allocation (Constraint Relaxation):");
    print("    Core budget (CPU+Mobo+RAM): $" + budgetForCore);
    print("    Max CPU price (85% safeguard): $" + maxCpuPrice);
    print("    Min RAM: " + minRamGb + "GB");

    // --- Build CPU match criteria (Section 3: dynamic query) ---
    var cpuMatch = {
        type: "CPU",
        price: { $type: "number", $lte: maxCpuPrice },
        "specs.score": { $type: "number" },
        "requirements.socket_match": { $exists: true, $ne: null }
    };

    // Gaming/Enthusiast: prefer X3D CPUs (larger L3 cache for gaming)
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
        // Stage 3: $limit — Top 15 candidates
        // Wider pool for Constraint Relaxation (more combos to evaluate)
        // -------------------------------------------------------
        { $limit: 15 },

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
        // Stage 6: $match — Keep only Motherboards
        // ה-Self-Join הביא הכל (כולל CPUs אחרים עם אותו socket).
        // שומרים רק לוחות-אם עם מחיר תקף ו-ram_type ידוע.
        // -------------------------------------------------------
        {
            $match: {
                "socket_matches.type": "Motherboard",
                "socket_matches.price": { $type: "number" },
                "socket_matches.specs.ram_type": { $ne: null }
            }
        },

        // -------------------------------------------------------
        // Stage 7: $sort — Cheapest motherboard first
        // הכנה ל-$group עם $first — הזול ביותר ייבחר
        // -------------------------------------------------------
        { $sort: { "specs.score": -1, "socket_matches.price": 1 } },

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
        // Stage 11: $match — Filter valid RAM
        // שומר רק RAM עם קיבולת מספקת ומחיר תקף
        // -------------------------------------------------------
        {
            $match: {
                "ram_matches.type": "RAM",
                "ram_matches.specs.capacity_gb": { $gte: minRamGb },
                "ram_matches.price": { $type: "number" }
            }
        },

        // -------------------------------------------------------
        // Stage 12: $sort — Cheapest RAM first
        // -------------------------------------------------------
        { $sort: { cpu_score: -1, "ram_matches.price": 1 } },

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
        // Note: Must list ALL fields explicitly because
        // $addFields was not taught — $project is the replacement.
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
        // Also filters by budget threshold.
        //
        // Demonstrates: $expr for field comparison (מצגת 9, שקף 10)
        // -------------------------------------------------------
        {
            $match: {
                $expr: { $eq: ["$cpu_socket", "$mobo_socket"] },
                partial_price: { $lte: budgetForCore }
            }
        },

        // -------------------------------------------------------
        // Stage 16: $sort — Best build first, maximize spending
        // partial_price DESC = use as much of the budget as possible
        // -------------------------------------------------------
        { $sort: { cpu_score: -1, partial_price: -1 } },

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
        print("  No X3D CPUs found in budget. Retrying without preference...");

        var cpuMatchRetry = {
            type: "CPU",
            price: { $type: "number", $lte: maxCpuPrice },
            "specs.score": { $type: "number" },
            "requirements.socket_match": { $exists: true, $ne: null }
        };
        pipeline[0] = { $match: cpuMatchRetry };

        db.recommended_combos.drop();
        db.components.aggregate(pipeline);
        coreResult = db.recommended_combos.findOne();
    }

    // Retry 2: If high RAM requirement yielded no results, try 16GB
    if (!coreResult && minRamGb > 16) {
        print("  No results with " + minRamGb + "GB RAM. Retrying with 16GB...");

        pipeline[10] = {
            $match: {
                "ram_matches.type": "RAM",
                "ram_matches.specs.capacity_gb": { $gte: 16 },
                "ram_matches.price": { $type: "number" }
            }
        };

        db.recommended_combos.drop();
        db.components.aggregate(pipeline);
        coreResult = db.recommended_combos.findOne();
    }

    // Retry 3: Ultimate fallback
    if (!coreResult) {
        print("  Pipeline returned no results. Using fallback...");
        return buildCheapestPossible(usage);
    }

    print("\n  [Phase A Complete] Core build:");
    print("    CPU:  " + coreResult.cpu_name + " ($" + coreResult.cpu_price + ")");
    print("    Mobo: " + coreResult.mobo_name + " ($" + coreResult.mobo_price + ")");
    print("    RAM:  " + coreResult.ram_name + " ($" + coreResult.ram_price + ")");
    print("    Subtotal: $" + coreResult.partial_price);


    // ========================================================
    // PHASE B: JavaScript Completion (Section 3)
    // GPU, Case, PSU, Storage, Cooler — no FK for basic $lookup
    // ========================================================

    print("\n[Phase B] Completing build with JavaScript (Section 3)...");

    // --- Smart Budget Reserve (Section 3: dynamic allocation) ---
    // Allow 5-10% budget overflow for better component matching
    var maxAllowedTotal = Math.round(budget * 1.05);
    var moneyLeft = maxAllowedTotal - coreResult.partial_price;

    // Dynamic accessory reserve: tight budgets get minimum ($90),
    // larger budgets reserve $200 for quality accessories
    //   $90 ≈ cheapest Case($35) + PSU($25) + SSD($20) + Cooler($10)
    var accessoryReserve = (budget < 1000) ? 90 : 200;
    var gpuMaxPrice = moneyLeft - accessoryReserve;

    print("    Max allowed total (105%): $" + maxAllowedTotal);
    print("    Money left for GPU+Acc: $" + Math.round(moneyLeft));
    print("    Accessory reserve: $" + accessoryReserve);
    print("    GPU max price: $" + Math.round(gpuMaxPrice));


    // --- GPU Selection (best score within remaining budget) ---

    var gpu = null;
    if (gpuMaxPrice > 0) {
        gpu = db.components.find({
            type: "GPU",
            price: { $type: "number", $lte: gpuMaxPrice },
            "specs.score": { $type: "number" }
        }).sort({ "specs.score": -1, price: 1 }).limit(1).toArray()[0] || null;
    }

    // Fallback: cheapest GPU if none found in budget
    if (!gpu) {
        gpu = db.components.find({
            type: "GPU",
            price: { $type: "number" }
        }).sort({ price: 1 }).limit(1).toArray()[0] || null;
    }

    if (!gpu) {
        print("  ERROR: No GPU found in database!");
        return buildCheapestPossible(usage);
    }

    print("    GPU: " + gpu.name + " ($" + gpu.price + ")");


    // --- Case Selection (must fit GPU length) ---

    var gpuLength = (gpu.specs && gpu.specs.length_mm) ? gpu.specs.length_mm : 0;
    var pcCase = db.components.find({
        type: "Case",
        price: { $type: "number" },
        "specs.max_gpu_length": { $gte: gpuLength }
    }).sort({ price: 1 }).limit(1).toArray()[0] || null;

    if (!pcCase) {
        // Fallback: any case
        pcCase = db.components.find({
            type: "Case",
            price: { $type: "number" }
        }).sort({ price: 1 }).limit(1).toArray()[0] || null;
    }

    print("    Case: " + (pcCase ? pcCase.name + " ($" + pcCase.price + ")" : "NOT FOUND"));


    // --- PSU Selection (must meet wattage requirement) ---

    var gpuVram = (gpu.specs && gpu.specs.vram) ? gpu.specs.vram : 8;
    var cpuTdp = coreResult.cpu_tdp || 65;
    var requiredWatts = calculateRequiredWatts(cpuTdp, gpuVram);

    var psu = db.components.find({
        type: "Power Supply",
        price: { $type: "number" },
        "specs.wattage": { $gte: requiredWatts }
    }).sort({ price: 1 }).limit(1).toArray()[0] || null;

    if (!psu) {
        // Fallback: most powerful PSU available
        psu = db.components.find({
            type: "Power Supply",
            price: { $type: "number" }
        }).sort({ "specs.wattage": -1 }).limit(1).toArray()[0] || null;
    }

    print("    PSU: " + (psu ? psu.name + " ($" + psu.price + ")" : "NOT FOUND"));


    // --- Storage Selection (cheapest) ---

    var storage = db.components.find({
        type: "Storage",
        price: { $type: "number" }
    }).sort({ price: 1 }).limit(1).toArray()[0] || null;

    print("    Storage: " + (storage ? storage.name + " ($" + storage.price + ")" : "NOT FOUND"));


    // --- CPU Cooler Selection (cheapest) ---

    var cooler = db.components.find({
        type: "CPU Cooler",
        price: { $type: "number" }
    }).sort({ price: 1 }).limit(1).toArray()[0] || null;

    print("    Cooler: " + (cooler ? cooler.name + " ($" + cooler.price + ")" : "NOT FOUND"));


    // --- Calculate Totals ---

    var gpuPrice = gpu ? gpu.price : 0;
    var casePrice = pcCase ? pcCase.price : 0;
    var psuPrice = psu ? psu.price : 0;
    var storagePrice = storage ? storage.price : 0;
    var coolerPrice = cooler ? cooler.price : 0;

    var totalPrice = coreResult.partial_price + gpuPrice + casePrice +
        psuPrice + storagePrice + coolerPrice;


    // --- Weighted Score (Section 3: scoring function) ---

    var gpuScore = (gpu && gpu.specs && gpu.specs.score) ? gpu.specs.score : 0;
    var weightedScore = calculateWeightedScore(
        coreResult.cpu_score,
        gpuScore,
        coreResult.ram_capacity,
        params.scoringWeights
    );


    // --- Budget Check (allow 5% overflow) ---

    if (totalPrice > maxAllowedTotal) {
        print("\n  WARNING: Total ($" + totalPrice + ") exceeds 105% of budget ($" + maxAllowedTotal + ")");
        print("  Using fallback mechanism...");
        return buildCheapestPossible(usage);
    }


    // ========================================================
    // PHASE C: Save complete build to recommended_combos
    // ========================================================

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
            case_max_gpu_length_mm: pcCase ? pcCase.specs.max_gpu_length : null,
            required_watts: requiredWatts,
            psu_wattage: psu ? psu.specs.wattage : null
        },
        performance_metrics: {
            cpu_score: coreResult.cpu_score,
            gpu_score: gpuScore,
            weighted_score: weightedScore
        },
        total_price: totalPrice,
        generated_at: new Date()
    };

    // Replace pipeline's partial result with the complete build
    db.recommended_combos.drop();
    db.recommended_combos.insertOne(completeBuild);

    print("\n" + "=".repeat(60));
    print("  BUILD COMPLETE!");
    print("    CPU:   " + completeBuild.components.cpu);
    print("    GPU:   " + completeBuild.components.gpu);
    print("    RAM:   " + completeBuild.components.ram);
    print("    Total: $" + totalPrice + " (Budget: $" + budget + ")");
    print("    Score: " + weightedScore);

    // Section 3: DDR generation warning (inform user, don't block)
    var ramGen = coreResult.ram_generation || coreResult.mobo_ram_type || "";
    if (ramGen === "DDR2" || ramGen === "DDR3") {
        print("\n  WARNING: This build uses " + ramGen + " memory.");
        print("  " + ramGen + " is outdated and no longer manufactured.");
        print("  Consider increasing budget for a DDR4/DDR5 system.");
        completeBuild.warning = ramGen + " is outdated. Consider higher budget.";
    }
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

    // Find cheapest CPU with valid socket — Section 4: find().sort().limit()
    var cpu = db.components.find({
        type: "CPU",
        price: { $type: "number" },
        "requirements.socket_match": { $exists: true, $ne: null }
    }).sort({ price: 1 }).limit(1).toArray()[0] || null;

    if (!cpu) {
        print("  FATAL: No CPUs in database!");
        return null;
    }

    // Find cheapest motherboard for that socket
    var mobo = db.components.find({
        type: "Motherboard",
        "specs.socket": cpu.requirements.socket_match,
        price: { $type: "number" }
    }).sort({ price: 1 }).limit(1).toArray()[0] || null;

    if (!mobo) {
        print("  FATAL: No motherboard for socket " + cpu.requirements.socket_match);
        return null;
    }

    // Determine RAM type (fallback to DDR4 if unknown)
    var ramType = (mobo.specs && mobo.specs.ram_type) ? mobo.specs.ram_type : "DDR4";

    var ram = db.components.find({
        type: "RAM",
        "specs.generation": ramType,
        price: { $type: "number" }
    }).sort({ price: 1 }).limit(1).toArray()[0] || null;

    var gpu = db.components.find(
        { type: "GPU", price: { $type: "number" } }
    ).sort({ price: 1 }).limit(1).toArray()[0] || null;

    var cooler = db.components.find(
        { type: "CPU Cooler", price: { $type: "number" } }
    ).sort({ price: 1 }).limit(1).toArray()[0] || null;

    var pcCase = db.components.find(
        { type: "Case", price: { $type: "number" } }
    ).sort({ price: 1 }).limit(1).toArray()[0] || null;

    var psu = db.components.find(
        { type: "Power Supply", price: { $type: "number" } }
    ).sort({ price: 1 }).limit(1).toArray()[0] || null;

    var storage = db.components.find(
        { type: "Storage", price: { $type: "number" } }
    ).sort({ price: 1 }).limit(1).toArray()[0] || null;

    // Verify all components exist
    if (!ram || !gpu || !cooler || !pcCase || !psu || !storage) {
        print("  FATAL: Missing essential components in database!");
        return null;
    }

    var totalPrice = cpu.price + mobo.price + ram.price + gpu.price +
        cooler.price + pcCase.price + psu.price + storage.price;

    var result = {
        build_name: "Fallback - Cheapest Build",
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
    print("  WARNING: Cheapest configuration — no budget optimization.");

    // Section 3: DDR generation warning
    if (ramType === "DDR2" || ramType === "DDR3") {
        print("\n  WARNING: This build uses " + ramType + " memory.");
        print("  " + ramType + " is outdated and no longer manufactured.");
        print("  Consider increasing budget for a DDR4/DDR5 system.");
        result.warning = (result.warning || "") + " " + ramType + " is outdated.";
    }
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
    // Expected: X3D CPU, DDR5, best GPU within remaining budget
    // --------------------------------------------------------
    print("\n\n>>> Demo 1: Gaming Build ($1700)");
    var gaming = buildAutoPC(1700, "gaming");

    // --------------------------------------------------------
    // Demo 2: Workstation Build ($2500)
    // Expected: High-core CPU, 32GB+ RAM, moderate GPU
    // --------------------------------------------------------
    print("\n\n>>> Demo 2: Workstation Build ($2500)");
    var workstation = buildAutoPC(2500, "workstation");

    // --------------------------------------------------------
    // Demo 3: Enthusiast Build ($5000)
    // Expected: Top-tier CPU + GPU, 64GB+ RAM
    // --------------------------------------------------------
    print("\n\n>>> Demo 3: Enthusiast Build ($5000)");
    var enthusiast = buildAutoPC(5000, "enthusiast");

    // --------------------------------------------------------
    // Demo 4: Budget Build ($500)
    // Expected: Likely triggers fallback mechanism
    // --------------------------------------------------------
    print("\n\n>>> Demo 4: Budget Build ($500) — Fallback Expected");
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
    print("\n  All " + validBuilds.length + " builds saved to 'recommended_combos'");


    // --------------------------------------------------------
    // Statistics Pipelines
    // --------------------------------------------------------
    print("\n\n>>> Running Statistics Pipelines...");

    runMarketAnalysis();
    runManufacturerBreakdown();
    runHighValueAnalysis();


    // --------------------------------------------------------
    // Summary
    // --------------------------------------------------------
    print("\n\n" + "=".repeat(70));
    print("  SECTION 6 COMPLETE!");
    print("  Collections created:");
    print("    - recommended_combos  (" + validBuilds.length + " builds)");
    print("    - market_analysis");
    print("    - manufacturer_breakdown");
    print("    - high_value_components");
    print("");
    print("  Operators demonstrated:");
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
