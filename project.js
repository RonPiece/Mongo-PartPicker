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
                __mppRepo = (typeof pwd === "function") ? pwd() : "c:/Users/user/source/repos/MongopPcPartPicker";
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
// Section 6: Interactive PC Builder (Incremental Selection)
// ============================================================
//
// Pipeline Stages: $match, $project, $lookup (Self-Join),
//   $unwind, $group, $sort, $limit, $out, $expr
//
// Math Operators: $add, $subtract, $multiply, $divide, $round
// Accumulators:   $first, $sum, $avg, $min, $max, $push
//
// Section 3 JS Functions:
//   getProfileParams(), calculateWeightedScore(),
//   calculateRequiredWatts(), getCoolerReserve(),
//   getMinCosts(), futureReserve(), validateAndSave()
//
// Usage:
//   load("project_section6_interactive.js")
//   stepCPU(1500, "gaming")   → shows top CPUs
//   pick(3)                    → picks #3, shows next step
//   ...                        → keep picking until done
//
// ============================================================


// ============================================================
// Section 3: Profile Configuration (JS function)
// ============================================================

/**
 * מחזיר פרמטרים לפי פרופיל שימוש.
 * @param {string} usageType - gaming / workstation / budget / enthusiast
 * @returns {object} פרמטרים: יחסי תקציב, RAM מינימלי, משקלות ציון
 */
function getProfileParams(usageType) {
    var usage = (usageType || "gaming").toLowerCase();

    // Budget caps per category — prevents any single component from eating the budget
    // CPU + GPU are performance parts (get bigger share), rest are support parts (capped low)
    var profiles = {
        gaming: {
            name: "Gaming",
            cpuCap: 0.25, moboCap: 0.18, ramCap: 0.12, gpuCap: 0.40, storageCap: 0.10, coolerCap: 0.08,
            minRamGb: 16, maxRamGb: 32, minStorageGb: 500,
            maxStorageGb: 4000,
            scoringWeights: { gpu: 0.6, cpu: 0.4, ram: 0.0 }
        },
        workstation: {
            name: "Workstation",
            cpuCap: 0.35, moboCap: 0.20, ramCap: 0.15, gpuCap: 0.30, storageCap: 0.12, coolerCap: 0.10,
            minRamGb: 32, maxRamGb: 128, minStorageGb: 1000,
            maxStorageGb: 16000,
            scoringWeights: { cpu: 0.5, ram: 0.3, gpu: 0.2 }
        },
        budget: {
            name: "Budget",
            cpuCap: 0.25, moboCap: 0.12, ramCap: 0.10, gpuCap: 0.35, storageCap: 0.08, coolerCap: 0.06,
            minRamGb: 16, maxRamGb: 32, minStorageGb: 240,
            maxStorageGb: 2000,
            scoringWeights: { gpu: 0.5, cpu: 0.3, ram: 0.2 }
        },
        enthusiast: {
            name: "Enthusiast",
            cpuCap: 0.28, moboCap: 0.18, ramCap: 0.15, gpuCap: 0.40, storageCap: 0.12, coolerCap: 0.10,
            minRamGb: 64, maxRamGb: 128, minStorageGb: 1000,
            maxStorageGb: 8000,
            scoringWeights: { gpu: 0.5, cpu: 0.4, ram: 0.1 }
        }
    };

    return profiles[usage] || profiles.gaming;
}


// ============================================================
// Section 3: Scoring & Wattage (JS functions)
// ============================================================

/** ציון ביצועים משוקלל לפי פרופיל */
function calculateWeightedScore(cpuScore, gpuScore, ramCapacity, weights) {
    return Math.round(
        (cpuScore || 0) * (weights.cpu || 0) +
        (gpuScore || 0) * (weights.gpu || 0) +
        (ramCapacity || 0) * (weights.ram || 0)
    );
}

/**
 * דרישת ספק כוח — משתמש ב-Score לחישוב TDP אפקטיבי + 25% מרווח
 * (i9-12900F רשום 65W אבל שואב 200W+ בפועל)
 */
function calculateRequiredWatts(cpuTdp, gpuVram, cpuScore) {
    var effectiveCpu = cpuTdp || 65;
    // High-perf CPUs draw far more than listed TDP
    if ((cpuScore || 0) > 1500 && effectiveCpu < 150) effectiveCpu = 150;
    if ((cpuScore || 0) > 2000 && effectiveCpu < 200) effectiveCpu = 200;
    var gpuWatts = (gpuVram || 8) * 20;
    return Math.round((effectiveCpu + gpuWatts) * 1.25) + 50; // 25% margin + 50W buffer
}

/**
 * שריון מינימלי למקרר — Score מעל 1500 = TDP אפקטיבי 150W
 */
function getCoolerReserve(tdp, cpuScore) {
    var effectiveTdp = tdp || 65;
    if ((cpuScore || 0) > 1500 && effectiveTdp < 150) effectiveTdp = 150;
    if ((cpuScore || 0) > 2000 && effectiveTdp < 200) effectiveTdp = 200;

    if (effectiveTdp >= 150) return 80;
    if (effectiveTdp >= 125) return 60;
    if (effectiveTdp >= 95) return 40;
    if (effectiveTdp > 65) return 25;
    return 15;
}

/**
 * Section 3: בדיקת תאימות form factor — האם המארז מתאים ללוח-האם?
 * Full Tower > ATX > MicroATX > Mini ITX
 */
function caseSupportsMotherboard(caseForm, moboForm) {
    var cf = (caseForm || "").toLowerCase();
    var mf = (moboForm || "").toLowerCase();
    // Full/EATX tower fits everything
    if (cf.indexOf("full") >= 0 || cf.indexOf("eatx") >= 0) return true;
    // ATX mid tower: fits ATX, MicroATX, Mini ITX (not EATX)
    if (cf.indexOf("atx") >= 0 && cf.indexOf("micro") < 0 && cf.indexOf("mini") < 0) {
        return mf.indexOf("eatx") < 0;
    }
    // MicroATX tower: fits MicroATX and Mini ITX only
    if (cf.indexOf("micro") >= 0) {
        return mf.indexOf("micro") >= 0 || mf.indexOf("mini") >= 0;
    }
    // Mini ITX: fits Mini ITX only
    if (cf.indexOf("mini") >= 0) {
        return mf.indexOf("mini") >= 0;
    }
    return true; // unknown form factor → allow
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
    return str.length <= max ? str : str.substring(0, max - 2) + "..";
}


// ============================================================
// Global Build State
// ============================================================

var buildState = {
    budget: 0,
    usage: "",
    params: null,
    spent: 0,
    step: 0,
    buildTier: 1,
    minCosts: {},
    lastResults: [],
    selections: {
        cpu: null, motherboard: null, ram: null, gpu: null,
        storage: null, cooler: null, psu: null, pcCase: null
    }
};

var MODERN_SOCKETS = ["AM4", "AM5", "LGA1200", "LGA1700", "LGA1851"];


// ============================================================
// Section 6: Tier System — Price-Based Component Quality Tiers
// aggregate with $match, $sort, $group ($push, $sum),
// $project ($multiply, $floor, $arrayElemAt)
// ============================================================

/**
 * Section 6: מחשב גבולות Tier לפי אחוזוני מחיר בDB.
 * Entry (0–25%), Mid (25–60%), High (60–85%), Enthusiast (85%+)
 */
