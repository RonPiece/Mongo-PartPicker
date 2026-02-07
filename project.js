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

// If a previous run failed mid-seed, the guard may be set while the DB is empty.
// Auto-recover by clearing the flag when collections are missing/empty.
try {
    if (globalThis.__MPP_SEEDED__ === true) {
        var __mppCols = (typeof db.getCollectionNames === "function") ? db.getCollectionNames() : [];
        var __mppHasComponents = __mppCols.indexOf("components") >= 0;
        if (!__mppHasComponents) {
            delete globalThis.__MPP_SEEDED__;
        } else {
            var __mppCount = 0;
            try {
                __mppCount = db.components.countDocuments({});
            } catch (e) {
                __mppCount = db.components.find({}).limit(1).toArray().length;
            }
            if (__mppCount === 0) delete globalThis.__MPP_SEEDED__;
        }
    }
} catch (e) {
    // ignore
}

// Seed guard:
// - First load() seeds the DB.
// - Subsequent load() calls only re-define functions (no drop/reseed).
// To force a full re-seed in mongosh: `delete globalThis.__MPP_SEEDED__` then load() again.
if (!globalThis.__MPP_SEEDED__) {
    globalThis.__MPP_SEEDED__ = "in-progress";
    try {

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
        // Load data.js without relying on cd(), which may not exist in some mongosh installs.
        // Prefer absolute path derived from USERPROFILE, with a relative fallback.
        var __mppRepo = null;
        try {
            if (typeof process !== "undefined" && process.env && process.env.USERPROFILE) {
                // Modified to work on user's machine, but now made more dynamic using pwd()
                __mppRepo = (typeof pwd === "function") ? pwd() : "c:/Users/Ron/Documents/GitHub/Mongo-PartPicker";
                globalThis.__MPP_REPO_ROOT__ = __mppRepo;
            }
        } catch (e) {
            // ignore
        }

        var __mppLoadedData = false;
        try {
            if (__mppRepo) {
                load(__mppRepo + "/data.js");
                __mppLoadedData = true;
            }
        } catch (e) {
            __mppLoadedData = false;
        }

        if (!__mppLoadedData) {
            load("./data.js");
        }

        // ============================================================
        // Section 2 (continued): Insert pre-transformed data from data.js
        // All transformation functions are now in data.js (Section 3)
        // ============================================================

        // Section 3: Batch insert utility function (JS helper for efficient inserts)
        function batchInsert(arr, batchSize) {
            batchSize = batchSize || 1000;
            for (var i = 0; i < arr.length; i += batchSize) {
                var batch = arr.slice(i, i + batchSize);
                db.components.insertMany(batch);
            }
        }

        // Insert all pre-transformed component data
        print("Inserting components...");
        batchInsert(transformedCpus, 1000);
        print("  CPUs: " + transformedCpus.length);

        batchInsert(transformedGpus, 1000);
        print("  GPUs: " + transformedGpus.length);

        batchInsert(transformedMotherboards, 1000);
        print("  Motherboards: " + transformedMotherboards.length);

        batchInsert(transformedCases, 1000);
        print("  Cases: " + transformedCases.length);

        batchInsert(transformedRam, 1000);
        print("  RAM: " + transformedRam.length);

        batchInsert(transformedStorage, 1000);
        print("  Storage: " + transformedStorage.length);

        batchInsert(transformedCoolers, 1000);
        print("  CPU Coolers: " + transformedCoolers.length);

        batchInsert(transformedPsus, 1000);
        print("  Power Supplies: " + transformedPsus.length);

        print("Component insertion complete!");


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

        ; (function seedDemoEngagement() {
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

        globalThis.__MPP_SEEDED__ = true;
    } catch (e) {
        delete globalThis.__MPP_SEEDED__;
        throw e;
    }

}

// ============================================================
// Section 3: JSON + JavaScript (Functions and processing)
// Note: JSON loading is done in data.js using cat() + JSON.parse()
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
// Section 4: Search and Retrieval (Queries) - clean version
// ============================================================

// 1. Simple query with Projection and use of limit
// Finds CPUs with a score higher than 30,000 and shows only name, price, and score
db.components.find(
    { type: "CPU", "specs.score": { $gt: 30000 } },
    { name: 1, price: 1, "specs.score": 1, _id: 0 }
).limit(2)


// 2. Query on embedded documents and arrays (Embedded)
// Requirement: access elements inside arrays
// Finds users who made an order that contains an item of type GPU
// Method: Dot Notation - direct access into nested arrays
db.users.find(
    { "orders.items.type": "GPU" },
    { username: 1, email: 1, _id: 0 }
).limit(3)


// 3. Query on referenced data (Referenced)
// Requirement: data coming from documents that are referenced
// Step A: fetch the ID of the RTX 4090 GPU
var gpuDoc = db.components.findOne({ name: { $regex: "RTX 4090", $options: "i" } });

// Step B: find all builds that contain this component in their parts array
db.builds.find(
    { parts: gpuDoc._id },
    { build_name: 1, total_price: 1, _id: 0 }
).limit(3)


// 4. Combine sort, skip, limit, and convert to array
// Requirement: combine sort, skip, limit, toArray
// Finds the most expensive motherboards, skips the first 2, and takes the next 3
db.components.find({ type: "Motherboard" })
    .sort({ price: -1 }) // Sort from expensive to cheap
    .skip(2)             // Skip the 2 most expensive
    .limit(3)            // Show the next 3
    .toArray()           // Convert to a JavaScript array


// 5. Using a forEach loop
// Requirement: use forEach
// Iterate over cheap RAM kits (under $40) and perform an action (print) for each document
db.components.find({ type: "RAM", price: { $lt: 40 } })
    .limit(3)
    .forEach(function (ram) {
        print(">> Great deal! The RAM " + ram.name + " costs only $" + ram.price);
    })


// 6. Complex logical query ($or + Regex)
// Search for cases (Case) from ASUS or MSI (text search)
db.components.find(
    {
        type: "Case",
        $or: [
            { name: { $regex: "ASUS", $options: "i" } },
            { name: { $regex: "MSI", $options: "i" } }
        ]
    },
    { name: 1, price: 1, _id: 0 }
).limit(3)


// 7. Count
// Requirement: use count
// Check how many components exist in total in the catalog
db.components.count({})


// 8. $in operator - Query multiple types at once
// Finds components that are either a CPU or GPU, sorted by price (expensive first)
db.components.find(
    { type: { $in: ["CPU", "GPU"] }, price: { $type: "number" } },
    { name: 1, type: 1, price: 1, _id: 0 }
).sort({ price: -1 }).limit(3)


// 9. $exists + array index check - Find components that have reviews
// Uses "reviews.0" ($exists) to verify the array is non-empty
db.components.find(
    { reviews: { $exists: true }, "reviews.0": { $exists: true } },
    { name: 1, type: 1, "reviews.user": 1, "reviews.rating": 1, _id: 0 }
).limit(5)


// 10. cursor .count() (deprecated but required per spec)
// Counts the number of GPUs with a numeric price using the legacy count() method
db.components.find({ type: "GPU", price: { $type: "number" } }).count()


// 11. Explicit $and with range query ($gte + $lte)
// Finds GPUs priced between $300 and $800 - shows combining logical operators
db.components.find(
    {
        $and: [
            { type: "GPU" },
            { price: { $gte: 300 } },
            { price: { $lte: 800 } }
        ]
    },
    { name: 1, price: 1, "specs.chipset": 1, _id: 0 }
).sort({ price: 1 }).limit(5)




// ============================================================
// Section 5: Updates & Deletes
// ============================================================

// 1. $set - Update standard fields
// Updates the score and adds a new boolean field 'is_featured'
db.components.updateOne(
    { name: "Intel Core i5-14600K" },
    { $set: { "specs.score": 33000, is_featured: true } }
);

// 2. $push - Add to array
// Adds a new review object to the 'reviews' array
db.components.updateOne(
    { name: "AMD Ryzen 7 7800X3D" },
    { $push: { reviews: { user: "newreviewer", rating: 5, comment: "Excellent!", date: new Date() } } }
);

// 3. $pull - Remove from array
// Removes the specific review we just added (cleanup)
db.components.updateOne(
    { name: "AMD Ryzen 7 7800X3D" },
    { $pull: { reviews: { user: "newreviewer" } } }
);

// 4. updateMany - Bulk update
// Sets 'in_stock: true' for all documents in the collection
db.components.updateMany({}, { $set: { in_stock: true } });

// 5. $inc - Mathematical calculation (Increment)
// Increases price by 10
db.components.updateMany(
    { manufacturer: "NVIDIA", price: { $type: "number" } },
    { $inc: { price: 10 } }
);

// Reverts to original price (Decreases by 10)
db.components.updateMany(
    { manufacturer: "NVIDIA", price: { $type: "number" } },
    { $inc: { price: -10 } }
);

// 6. $addToSet - Add to array without duplicates
// Adds the 'Best Seller' tag only if it doesn't already exist
db.components.updateOne(
    { type: "GPU", manufacturer: "NVIDIA", "specs.chipset": "GeForce RTX 4090" },
    { $addToSet: { tags: "Best Seller" } }
);

// 7. $pop - Remove from end of array
// Removes the last element from the 'price_history' array
db.components.updateOne(
    { name: "Samsung 990 Pro 2TB" },
    { $pop: { price_history: 1 } }
);

// 8. $unset - Remove field completely
// Deletes the 'is_featured' field from the document
db.components.updateOne(
    { name: "Intel Core i5-14600K" },
    { $unset: { is_featured: "" } }
);

// 9. deleteOne - Delete a single document
// Inserts a temporary document and then deletes it
db.components.insertOne({
    _id: ObjectId(), type: "Demo", name: "TEMP-DELETE-ME", price: 0
});
db.components.deleteOne({ name: "TEMP-DELETE-ME" });

// --- Collection Management ---

// 10. Full collection backup ($out)
// Duplicates the entire 'builds' collection to 'builds_backup'
db.builds_backup.drop();
db.builds.aggregate([{ $match: {} }, { $out: "builds_backup" }]);

// 11. Partial collection backup (by criterion)
// Creates a backup containing only 'Gaming' builds
db.gaming_builds.drop();
db.builds.aggregate([{ $match: { usage_type: "Gaming" } }, { $out: "gaming_builds" }]);

// 12. Drop collection
// Deletes the 'gaming_builds' collection entirely
db.gaming_builds.drop();

// 13. Partial data deletion (deleteMany with criterion)
// Create a temporary collection first
db.demo_ops.drop();
db.components.aggregate([{ $match: { type: "CPU" } }, { $out: "demo_ops" }]);

// Deletes only CPUs cheaper than $200 from the demo collection
db.demo_ops.deleteMany({ price: { $lt: 200 } });

// 14. Rename collection and final cleanup
// Renames 'demo_ops' to 'demo_ops_renamed'
db.demo_ops.renameCollection("demo_ops_renamed", true);

// Deletes all documents within the renamed collection
db.demo_ops_renamed.deleteMany({});

// Drops the empty collection
db.demo_ops_renamed.drop();

// 15. remove() - Delete using legacy method (required by syllabus)
// Creates a temporary collection and uses remove()
db.temp_remove_demo.drop();
db.components.aggregate([
    { $match: { type: "Power Supply" } },
    { $limit: 3 },
    { $out: "temp_remove_demo" }
]);

// Explicitly using 'remove' as requested in the requirements
db.temp_remove_demo.remove({ "specs.wattage": { $lt: 700 } })

db.temp_remove_demo.drop();

// ============================================================
// Section 6: Advanced aggregation - "The Auto-Builder"
// Self-Join Lookup for automatic PC building
// Section 3: Dynamic pipeline generation via JavaScript function
// ============================================================

// ============================================================
// Section 3 + Section 6: The Dynamic Auto-Builder (Function)
// A JavaScript function that GENERATES an aggregation pipeline
// Builds the best full PC possible under a given budget
// Includes physical compatibility checks:
// - CPU socket == Motherboard socket
// - GPU length fits the Case max length
// - PSU wattage meets an estimated requirement
// ============================================================

// ============================================================
// The Smart & Fast Auto-Builder (Cascading)
// Fast because it limits candidates at each stage, but strict on:
// - CPU socket == Motherboard socket
// - RAM generation matches motherboard requirement (when known)
// - GPU length fits Case
// - PSU wattage is sufficient
// - Total price <= budget
// ============================================================

function autoBuilderPipeline(maxBudget, buildNameLiteral, usageType) {
    // Normalize usageType (default to "gaming" if not specified)
    var usage = (usageType || "gaming").toLowerCase();

    // Dynamic budget allocation based on usage type
    var cpuBudgetRatio, minRamGb, gpuScoreMultiplier, cpuNamePreference;

    if (usage === "workstation") {
        // Workstation: CPU is king, need lots of cores for rendering/multitasking
        cpuBudgetRatio = 0.40;      // 40% for CPU (Intel i9 / Ryzen 9)
        minRamGb = 32;              // Minimum 32GB RAM for heavy workloads
        gpuScoreMultiplier = 1.0;   // GPU score weighted normally
        cpuNamePreference = null;   // No brand preference (both Intel/AMD excel here)
    } else if (usage === "budget") {
        // Budget: Best bang for buck, balanced approach
        cpuBudgetRatio = 0.30;      // 30% for CPU
        minRamGb = 16;              // 16GB is enough
        gpuScoreMultiplier = 1.2;   // Slightly prefer better GPU
        cpuNamePreference = null;
    } else {
        // Gaming (default): GPU is king, AMD X3D CPUs excel due to L3 cache
        cpuBudgetRatio = 0.25;      // Only 25% for CPU, save money for GPU
        minRamGb = 16;              // 16GB is enough for gaming
        gpuScoreMultiplier = 1.5;   // GPU score weighted 50% more
        cpuNamePreference = "X3D";  // Prefer AMD X3D chips (7800X3D, 9800X3D)
    }

    var maxCpuPrice = maxBudget * cpuBudgetRatio;

    // Build CPU match criteria (optionally prefer X3D for gaming)
    var cpuMatchCriteria = {
        type: "CPU",
        price: { $type: "number", $lte: maxCpuPrice },
        "specs.score": { $type: "number" },
        "requirements.socket_match": { $exists: true, $ne: null }
    };

    // For gaming, try to find X3D CPUs first (they have massive L3 cache)
    // If cpuNamePreference is set, add a regex filter
    if (cpuNamePreference) {
        cpuMatchCriteria.name = { $regex: cpuNamePreference, $options: "i" };
    }

    return [
        // 1) CPU (top candidates within CPU budget)
        // Gaming: Prefers AMD X3D (7800X3D, 9800X3D) for cache advantage
        // Workstation: Any high-core CPU (Intel i9, Ryzen 9)
        {
            $match: cpuMatchCriteria
        },
        { $sort: { "specs.score": -1, price: 1 } },
        { $limit: 10 },

        // 2) Motherboard (socket match, cheapest)
        {
            $lookup: {
                from: "components",
                let: { cpu_socket: "$requirements.socket_match" },
                pipeline: [
                    {
                        $match: {
                            type: "Motherboard",
                            price: { $type: "number" },
                            $expr: { $eq: ["$specs.socket", "$$cpu_socket"] }
                        }
                    },
                    { $sort: { price: 1 } },
                    { $limit: 1 }
                ],
                as: "mobo"
            }
        },
        { $unwind: "$mobo" },

        // 3) RAM (match DDR generation when known)
        {
            $addFields: {
                required_ram_type: {
                    $ifNull: [
                        "$mobo.specs.ram_type",
                        {
                            $switch: {
                                branches: [
                                    { case: { $eq: ["$mobo.specs.socket", "AM5"] }, then: "DDR5" },
                                    { case: { $eq: ["$mobo.specs.socket", "LGA1851"] }, then: "DDR5" },
                                    { case: { $eq: ["$mobo.specs.socket", "AM4"] }, then: "DDR4" },
                                    { case: { $eq: ["$mobo.specs.socket", "LGA1200"] }, then: "DDR4" },
                                    { case: { $eq: ["$mobo.specs.socket", "LGA1151"] }, then: "DDR4" }
                                ],
                                default: null
                            }
                        }
                    ]
                }
            }
        },
        // 3b) RAM lookup - respects minRamGb based on usage type
        // Workstation: 32GB minimum | Gaming/Budget: 16GB minimum
        {
            $lookup: {
                from: "components",
                let: { ram_type: "$required_ram_type" },
                pipeline: [
                    {
                        $match: {
                            type: "RAM",
                            price: { $type: "number" },
                            "specs.capacity_gb": { $type: "number", $gte: minRamGb },
                            $expr: { $eq: ["$specs.generation", "$$ram_type"] }
                        }
                    },
                    { $sort: { price: 1 } },
                    { $limit: 1 }
                ],
                as: "ram"
            }
        },
        { $unwind: "$ram" },

        // 4) Compute remaining budget (for GPU)
        {
            $addFields: {
                base_cost: { $add: ["$price", "$mobo.price", "$ram.price"] },
                remaining_budget: { $subtract: [maxBudget, { $add: ["$price", "$mobo.price", "$ram.price"] }] }
            }
        },

        // 5) GPU (best score within remaining budget)
        // Use a small top-k so if later compatibility/budget fails, we still have fallbacks.
        {
            $lookup: {
                from: "components",
                let: { money_left: "$remaining_budget" },
                pipeline: [
                    {
                        $match: {
                            type: "GPU",
                            price: { $type: "number" },
                            "specs.score": { $type: "number" },
                            "specs.length_mm": { $type: "number" },
                            $expr: { $lte: ["$price", "$$money_left"] }
                        }
                    },
                    { $sort: { "specs.score": -1, price: 1 } },
                    { $limit: 5 }
                ],
                as: "gpu"
            }
        },
        { $unwind: "$gpu" },

        // 6) CPU Cooler (cheapest)
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

        // 7) Case (GPU length + motherboard form factor)
        {
            $lookup: {
                from: "components",
                let: { gpu_len: "$gpu.specs.length_mm", mobo_form: "$mobo.specs.form_factor" },
                pipeline: [
                    {
                        $match: {
                            type: "Case",
                            price: { $type: "number" },
                            "specs.max_gpu_length": { $type: "number" },
                            $expr: {
                                $and: [
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

        // 8) PSU (wattage sufficient)
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
                            type: "Power Supply",
                            price: { $type: "number" },
                            "specs.wattage": { $type: "number" },
                            $expr: { $gte: ["$specs.wattage", "$$required_watts"] }
                        }
                    },
                    { $sort: { price: 1 } },
                    { $limit: 1 }
                ],
                as: "psu"
            }
        },
        { $unwind: "$psu" },

        // 9) Storage (cheapest)
        {
            $lookup: {
                from: "components",
                pipeline: [
                    { $match: { type: "Storage", price: { $type: "number" }, "specs.capacity_gb": { $type: "number" } } },
                    { $sort: { price: 1 } },
                    { $limit: 1 }
                ],
                as: "storage"
            }
        },
        { $unwind: "$storage" },

        // 10) Final projection + budget check
        {
            $project: {
                _id: 0,
                build_name: { $literal: buildNameLiteral },
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
                compatibility_details: {
                    cpu_socket: "$requirements.socket_match",
                    motherboard_socket: "$mobo.specs.socket",
                    required_ram_type: "$required_ram_type",
                    selected_ram_generation: "$ram.specs.generation",
                    motherboard_form_factor: "$mobo.specs.form_factor",
                    case_supported_motherboards: "$pc_case.specs.supported_motherboards",
                    gpu_chipset: "$gpu.specs.chipset",
                    gpu_model: "$gpu.specs.model",
                    gpu_length_mm: "$gpu.specs.length_mm",
                    case_max_gpu_length_mm: "$pc_case.specs.max_gpu_length",
                    required_watts_estimate: "$estimated_required_watts",
                    psu_wattage: "$psu.specs.wattage"
                },
                total_price: {
                    $add: [
                        "$price",
                        "$mobo.price",
                        "$ram.price",
                        "$gpu.price",
                        "$cooler.price",
                        "$pc_case.price",
                        "$psu.price",
                        "$storage.price"
                    ]
                },
                performance_score: { $add: ["$specs.score", "$gpu.specs.score"] }
            }
        },

        { $match: { total_price: { $type: "number", $lte: maxBudget } } },
        { $sort: { performance_score: -1, total_price: 1 } },
        { $limit: 1 }
    ];
}

// ============================================================
// Wrapper functions for the Auto-Builder
// These provide convenient ways to run the pipeline
// ============================================================

/**
 * Build a PC within budget and save to recommended_combos collection.
 * 
 * @param {number} maxBudget - Maximum budget in USD (e.g., 1500)
 * @param {string} usageType - "gaming" | "workstation" | "budget" (default: "gaming")
 * @returns {object} The generated build document
 * 
 * EXAMPLES:
 *   buildComputerByBudget(1500, "gaming")      // Gaming rig at $1500
 *   buildComputerByBudget(2500, "workstation") // Workstation at $2500
 *   buildComputerByBudget(1000, "budget")      // Budget build at $1000
 *   buildComputerByBudget(2000)                // Defaults to gaming
 */
var buildComputerByBudget = function (maxBudget, usageType) {
    db.recommended_combos.drop();

    var usage = usageType || "gaming";
    var budgetLabel = maxBudget.toString();
    var buildNameLiteral = usage.charAt(0).toUpperCase() + usage.slice(1) + " Build for $" + budgetLabel;

    var pipeline = autoBuilderPipeline(maxBudget, buildNameLiteral, usage);
    pipeline.push({ $out: "recommended_combos" });
    db.components.aggregate(pipeline);

    return db.recommended_combos.findOne();
};

// Convenience alias (common typo in call-sites / docs)
var buildComputerByBudge = buildComputerByBudget;

/**
 * Build a PC and return document (without saving to collection).
 * Used internally by generateRecommendedCombosSamples.
 */
function buildComputerByBudgetDoc(maxBudget, runIndex, usageType) {
    var usage = usageType || "gaming";
    var budgetLabel = maxBudget.toString();
    var idx = (runIndex !== null && runIndex !== undefined) ? runIndex : null;
    var buildNameLiteral = idx
        ? (usage.charAt(0).toUpperCase() + usage.slice(1) + " Build for $" + budgetLabel + " (run " + idx + ")")
        : (usage.charAt(0).toUpperCase() + usage.slice(1) + " Build for $" + budgetLabel);

    var pipeline = autoBuilderPipeline(maxBudget, buildNameLiteral, usage);
    var doc = db.components.aggregate(pipeline).toArray()[0];
    if (!doc) return null;

    doc._id = ObjectId();
    doc.target_budget = maxBudget;
    doc.usage_type = usage;
    doc.generated_at = new Date();
    return doc;
}

function generateRecommendedCombosSamples(samples, minBudget, maxBudget) {
    var n = (samples !== null && samples !== undefined) ? samples : 100;
    var minB = (minBudget !== null && minBudget !== undefined) ? minBudget : 1000;
    var maxB = (maxBudget !== null && maxBudget !== undefined) ? maxBudget : 3500;

    if (n <= 0) return 0;
    if (maxB < minB) {
        var tmp = minB;
        minB = maxB;
        maxB = tmp;
    }

    db.recommended_combos.drop();
    db.createCollection("recommended_combos");

    var batch = [];
    for (var i = 0; i < n; i++) {
        var denom = (n === 1) ? 1 : (n - 1);
        var t = i / denom;
        var budget = Math.round(minB + (maxB - minB) * t);

        var doc = buildComputerByBudgetDoc(budget, i + 1);
        if (doc) batch.push(doc);
    }

    if (batch.length) {
        db.recommended_combos.insertMany(batch);
    }

    return batch.length;
}

// ============================================================
// Section 6: aggregate
// Run manually: buildComputerByBudget(<budget>)
// ============================================================

function section6_aggregate() {
    return buildComputerByBudget(3500);
}

// ============================================================
// Section 7: mapReduce
// Wrapped in a function to run manually.
// ============================================================

function section7_mapReduce(samples, minBudget, maxBudget) {
    // Generate many auto-build samples so MapReduce is meaningful.
    // NOTE: This can be slow because it runs many aggregation pipelines.
    // Keep a reasonable default so it doesn't look like it "hangs" in mongosh.
    var n = (samples !== null && samples !== undefined) ? samples : 30;
    var minB = (minBudget !== null && minBudget !== undefined) ? minBudget : 900;
    var maxB = (maxBudget !== null && maxBudget !== undefined) ? maxBudget : 4000;

    var started = new Date();
    print("[Section 7] Generating recommended combos: n=" + n + ", range=$" + minB + "-$" + maxB);
    generateRecommendedCombosSamples(n, minB, maxB);
    try {
        print("[Section 7] recommended_combos count: " + db.recommended_combos.countDocuments());
    } catch (e) {
        // ignore
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
            combo_id: this._id,
            build_name: this.build_name,
            score: this.performance_score,
            price: this.total_price,
            target_budget: this.target_budget
        });
    };

    var reduceBestBuild = function (key, values) {
        var best = values[0];
        values.forEach(function (v) {
            if (v.score > best.score) {
                best = v;
            } else if (v.score === best.score && v.price < best.price) {
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
            actual_price: reducedValue.price,
            target_budget: reducedValue.target_budget
        };
    };

    db.best_builds_per_tier.drop();
    db.recommended_combos.mapReduce(mapBudgetTier, reduceBestBuild, {
        out: "best_builds_per_tier",
        query: { total_price: { $type: "number" }, performance_score: { $type: "number" } },
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

    var out = {
        best_builds_per_tier: db.best_builds_per_tier.countDocuments(),
        manufacturer_stats_mr: db.manufacturer_stats_mr.countDocuments(),
        rating_distribution: db.rating_distribution.countDocuments(),
        user_gpu_spending: db.user_gpu_spending.countDocuments()
    };

    var ended = new Date();
    print("[Section 7] Done in " + Math.round((ended - started) / 1000) + "s");
    return out;
}

// Recommended manual run order by section:
// 1) (already ran above) setup + insertMany/insertOne
// 2) section4_findAndQuery()
// 3) section5_updatesAndDeletes()
// 4) section6_aggregate() or buildComputerByBudget(<budget>)
// 5) section7_mapReduce()