function getTierBoundaries(type) {
    var result = db.components.aggregate([
        { $match: { type: type, price: { $type: "number" } } },
        { $sort: { price: 1 } },
        {
            $group: {
                _id: null,
                prices: { $push: "$price" },
                total: { $sum: 1 }
            }
        },
        {
            $project: {
                entry_max: { $arrayElemAt: ["$prices", { $floor: { $multiply: ["$total", 0.25] } }] },
                mid_max: { $arrayElemAt: ["$prices", { $floor: { $multiply: ["$total", 0.60] } }] },
                high_max: { $arrayElemAt: ["$prices", { $floor: { $multiply: ["$total", 0.85] } }] }
            }
        }
    ]).toArray();
    return result[0] || { entry_max: 100, mid_max: 300, high_max: 600 };
}

var TIER_NAMES = ["", "Entry", "Mid", "High", "Enthusiast"]; // 1-indexed

// Modern CPU sockets — filters out ancient LGA775/AM2/FM2 etc.
var MODERN_SOCKETS = ["AM4", "AM5", "LGA1200", "LGA1700", "LGA1851"];
function priceTier(price, bounds) {
    if (price <= bounds.entry_max) return 1;
    if (price <= bounds.mid_max) return 2;
    if (price <= bounds.high_max) return 3;
    return 4;
}

function tierToFloor(minTier, bounds) {
    if (minTier <= 1) return 0;
    if (minTier === 2) return bounds.entry_max;
    if (minTier === 3) return bounds.mid_max;
    return bounds.high_max;
}


// ============================================================
// Section 3 + 6: Dynamic Budget Helpers
// ============================================================

/**
 * שואל את הDB פעם אחת למחיר המינימלי לכל סוג רכיב.
 * Section 6: aggregate with $group + $min accumulator
 */
function getMinCosts() {
    var result = db.components.aggregate([
        { $match: { price: { $type: "number", $gt: 0 } } },
        { $group: { _id: "$type", minPrice: { $min: "$price" } } }
    ]).toArray();
    var mins = {};
    for (var i = 0; i < result.length; i++) {
        mins[result[i]._id] = result[i].minPrice;
    }
    return mins;
}

/**
 * סוכם עלויות מינימום לרכיבים עתידיים — Quality-Aware.
 * משתמש בדרישות אמיתיות (לא DB minimum) לקירור ולספק כוח.
 */
function futureReserve(types) {
    var total = 0;
    var cpuSel = buildState.selections.cpu;
    var gpuSel = buildState.selections.gpu;
    var cpuTdp = (cpuSel && cpuSel.specs && cpuSel.specs.tdp) || 65;
    var cpuScore = (cpuSel && cpuSel.specs && cpuSel.specs.score) || 0;

    for (var i = 0; i < types.length; i++) {
        var t = types[i];
        var minCost = buildState.minCosts[t] || 0;

        // Quality override: actual cooler cost for this CPU
        if (t === "CPU Cooler" && cpuSel) {
            minCost = Math.max(minCost, getCoolerReserve(cpuTdp, cpuScore));
        }

        // Quality override: PSU must meet actual wattage requirements
        if (t === "Power Supply" && cpuSel && gpuSel) {
            var gpuVram = (gpuSel.specs && gpuSel.specs.vram) || 8;
            var reqWatts = calculateRequiredWatts(cpuTdp, gpuVram, cpuScore);
            // Find cheapest PSU that meets wattage (cached query)
            if (!buildState._psuMinCache || buildState._psuMinCache.watts !== reqWatts) {
                var psuResult = db.components.find({
                    type: "Power Supply", "specs.wattage": { $gte: reqWatts },
                    price: { $type: "number" }
                }).sort({ price: 1 }).limit(1).toArray();
                buildState._psuMinCache = {
                    watts: reqWatts,
                    price: psuResult.length > 0 ? psuResult[0].price : minCost
                };
            }
            minCost = Math.max(minCost, buildState._psuMinCache.price);
        }

        total += minCost;
    }
    return total;
}


// ============================================================
// Helper: Print formatted component list
// ============================================================

function printComponentList(results, columns) {
    if (results.length === 0) {
        print("  (no components found)");
        return;
    }

    var header = "   #   " + padRight("Name", 45) + padLeft("Price", 10);
    for (var h = 0; h < columns.length; h++) {
        header += padLeft(columns[h].label, columns[h].width || 10);
    }
    print("");
    print(header);
    print("  " + Array(header.length).join("─"));

    for (var i = 0; i < results.length; i++) {
        var r = results[i];
        var line = "  " + padLeft("[" + (i + 1) + "]", 5) + " " +
            padRight(truncate(r.name, 43), 45) +
            padLeft(formatPrice(r.price), 10);

        for (var c = 0; c < columns.length; c++) {
            var val = r;
            var parts = columns[c].key.split(".");
            for (var p = 0; p < parts.length; p++) {
                val = val ? val[parts[p]] : null;
            }
            var display = (val !== null && val !== undefined)
                ? (val + (columns[c].suffix || "")) : "—";
            line += padLeft(String(display), columns[c].width || 10);
        }
        print(line);
    }
    print("");
}


// ============================================================
// pick(index) — Universal selection shortcut
// validateAndSave(index, key, newStep) — Extract repeated pattern
// ============================================================

function pick(index) {
    var next = buildState.step + 1;
    if (next === 2) return stepMotherboard(index);
    if (next === 3) return stepRAM(index);
    if (next === 4) return stepGPU(index);
    if (next === 5) return stepStorage(index);
    if (next === 6) return stepCooler(index);
    if (next === 7) return stepPSU(index);
    if (next === 8) return stepCase(index);
    if (next === 9) return finalizeBuild(index);
    print("  ERROR: No active build. Start with:  stepCPU(budget, 'gaming')");
}

/**
 * Section 3: validates index, saves selection, updates spent.
 * @returns {object|null} — הרכיב שנבחר, או null אם שגיאה
 */
function validateAndSave(index, key, newStep) {
    if (buildState.step < newStep - 1) {
        print("  ERROR: Complete previous step first.");
        return null;
    }
    if (index < 1 || index > buildState.lastResults.length) {
        print("  ERROR: Pick 1–" + buildState.lastResults.length);
        return null;
    }
    var item = buildState.lastResults[index - 1];

    // Budget protection: block picks that would exceed total budget by >10%
    var totalAfter = buildState.spent + item.price;
    if (totalAfter > buildState.budget * 1.10) {
        print("  \u26d4 BLOCKED: " + item.name + " (" + formatPrice(item.price) +
            ") would bring total to " + formatPrice(totalAfter) +
            " — exceeds budget " + formatPrice(buildState.budget) + " by " +
            Math.round((totalAfter / buildState.budget - 1) * 100) + "%.");
        print("  → Pick a cheaper option.");
        return null;
    }

    buildState.selections[key] = item;
    buildState.spent += item.price;
    buildState.step = newStep;
    return item;
}


// ============================================================
// Step 1: CPU Selection
// Section 6: aggregate() with $match, $project, $sort, $limit
// ============================================================

function stepCPU(budget, usageType) {
    buildState.budget = budget;
    buildState.usage = usageType || "gaming";
    buildState.params = getProfileParams(buildState.usage);
    buildState.spent = 0;
    buildState.step = 1;
    buildState.minCosts = getMinCosts();
    buildState.selections = {
        cpu: null, motherboard: null, ram: null, gpu: null,
        storage: null, cooler: null, psu: null, pcCase: null
    };

    // Section 6: Cache tier boundaries once per build (optimization)
    buildState.tiers = {
        CPU: getTierBoundaries("CPU"),
        Motherboard: getTierBoundaries("Motherboard"),
        RAM: getTierBoundaries("RAM"),
        GPU: getTierBoundaries("GPU"),
        Storage: getTierBoundaries("Storage"),
        "CPU Cooler": getTierBoundaries("CPU Cooler"),
        PSU: getTierBoundaries("Power Supply"),
        Case: getTierBoundaries("Case")
    };
    print("  \u2139 Tier boundaries cached for smart component matching");

    // Dynamic cap: profile ratio cap, clamped by future minimums
    var reserve = futureReserve(["Motherboard", "RAM", "GPU", "Storage", "CPU Cooler", "Power Supply", "Case"]);
    var maxCpuPrice = Math.min(
        Math.round(budget * buildState.params.cpuCap),
        budget - reserve
    );

    print("");
    print("  ╔════════════════════════════════════════════════════════╗");
    print("  ║   PC Builder — " + padRight(buildState.params.name + "  $" + budget, 40) + "║");
    print("  ╚════════════════════════════════════════════════════════╝");
    print("  STEP 1/8 — CPU  (max " + formatPrice(maxCpuPrice) + ")");

    // Section 6: Aggregation Pipeline
    var results = db.components.aggregate([
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
                name: 1, price: 1, manufacturer: 1,
                "specs.socket": 1, "specs.cores": 1,
                "specs.tdp": 1, "specs.score": 1
            }
        },
        { $sort: { "specs.score": -1 } },
        { $limit: 15 }
    ]).toArray();

    buildState.lastResults = results;
    printComponentList(results, [
        { key: "specs.socket", label: "Socket", width: 12 },
        { key: "specs.cores", label: "Cores", width: 7 },
        { key: "specs.tdp", label: "TDP", width: 6, suffix: "W" },
        { key: "specs.score", label: "Score", width: 8 }
    ]);
    print("  → pick(<#>)");
    return results.length + " CPUs found";
}


// ============================================================
// Step 2: Motherboard Selection
// Section 6: $lookup (Self-Join) + $unwind + $match + $project
// ============================================================

function stepMotherboard(cpuIndex) {
    var cpu = validateAndSave(cpuIndex, "cpu", 2);
    if (!cpu) return;

    var remaining = buildState.budget - buildState.spent;
    var reserve = futureReserve(["RAM", "GPU", "Storage", "CPU Cooler", "Power Supply", "Case"]);
    // Dynamic cap: use higher of (budget*cap) or (20% of available) — prevents $1000 mobo
    var available = remaining - reserve;
    var maxPrice = Math.min(available, Math.max(
        Math.round(buildState.budget * buildState.params.moboCap),
        Math.round(available * 0.20)
    ));

    // Tier enforcement: mobo must be within ±1 tier of CPU
    var cpuTier = priceTier(cpu.price, buildState.tiers.CPU);
    buildState.buildTier = cpuTier; // Drives quality floor for ALL subsequent steps
    var tierMin = Math.max(1, cpuTier - 1);
    var tierMax = Math.min(4, cpuTier + 1);
    var tierFloor = tierToFloor(tierMin, buildState.tiers.Motherboard);

    // Quality floor: high-perf CPUs (K-series, score>1500) need quality VRMs
    var cpuScore = (cpu.specs && cpu.specs.score) || 0;
    var cpuTdp = (cpu.specs && cpu.specs.tdp) || 65;
    var minMoboPrice = tierFloor;
    if (cpuScore > 1500 || cpuTdp >= 125) {
        minMoboPrice = Math.max(minMoboPrice, Math.min(120, maxPrice));
    }

    print("\n  ✓ CPU: " + cpu.name + " (" + formatPrice(cpu.price) + ")");
    print("  ℹ Smart Logic: CPU is Tier " + TIER_NAMES[cpuTier] +
        ". Filtering Motherboards for Tier " + TIER_NAMES[tierMin] + "–" + TIER_NAMES[tierMax] + "...");
    print("  STEP 2/8 — Motherboard  (Socket: " + cpu.specs.socket +
        ", min " + formatPrice(minMoboPrice) + " (Tier " + TIER_NAMES[tierMin] + "+)" +
        ", max " + formatPrice(maxPrice) + ")");

    // Section 6: $lookup Self-Join — CPU → Motherboard by socket
    // מוצאים לוחות-אם תואמים לפי socket דרך Self-Join על אותה קולקציה
    var results = db.components.aggregate([
        // Stage 1: Match the selected CPU
        { $match: { _id: cpu._id } },

        // Stage 2: $lookup Self-Join — find components with matching socket
        {
            $lookup: {
                from: "components",
                localField: "requirements.socket_match",
                foreignField: "specs.socket",
                as: "socket_matches"
            }
        },

        // Stage 3: $unwind — flatten matched array
        { $unwind: "$socket_matches" },

        // Stage 4: $match — keep only Motherboards within budget + quality floor
        // גם מחייב specs.ram_type — בלי זה שלב ה-RAM לא יכול לסנן DDR4/DDR5 נכון
        {
            $match: {
                "socket_matches.type": "Motherboard",
                "socket_matches.price": { $type: "number", $gte: minMoboPrice, $lte: maxPrice },
                "socket_matches.specs.ram_type": { $exists: true, $nin: [null, ""] }
            }
        },

        // Stage 5: $project — reshape to standard component format
        {
            $project: {
                _id: "$socket_matches._id",
                name: "$socket_matches.name",
                price: "$socket_matches.price",
                manufacturer: "$socket_matches.manufacturer",
                specs: "$socket_matches.specs"
            }
        },

        // Stage 6-7: $sort + $limit — value first (ASC), wide range
        { $sort: { price: 1 } },
        { $limit: 30 }
    ]).toArray();

    // Tier fallback: if tier-filtered Self-Join returned nothing, drop tier and try basic
    if (results.length === 0) {
        if (minMoboPrice > 0) {
            print("  ⚠ Budget too low for Tier " + TIER_NAMES[tierMin] + " motherboard — reverting to basic compatibility...");
        }
        results = db.components.find({
            type: "Motherboard",
            "specs.socket": cpu.specs.socket,
            "specs.ram_type": { $exists: true, $nin: [null, ""] },
            price: { $type: "number", $lte: remaining }
        }).sort({ price: 1 }).limit(15).toArray();
    }
    // Last resort: if still nothing (budget too tight), show cheapest available
    if (results.length === 0) {
        print("  \u26a0 No motherboards in budget \u2014 showing cheapest:");
        results = db.components.find({
            type: "Motherboard",
            "specs.socket": cpu.specs.socket,
            "specs.ram_type": { $exists: true, $nin: [null, ""] },
            price: { $type: "number" }
        }).sort({ price: 1 }).limit(10).toArray();
    }

    buildState.lastResults = results;
    printComponentList(results, [
        { key: "specs.form_factor", label: "Form", width: 14 },
        { key: "specs.ram_type", label: "RAM", width: 7 },
        { key: "specs.max_ram", label: "MaxRAM", width: 8, suffix: "GB" }
    ]);
    print("  → pick(<#>)");
    return results.length + " motherboards found";
}


// ============================================================
// Step 3: RAM Selection
// Section 4: find().sort().limit() — filtered by DDR type
// ============================================================

function stepRAM(moboIndex) {
    var mobo = validateAndSave(moboIndex, "motherboard", 3);
    if (!mobo) return;

    var remaining = buildState.budget - buildState.spent;
    var reserve = futureReserve(["GPU", "Storage", "CPU Cooler", "Power Supply", "Case"]);
    // Dynamic cap: use higher of (budget*cap) or (25% of available)
    var available = remaining - reserve;
    var maxPrice = Math.min(available, Math.max(
        Math.round(buildState.budget * buildState.params.ramCap),
        Math.round(available * 0.25)
    ));

    // Smart DDR type inference: specs.ram_type > board name > socket > default
    var ramType = (mobo.specs && mobo.specs.ram_type) ? mobo.specs.ram_type : null;
    if (!ramType) {
        var boardName = (mobo.name || "").toUpperCase();
        var cpuSocket = (buildState.selections.cpu.specs && buildState.selections.cpu.specs.socket) || "";
        if (boardName.indexOf("DDR4") >= 0 || boardName.indexOf("D4") >= 0) {
            ramType = "DDR4";
        } else if (boardName.indexOf("DDR5") >= 0 || boardName.indexOf("D5") >= 0) {
            ramType = "DDR5";
        } else if (cpuSocket === "AM5" || cpuSocket === "LGA1851") {
            ramType = "DDR5"; // AM5 and LGA1851 are DDR5-only platforms
        } else if (cpuSocket === "AM4" || cpuSocket === "LGA1200") {
            ramType = "DDR4"; // AM4 and LGA1200 are DDR4-only platforms
        } else if (cpuSocket === "LGA1700") {
            // LGA1700: DDR4 boards always say "DDR4" in name. If it doesn't, it's DDR5.
            ramType = "DDR5";
        } else {
            ramType = "DDR4"; // safe default for older platforms
        }
    }
    var minRam = buildState.params.minRamGb;
    // RAM cap: profile max (gaming=32GB) + mobo physical max
    var profileMaxRam = buildState.params.maxRamGb || 64;
    var moboMaxRam = (mobo.specs && mobo.specs.max_ram) ? mobo.specs.max_ram : 128;
    var maxRamGb = Math.min(profileMaxRam, moboMaxRam);

    // Build-tier quality floor: high-budget builds get quality RAM
    var ramMinTier = Math.max(1, (buildState.buildTier || 1) - 1);
    var ramTierFloor = tierToFloor(ramMinTier, buildState.tiers.RAM);

    print("\n  \u2713 Mobo: " + mobo.name + " (" + formatPrice(mobo.price) + ")");
    print("  \u2139 Info: Limit set to " + maxRamGb + "GB (" + buildState.params.name + " profile) even though Mobo supports " + moboMaxRam + "GB.");
    if (ramTierFloor > 0) {
        print("  \u2139 Build Quality: Tier " + TIER_NAMES[buildState.buildTier] + " build \u2192 RAM min " + formatPrice(ramTierFloor));
    }
    print("  STEP 3/8 \u2014 RAM  (" + ramType + ", " + minRam + "\u2013" + maxRamGb + "GB" +
        ", max " + formatPrice(maxPrice) + ")");

    var results = db.components.find({
        type: "RAM",
        "specs.generation": ramType,
        "specs.capacity_gb": { $gte: minRam, $lte: maxRamGb },
        // Filter: min speed 3000MHz DDR4 / 4800MHz DDR5 — excludes slow server surplus
        "specs.speed_mhz": { $gte: (ramType === "DDR5") ? 4800 : 3000 },
        price: { $type: "number", $gte: ramTierFloor, $lte: maxPrice }
    }).sort({ "specs.capacity_gb": -1, price: 1 }).limit(30).toArray();

    // Section 3: JS filter — exclude ECC/Registered server RAM (won't boot on consumer boards)
    results = results.filter(function (r) {
        var n = (r.name || "").toUpperCase();
        return n.indexOf("ECC") < 0 && n.indexOf("RDIMM") < 0 && n.indexOf("LRDIMM") < 0
            && n.indexOf("REG ") < 0 && n.indexOf("REGISTERED") < 0;
    }).slice(0, 15);

    // Fallback: any consumer RAM of correct type (drop speed requirement)
    if (results.length === 0) {
        results = db.components.find({
            type: "RAM", "specs.generation": ramType,
            price: { $type: "number" }
        }).sort({ price: 1 }).limit(30).toArray().filter(function (r) {
            var n = (r.name || "").toUpperCase();
            return n.indexOf("ECC") < 0 && n.indexOf("RDIMM") < 0 && n.indexOf("LRDIMM") < 0;
        }).slice(0, 10);
    }

    buildState.lastResults = results;
    printComponentList(results, [
        { key: "specs.capacity_gb", label: "Size", width: 8, suffix: "GB" },
        { key: "specs.speed_mhz", label: "Speed", width: 9, suffix: "MHz" },
        { key: "specs.generation", label: "Gen", width: 6 }
    ]);
    print("  → pick(<#>)");
    return results.length + " RAM kits found";
}


// ============================================================
// Step 4: GPU Selection
// Section 4: find().sort().limit() — best score in budget
// ============================================================

function stepGPU(ramIndex) {
    var ram = validateAndSave(ramIndex, "ram", 4);
    if (!ram) return;

    var remaining = buildState.budget - buildState.spent;
    var reserve = futureReserve(["Storage", "CPU Cooler", "Power Supply", "Case"]);
    var available = remaining - reserve;
    // Surplus-aware GPU cap: if CPU+Mobo+RAM came in under budget, GPU absorbs 70% of savings
    // The other 30% stays as safety buffer for Storage/PSU/Case ("Surplus Tax")
    var expectedPriorSpend = buildState.budget * (
        buildState.params.cpuCap + buildState.params.moboCap + buildState.params.ramCap);
    var rawSurplus = Math.max(0, Math.round(expectedPriorSpend - buildState.spent));
    var surplus = Math.round(rawSurplus * 0.70);
    var baseCap = Math.round(buildState.budget * buildState.params.gpuCap);
    var dynamicCap = baseCap + surplus;
    var maxPrice = Math.min(available, dynamicCap);
    if (rawSurplus > 0) {
        print("  \u2139 Surplus detected: prior steps saved $" + rawSurplus +
            " (70% \u2192 GPU, 30% \u2192 reserve) \u2192 GPU cap: " + formatPrice(baseCap) + " \u2192 " + formatPrice(dynamicCap));
    }

    // Relevance filter: score >= 1000 blocks ancient cards (GT 730, FirePro 2014)
    var gpuMinScore = 1000;

    print("\n  ✓ RAM: " + ram.name + " (" + formatPrice(ram.price) + ")");
    print("  ℹ Relevance filter: blocking GPUs with score < " + gpuMinScore + " (pre-2018)");
    print("  STEP 4/8 — GPU  (max " + formatPrice(maxPrice) + ", sorted by score)");

    var results = db.components.find({
        type: "GPU",
        price: { $type: "number", $lte: maxPrice },
        "specs.score": { $type: "number", $gte: gpuMinScore },
        "specs.length_mm": { $type: "number", $gt: 0 }  // חובה — בלי זה שלב המארז לא יכול לבדוק התאמה
    }).sort({ "specs.score": -1, price: 1 }).limit(15).toArray();

    // Fallback 1: drop score minimum but keep budget
    if (results.length === 0) {
        print("  ⚠ No modern GPUs in budget — showing all available:");
        results = db.components.find({
            type: "GPU",
            price: { $type: "number", $lte: maxPrice },
            "specs.score": { $type: "number" },
            "specs.length_mm": { $type: "number", $gt: 0 }
        }).sort({ "specs.score": -1, price: 1 }).limit(15).toArray();
    }

    // Fallback 2: cheapest GPUs with known length (over budget)
    if (results.length === 0) {
        print("  ⚠ No GPUs in budget — showing cheapest:");
        results = db.components.find({
            type: "GPU", price: { $type: "number" },
            "specs.length_mm": { $type: "number", $gt: 0 }
        }).sort({ price: 1 }).limit(10).toArray();
    }

    buildState.lastResults = results;
    printComponentList(results, [
        { key: "specs.vram", label: "VRAM", width: 7, suffix: "GB" },
        { key: "specs.length_mm", label: "Length", width: 8, suffix: "mm" },
        { key: "specs.score", label: "Score", width: 8 }
    ]);
    print("  → pick(<#>)");
    return results.length + " GPUs found";
}


// ============================================================
// Step 5: Storage Selection
// Section 4: find().sort().limit()
// ============================================================

function stepStorage(gpuIndex) {
    var gpu = validateAndSave(gpuIndex, "gpu", 5);
    if (!gpu) return;

    var remaining = buildState.budget - buildState.spent;
    var reserve = futureReserve(["CPU Cooler", "Power Supply", "Case"]);
    // Dynamic cap: use higher of (budget*cap) or (35% of available)
    var available = remaining - reserve;
    var maxPrice = Math.min(available, Math.max(
        Math.round(buildState.budget * buildState.params.storageCap),
        Math.round(available * 0.35)
    ));

    // Build-tier quality floor for storage
    var storageTierFloor = tierToFloor(Math.max(1, (buildState.buildTier || 1) - 1), buildState.tiers.Storage);

    print("\n  \u2713 GPU: " + gpu.name + " (" + formatPrice(gpu.price) + ")");
    if (storageTierFloor > 0) {
        print("  \u2139 Build Quality: Tier " + TIER_NAMES[buildState.buildTier] + " build \u2192 Storage min " + formatPrice(storageTierFloor));
    }
    print("  STEP 5/8 \u2014 Storage  (max " + formatPrice(maxPrice) + ")");

    // SSD only \u2014 HDDs are unacceptable as primary storage
    var minStorage = buildState.params.minStorageGb || 240;

    var results = db.components.find({
        type: "Storage",
        price: { $type: "number", $gte: storageTierFloor, $lte: maxPrice },
        "specs.capacity_gb": { $gte: minStorage, $lte: buildState.params.maxStorageGb },
        "specs.storage_type": { $in: ["SSD", "Hybrid", "260 SSD", "M.2", "NVMe"] }
    }).sort({ "specs.capacity_gb": -1, price: 1 }).limit(15).toArray();

    // Fallback: any SSD (drop capacity minimum)
    if (results.length === 0) {
        results = db.components.find({
            type: "Storage", price: { $type: "number", $lte: maxPrice },
            "specs.storage_type": { $in: ["SSD", "Hybrid", "260 SSD", "M.2", "NVMe"] }
        }).sort({ "specs.capacity_gb": -1, price: 1 }).limit(10).toArray();
    }

    // Last resort: any storage if no SSDs at all
    if (results.length === 0) {
        results = db.components.find({
            type: "Storage", price: { $type: "number", $lte: maxPrice }
        }).sort({ price: 1 }).limit(10).toArray();
    }

    buildState.lastResults = results;
    printComponentList(results, [
        { key: "specs.capacity_gb", label: "Size", width: 9, suffix: "GB" },
        { key: "specs.storage_type", label: "Type", width: 9 }
    ]);
    print("  → pick(<#>)");
    return results.length + " drives found";
}


// ============================================================
// Step 6: CPU Cooler Selection
// Section 4: find().sort().limit() — TDP-aware minimum
// ============================================================

function stepCooler(storageIndex) {
    var storage = validateAndSave(storageIndex, "storage", 6);
    if (!storage) return;

    var remaining = buildState.budget - buildState.spent;
    var reserve = futureReserve(["Power Supply", "Case"]);
    var maxPrice = remaining - reserve;
    // Cap: cooler is support — never more than coolerCap% of budget
    var coolerCap = buildState.params.coolerCap || 0.08;
    maxPrice = Math.min(maxPrice, Math.round(buildState.budget * coolerCap));

    var cpuTdp = (buildState.selections.cpu.specs && buildState.selections.cpu.specs.tdp) || 65;
    var cpuScore = (buildState.selections.cpu.specs && buildState.selections.cpu.specs.score) || 0;
    var minPrice = getCoolerReserve(cpuTdp, cpuScore);
    // Build-tier quality floor: high-budget builds get quality coolers
    var coolerTierFloor = tierToFloor(Math.max(1, (buildState.buildTier || 1) - 1), buildState.tiers["CPU Cooler"]);
    minPrice = Math.max(minPrice, coolerTierFloor);
    // Cooler size limit: Micro ATX/Mini ITX cases support max 240mm radiator
    var moboForm = (buildState.selections.motherboard.specs && buildState.selections.motherboard.specs.form_factor) || "ATX";
    var mf = moboForm.toLowerCase();
    var smallCase = (mf.indexOf("micro") >= 0 || mf.indexOf("mini") >= 0);

    print("\n  ✓ Storage: " + storage.name + " (" + formatPrice(storage.price) + ")");
    print("  STEP 6/8 — Cooler  (min " + formatPrice(minPrice) + ", max " + formatPrice(maxPrice) + " for " + cpuTdp + "W" +
        (cpuScore > 1500 ? " ★ High-perf CPU" : "") +
        (smallCase ? " | max 240mm radiator" : "") + ")");

    var results = db.components.find({
        type: "CPU Cooler",
        price: { $type: "number", $gte: minPrice, $lte: maxPrice }
    }).sort({ price: 1 }).limit(30).toArray();

    // Compatibility: filter oversized liquid coolers for small cases
    // MicroATX/Mini ITX cases support max 240mm radiator — block 280/360/420mm
    if (smallCase) {
        results = results.filter(function (c) {
            var n = (c.name || "").toLowerCase();
            var isLiquid = (n.indexOf("liquid") >= 0 || n.indexOf("aio") >= 0 ||
                (c.specs && c.specs.kind && c.specs.kind.toLowerCase().indexOf("liquid") >= 0));
            if (!isLiquid) return true; // air coolers are fine
            // Block radiators > 240mm (280, 360, 420)
            if (n.indexOf("280") >= 0 || n.indexOf("360") >= 0 || n.indexOf("420") >= 0) {
                return false;
            }
            return true;
        });
    }

    // Quality filter: block low-profile coolers for high-TDP CPUs
    // Low-profile coolers (e.g. NT06-PRO, Silvretta) can't handle 125W+ CPUs
    var effectiveTdp = cpuTdp;
    if (cpuScore > 1500 && effectiveTdp < 150) effectiveTdp = 150;
    if (effectiveTdp >= 125) {
        results = results.filter(function (c) {
            var n = (c.name || "").toLowerCase();
            var kind = (c.specs && c.specs.kind) ? c.specs.kind.toLowerCase() : "";
            // Block low-profile / slim / HTPC coolers for demanding CPUs
            if (kind.indexOf("low") >= 0 || kind.indexOf("slim") >= 0) return false;
            if (n.indexOf("low profile") >= 0 || n.indexOf("low-profile") >= 0 ||
                n.indexOf("slim") >= 0 || n.indexOf("silvretta") >= 0 ||
                n.indexOf("nt06") >= 0 || n.indexOf("axp-") >= 0 ||
                n.indexOf("c7 ") >= 0 || n.indexOf("is-") >= 0) return false;
            return true;
        });
    }
    results = results.slice(0, 15);

    // Fallback: still enforce minPrice — never show coolers that can't handle the CPU
    if (results.length === 0) {
        print("  ⚠ No coolers in budget — showing cheapest adequate:");
        results = db.components.find({
            type: "CPU Cooler", price: { $type: "number", $gte: minPrice }
        }).sort({ price: 1 }).limit(10).toArray();
    }

    buildState.lastResults = results;
    printComponentList(results, [
        { key: "specs.kind", label: "Type", width: 8 },
        { key: "specs.noise_level_db", label: "dB", width: 7 }
    ]);
    print("  → pick(<#>)");
    return results.length + " coolers found";
}


// ============================================================
// Step 7: PSU Selection
// Section 3: calculateRequiredWatts()
// Section 4: find().sort().limit()
// ============================================================

function stepPSU(coolerIndex) {
    var cooler = validateAndSave(coolerIndex, "cooler", 7);
    if (!cooler) return;

    var remaining = buildState.budget - buildState.spent;
    var reserve = futureReserve(["Case"]);
    var maxPrice = remaining - reserve;
    var cpuTdp = (buildState.selections.cpu.specs && buildState.selections.cpu.specs.tdp) || 65;
    var cpuScore = (buildState.selections.cpu.specs && buildState.selections.cpu.specs.score) || 0;
    var gpuVram = (buildState.selections.gpu.specs && buildState.selections.gpu.specs.vram) || 8;
    var requiredWatts = calculateRequiredWatts(cpuTdp, gpuVram, cpuScore);

    // Tier enforcement: PSU must be within ±1 tier of GPU
    var gpuPrice = (buildState.selections.gpu && buildState.selections.gpu.price) || 0;
    var gpuTier = priceTier(gpuPrice, buildState.tiers.GPU);
    var psuTierMin = Math.max(1, gpuTier - 1);
    var psuBounds = buildState.tiers.PSU;
    var psuTierFloor = tierToFloor(psuTierMin, psuBounds);
    // Also enforce build-tier quality floor
    psuTierFloor = Math.max(psuTierFloor, tierToFloor(Math.max(1, (buildState.buildTier || 1) - 1), psuBounds));
    var minPsuPrice = psuTierFloor;

    print("\n  ✓ Cooler: " + cooler.name + " (" + formatPrice(cooler.price) + ")");
    print("  ℹ Smart Logic: GPU is Tier " + TIER_NAMES[gpuTier] +
        ". PSU must be Tier " + TIER_NAMES[psuTierMin] + "+...");
    print("  STEP 7/8 — PSU  (min " + requiredWatts + "W" +
        (minPsuPrice > 0 ? ", min " + formatPrice(minPsuPrice) + " (Tier match)" : "") +
        ", max " + formatPrice(maxPrice) + ")");

    var results = db.components.find({
        type: "Power Supply",
        price: { $type: "number", $gte: minPsuPrice, $lte: maxPrice },
        "specs.wattage": { $gte: requiredWatts }
    }).sort({ price: 1 }).limit(20).toArray();

    // Tier fallback: if tier filter is too strict, drop it
    if (results.length === 0 && minPsuPrice > 0) {
        print("  ⚠ Budget too low for Tier " + TIER_NAMES[psuTierMin] + " PSU — reverting to basic compatibility...");
        results = db.components.find({
            type: "Power Supply",
            price: { $type: "number", $lte: maxPrice },
            "specs.wattage": { $gte: requiredWatts }
        }).sort({ price: 1 }).limit(20).toArray();
    }

    if (results.length === 0) {
        print("  ⚠ No PSU at " + requiredWatts + "W in budget — cheapest:");
        results = db.components.find({
            type: "Power Supply", price: { $type: "number" },
            "specs.wattage": { $gte: requiredWatts }
        }).sort({ price: 1 }).limit(10).toArray();
    }

    buildState.lastResults = results;
    printComponentList(results, [
        { key: "specs.wattage", label: "Watts", width: 8, suffix: "W" },
        { key: "specs.efficiency", label: "Rating", width: 12 }
    ]);
    print("  → pick(<#>)");
    return results.length + " PSUs found";
}


// ============================================================
// Step 8: Case Selection
// Section 6: aggregate() + $project with $subtract
// ============================================================

function stepCase(psuIndex) {
    var psu = validateAndSave(psuIndex, "psu", 8);
    if (!psu) return;

    var remaining = buildState.budget - buildState.spent;
    var gpuLength = (buildState.selections.gpu.specs && buildState.selections.gpu.specs.length_mm) || 0;
    var moboForm = (buildState.selections.motherboard.specs && buildState.selections.motherboard.specs.form_factor) || "ATX";

    print("\n  ✓ PSU: " + psu.name + " (" + formatPrice(psu.price) + ")");
    print("  STEP 8/8 — Case  (fits " + gpuLength + "mm GPU + " + moboForm + " mobo, max " + formatPrice(remaining) + ")");

    // Section 6: Aggregation with $subtract for GPU clearance
    var results = db.components.aggregate([
        {
            $match: {
                type: "Case",
                price: { $type: "number", $gte: tierToFloor(Math.max(1, (buildState.buildTier || 1) - 1), buildState.tiers.Case), $lte: remaining },
                "specs.max_gpu_length": { $gte: gpuLength }
            }
        },
        {
            $project: {
                name: 1, price: 1,
                "specs.form_factor": 1,
                "specs.max_gpu_length": 1,
                gpu_clearance: { $subtract: ["$specs.max_gpu_length", gpuLength] }
            }
        },
        { $sort: { price: 1 } },
        { $limit: 30 }
    ]).toArray();

    // Section 3: Filter by form factor compatibility (JS function)
    // מסנן מארזים שלא מתאימים ללוח-האם שנבחר
    results = results.filter(function (c) {
        var cf = (c.specs && c.specs.form_factor) || "";
        return caseSupportsMotherboard(cf, moboForm);
    });

    if (results.length === 0) {
        // Fallback 1: over-budget but MUST fit GPU + mobo form factor
        results = db.components.find({
            type: "Case", price: { $type: "number" },
            "specs.max_gpu_length": { $gte: gpuLength }
        }).sort({ price: 1 }).limit(30).toArray().filter(function (c) {
            var cf = (c.specs && c.specs.form_factor) || "";
            return caseSupportsMotherboard(cf, moboForm);
        });
    }

    if (results.length === 0 && gpuLength > 0) {
        // Fallback 2: relax GPU length by 15mm (tight fit warning)
        // 353mm GPU in 350mm case = 3mm tight, usually still works
        print("  ⚠ No exact fit — showing cases within 15mm tolerance:");
        results = db.components.find({
            type: "Case", price: { $type: "number" },
            "specs.max_gpu_length": { $gte: gpuLength - 15 }
        }).sort({ "specs.max_gpu_length": -1, price: 1 }).limit(30).toArray().filter(function (c) {
            var cf = (c.specs && c.specs.form_factor) || "";
            return caseSupportsMotherboard(cf, moboForm);
        });
    }

    if (results.length === 0) {
        // Fallback 3: any case with best GPU clearance, compatible form factor
        print("  ⚠ No cases near GPU length — showing best available:");
        results = db.components.find({
            type: "Case", price: { $type: "number" },
            "specs.max_gpu_length": { $type: "number" }
        }).sort({ "specs.max_gpu_length": -1 }).limit(40).toArray().filter(function (c) {
            var cf = (c.specs && c.specs.form_factor) || "";
            return caseSupportsMotherboard(cf, moboForm);
        }).slice(0, 15);
    }

    buildState.lastResults = results;
    printComponentList(results, [
        { key: "specs.form_factor", label: "Form", width: 22 },
        { key: "specs.max_gpu_length", label: "MaxGPU", width: 9, suffix: "mm" },
        { key: "gpu_clearance", label: "Clear.", width: 9, suffix: "mm" }
    ]);
    print("  → pick(<#>) to finalize!");
    return results.length + " cases found";
}


// ============================================================
// Step 9: Finalize Build
// Section 3: calculateWeightedScore()
// Section 4: insertOne()
// Section 6: aggregate with $add + $out
// ============================================================

function finalizeBuild(caseIndex) {
    var pcCase = validateAndSave(caseIndex, "pcCase", 9);
    if (!pcCase) return;

    var sel = buildState.selections;
    var totalPrice = Math.round((sel.cpu.price + sel.motherboard.price +
        sel.ram.price + sel.gpu.price + sel.storage.price +
        sel.cooler.price + sel.psu.price + sel.pcCase.price) * 100) / 100;

    // Section 3: calculateWeightedScore
    var cpuScore = (sel.cpu.specs && sel.cpu.specs.score) || 0;
    var gpuScore = (sel.gpu.specs && sel.gpu.specs.score) || 0;
    var ramCap = (sel.ram.specs && sel.ram.specs.capacity_gb) || 0;
    var weightedScore = calculateWeightedScore(
        cpuScore, gpuScore, ramCap, buildState.params.scoringWeights
    );

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
        price_breakdown: {
            cpu: sel.cpu.price,
            motherboard: sel.motherboard.price,
            ram: sel.ram.price,
            gpu: sel.gpu.price,
            storage: sel.storage.price,
            cooler: sel.cooler.price,
            psu: sel.psu.price,
            case_price: sel.pcCase.price
        },
        compatibility_details: {
            cpu_socket: sel.cpu.specs.socket,
            motherboard_socket: sel.motherboard.specs.socket,
            ram_type_required: sel.motherboard.specs.ram_type,
            ram_type_selected: sel.ram.specs ? sel.ram.specs.generation : "unknown",
            ram_capacity_gb: ramCap,
            gpu_length_mm: (sel.gpu.specs && sel.gpu.specs.length_mm) || 0,
            case_max_gpu_length_mm: (sel.pcCase.specs && sel.pcCase.specs.max_gpu_length) || 0,
            required_watts: calculateRequiredWatts(sel.cpu.specs.tdp || 65, sel.gpu.specs.vram || 8),
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

    // Section 4: insertOne — שמירת הבנייה לקולקציה
    db.recommended_combos.drop();
    db.recommended_combos.insertOne(completeBuild);

    // Section 6: $add + $out — מחשב computed_total ומחליף את הקולקציה בגרסה המלאה
    // $add סוכם את כל מחירי הרכיבים (אימות עצמאי של total_price)
    // $out מחליף את הקולקציה בשלמותה עם השדה המחושב
    db.recommended_combos.aggregate([
        { $match: { build_method: "interactive" } },
        {
            $project: {
                build_name: 1,
                usage_type: 1,
                build_method: 1,
                target_budget: 1,
                components: 1,
                price_breakdown: 1,
                compatibility_details: 1,
                performance_metrics: 1,
                total_price: 1,
                // Section 6: $add — MongoDB מחשב את הסכום בעצמו (אימות עצמאי)
                computed_total: {
                    $add: [
                        "$price_breakdown.cpu",
                        "$price_breakdown.motherboard",
                        "$price_breakdown.ram",
                        "$price_breakdown.gpu",
                        "$price_breakdown.storage",
                        "$price_breakdown.cooler",
                        "$price_breakdown.psu",
                        "$price_breakdown.case_price"
                    ]
                },
                generated_at: 1
            }
        },
        // Section 6: $out — שומר ישירות ל-recommended_combos עם computed_total
        { $out: "recommended_combos" }
    ]);

    // --- Print Final Summary ---
    var overBudget = totalPrice > buildState.budget;
    var pct = Math.round(((totalPrice / buildState.budget) - 1) * 100);

    print("");
    print("  ╔════════════════════════════════════════════════════════════════╗");
    if (overBudget) {
        print("  ║   BUILD COMPLETE   (" + pct + "% over budget)                        ║");
    } else {
        print("  ║   BUILD COMPLETE   ✓                                         ║");
    }
    print("  ╠════════════════════════════════════════════════════════════════╣");
    print("  ║  " + padRight("CPU:     " + truncate(sel.cpu.name, 42), 51) + padLeft(formatPrice(sel.cpu.price), 10) + "  ║");
    print("  ║  " + padRight("Mobo:    " + truncate(sel.motherboard.name, 42), 51) + padLeft(formatPrice(sel.motherboard.price), 10) + "  ║");
    print("  ║  " + padRight("RAM:     " + truncate(sel.ram.name, 42), 51) + padLeft(formatPrice(sel.ram.price), 10) + "  ║");
    print("  ║  " + padRight("GPU:     " + truncate(sel.gpu.name, 42), 51) + padLeft(formatPrice(sel.gpu.price), 10) + "  ║");
    print("  ║  " + padRight("Storage: " + truncate(sel.storage.name, 42), 51) + padLeft(formatPrice(sel.storage.price), 10) + "  ║");
    print("  ║  " + padRight("Cooler:  " + truncate(sel.cooler.name, 42), 51) + padLeft(formatPrice(sel.cooler.price), 10) + "  ║");
    print("  ║  " + padRight("PSU:     " + truncate(sel.psu.name, 42), 51) + padLeft(formatPrice(sel.psu.price), 10) + "  ║");
    print("  ║  " + padRight("Case:    " + truncate(sel.pcCase.name, 42), 51) + padLeft(formatPrice(sel.pcCase.price), 10) + "  ║");
    print("  ╠════════════════════════════════════════════════════════════════╣");
    print("  ║  " + padRight("TOTAL:", 51) + padLeft(formatPrice(totalPrice), 10) + "  ║");
    print("  ║  " + padRight("Budget:", 51) + padLeft(formatPrice(buildState.budget), 10) + "  ║");
    print("  ║  " + padRight("Score:", 51) + padLeft(String(weightedScore), 10) + "  ║");
    print("  ╚════════════════════════════════════════════════════════════════╝");

    if (overBudget) {
        print("\n  ⚠ Over budget by " + pct + "%. Consider cheaper options.");
    }
    print("\n  ✓ Saved to 'recommended_combos' ($add + $out)");
    print("  → stepCPU(budget, 'usage') for a new build\n");

    buildState.step = 0;
    return completeBuild;
}


// ============================================================
// Pipeline #2 — Market Analysis (Section 6)
// $match, $group ($sum, $avg, $min, $max), $project ($round, $multiply), $sort
// ============================================================

function section6_marketAnalysis() {
    print("\n  ── Market Analysis ──");

    var results = db.components.aggregate([
        { $match: { price: { $type: "number", $gt: 0 } } },
        {
            $group: {
                _id: "$type",
                count: { $sum: 1 },
                avg_price: { $avg: "$price" },
                min_price: { $min: "$price" },
                max_price: { $max: "$price" }
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
                // Section 6: $multiply — estimated total market value
                est_market_value: { $round: [{ $multiply: ["$count", "$avg_price"] }, 2] }
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
// $match, $group ($sum, $push, $first), $sort, $limit
// ============================================================

function section6_manufacturerBreakdown() {
    print("\n  ── Manufacturer Breakdown ──");

    var results = db.components.aggregate([
        { $match: { manufacturer: { $exists: true, $ne: null }, price: { $type: "number", $gt: 0 } } },
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
    }
    print("");
    return results;
}


// ============================================================
// Help
// ============================================================

function pcBuilderHelp() {
    print("\n  PC Builder Commands:");
    print("    stepCPU(budget, usage)  Start (usage: gaming/workstation/budget/enthusiast)");
    print("    pick(#)                Select from list → auto-next step");
    print("    pcBuilderHelp()        This help");
    print("\n  Analysis:");
    print("    section6_marketAnalysis()         Statistics by type");
    print("    section6_manufacturerBreakdown()  Products per maker");
    print("    section6_highValueComponents()    Best score-per-dollar");
    print("\n  Order: CPU → Mobo → RAM → GPU → Storage → Cooler → PSU → Case → Done!\n");
}


// ============================================================
// Load Message
// ============================================================

print("");
print("  ╔════════════════════════════════════════════════════╗");
print("  ║  ✓ Interactive PC Builder loaded!                  ║");
print("  ║    pcBuilderHelp()           Full command list     ║");
print("  ║    stepCPU(1500, 'gaming')   Start building!       ║");
print("  ╚════════════════════════════════════════════════════╝");
print("");

// ============================================================
// Section 7 helpers — Auto-Builder (used by MapReduce)
// Generates sample builds across a budget range for MapReduce
// ============================================================

function autoBuilderPipeline(maxBudget, buildNameLiteral, usageType) {
    var usage = (usageType || "gaming").toLowerCase();
    var cpuBudgetRatio = (usage === "workstation") ? 0.40 : (usage === "budget") ? 0.30 : 0.25;
    var minRamGb = (usage === "workstation") ? 32 : 16;
    var maxCpuPrice = maxBudget * cpuBudgetRatio;
    return [
        {
            $match: {
                type: "CPU", price: { $type: "number", $lte: maxCpuPrice },
                "specs.score": { $type: "number" }, "requirements.socket_match": { $exists: true, $ne: null }
            }
        },
        { $sort: { "specs.score": -1, price: 1 } }, { $limit: 10 },
        {
            $lookup: {
                from: "components", let: { s: "$requirements.socket_match" },
                pipeline: [{
                    $match: {
                        type: "Motherboard", price: { $type: "number" },
                        $expr: { $eq: ["$specs.socket", "$$s"] }
                    }
                }, { $sort: { price: 1 } }, { $limit: 1 }], as: "mobo"
            }
        },
        { $unwind: "$mobo" },
        {
            $addFields: {
                required_ram_type: {
                    $ifNull: ["$mobo.specs.ram_type",
                        {
                            $switch: {
                                branches: [
                                    { case: { $in: ["$mobo.specs.socket", ["AM5", "LGA1851"]] }, then: "DDR5" },
                                    { case: { $in: ["$mobo.specs.socket", ["AM4", "LGA1200", "LGA1151"]] }, then: "DDR4" }
                                ], default: "DDR4"
                            }
                        }]
                }
            }
        },
        {
            $lookup: {
                from: "components", let: { rt: "$required_ram_type" },
                pipeline: [{
                    $match: {
                        type: "RAM", price: { $type: "number" },
                        "specs.capacity_gb": { $type: "number", $gte: minRamGb },
                        $expr: { $eq: ["$specs.generation", "$$rt"] }
                    }
                }, { $sort: { price: 1 } }, { $limit: 1 }], as: "ram"
            }
        },
        { $unwind: "$ram" },
        {
            $addFields: {
                base_cost: { $add: ["$price", "$mobo.price", "$ram.price"] },
                remaining_budget: { $subtract: [maxBudget, { $add: ["$price", "$mobo.price", "$ram.price"] }] }
            }
        },
        {
            $lookup: {
                from: "components", let: { ml: "$remaining_budget" },
                pipeline: [{
                    $match: {
                        type: "GPU", price: { $type: "number" }, "specs.score": { $type: "number" },
                        "specs.length_mm": { $type: "number" }, $expr: { $lte: ["$price", "$$ml"] }
                    }
                },
                { $sort: { "specs.score": -1, price: 1 } }, { $limit: 5 }], as: "gpu"
            }
        },
        { $unwind: "$gpu" },
        {
            $lookup: {
                from: "components", pipeline: [{ $match: { type: "CPU Cooler", price: { $type: "number" } } },
                { $sort: { price: 1 } }, { $limit: 1 }], as: "cooler"
            }
        }, { $unwind: "$cooler" },
        {
            $lookup: {
                from: "components", let: { gl: "$gpu.specs.length_mm" },
                pipeline: [{
                    $match: {
                        type: "Case", price: { $type: "number" },
                        "specs.max_gpu_length": { $type: "number" }, $expr: { $gte: ["$specs.max_gpu_length", "$$gl"] }
                    }
                },
                { $sort: { price: 1 } }, { $limit: 1 }], as: "pc_case"
            }
        }, { $unwind: "$pc_case" },
        {
            $addFields: {
                estimated_required_watts: {
                    $add: [
                        { $ifNull: ["$specs.tdp", 65] }, { $multiply: [{ $ifNull: ["$gpu.specs.vram", 8] }, 20] }, 200]
                }
            }
        },
        {
            $lookup: {
                from: "components", let: { rw: "$estimated_required_watts" },
                pipeline: [{
                    $match: {
                        type: "Power Supply", price: { $type: "number" },
                        "specs.wattage": { $type: "number" }, $expr: { $gte: ["$specs.wattage", "$$rw"] }
                    }
                },
                { $sort: { price: 1 } }, { $limit: 1 }], as: "psu"
            }
        }, { $unwind: "$psu" },
        {
            $lookup: {
                from: "components", pipeline: [{
                    $match: {
                        type: "Storage", price: { $type: "number" },
                        "specs.capacity_gb": { $type: "number" }
                    }
                }, { $sort: { price: 1 } }, { $limit: 1 }], as: "storage"
            }
        },
        { $unwind: "$storage" },
        {
            $project: {
                _id: 0, build_name: { $literal: buildNameLiteral },
                components: {
                    cpu: "$name", motherboard: "$mobo.name", ram: "$ram.name", gpu: "$gpu.name",
                    case: "$pc_case.name", psu: "$psu.name", storage: "$storage.name", cooler: "$cooler.name"
                },
                total_price: {
                    $add: ["$price", "$mobo.price", "$ram.price", "$gpu.price",
                        "$cooler.price", "$pc_case.price", "$psu.price", "$storage.price"]
                },
                performance_score: { $add: ["$specs.score", "$gpu.specs.score"] }
            }
        },
        { $match: { total_price: { $type: "number", $lte: maxBudget } } },
        { $sort: { performance_score: -1, total_price: 1 } }, { $limit: 1 }
    ];
}

function buildComputerByBudgetDoc(maxBudget, runIndex, usageType) {
    var usage = usageType || "gaming";
    var idx = (runIndex !== null && runIndex !== undefined) ? runIndex : null;
    var label = idx
        ? (usage.charAt(0).toUpperCase() + usage.slice(1) + " Build for $" + maxBudget + " (run " + idx + ")")
        : (usage.charAt(0).toUpperCase() + usage.slice(1) + " Build for $" + maxBudget);
    var pipeline = autoBuilderPipeline(maxBudget, label, usage);
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
    if (maxB < minB) { var tmp = minB; minB = maxB; maxB = tmp; }
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
    if (batch.length) { db.recommended_combos.insertMany(batch); }
    return batch.length;
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
