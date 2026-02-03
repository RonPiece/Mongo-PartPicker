// ============================================================
// פרויקט: Mongo-PartPicker - גרסה מתקדמת
// מערכת NoSQL לניהול קטלוג חומרה ובניית מפרטי מחשב
// שימוש ב-Polymorphic Pattern, Self-Join Lookup, ו-MapReduce מתקדם
// ============================================================

// ============================================================
// סעיף 1: הקמת מסד הנתונים והאוספים
// ============================================================

use MongoPartPicker

// ניקוי אוספים קיימים לצורך הרצה נקייה
db.components.drop()
db.builds.drop()
db.users.drop()
db.recommended_combos.drop()
db.best_builds_per_tier.drop()

db.createCollection("components")
db.createCollection("builds")
db.createCollection("users")

print("נוצרו האוספים: components, builds, users")
show collections

// ============================================================
// סעיף 2: הכנסת נתונים - Polymorphic Pattern עם requirements
// ============================================================

// --- מעבדים (CPU) - עם requirements לתאימות ---
print("\n--- הכנסת מעבדים (CPU) עם Polymorphic Pattern ---")

db.components.insertMany([
    {
        _id: ObjectId(),
        type: "CPU",
        name: "Intel Core i9-14900K",
        manufacturer: "Intel",
        price: 589,
        release_date: ISODate("2024-10-17"),
        tags: ["Gaming", "High-End", "Overclockable"],
        specs: {
            socket: "LGA1700",
            cores: 24,
            threads: 32,
            base_clock: 3.2,
            boost_clock: 6.0,
            tdp: 125,
            score: 45000
        },
        requirements: {
            socket_match: "LGA1700",
            ram_generation: "DDR5",
            min_psu_wattage: 750
        },
        reviews: [
            { user: "gamer2024", rating: 5, comment: "Best CPU for gaming!", date: ISODate("2024-11-01") },
            { user: "techreviewer", rating: 4, comment: "Great but runs hot", date: ISODate("2024-11-15") },
            { user: "pcbuilder", rating: 5, comment: "Amazing performance", date: ISODate("2024-12-01") }
        ],
        price_history: [
            { date: ISODate("2024-01-01"), price: 699 },
            { date: ISODate("2024-06-01"), price: 649 },
            { date: ISODate("2024-12-01"), price: 589 }
        ]
    },
    {
        _id: ObjectId(),
        type: "CPU",
        name: "Intel Core i7-14700K",
        manufacturer: "Intel",
        price: 409,
        release_date: ISODate("2024-10-17"),
        tags: ["Gaming", "Mid-Range"],
        specs: {
            socket: "LGA1700",
            cores: 20,
            threads: 28,
            base_clock: 3.4,
            boost_clock: 5.6,
            tdp: 125,
            score: 38000
        },
        requirements: {
            socket_match: "LGA1700",
            ram_generation: "DDR5",
            min_psu_wattage: 650
        },
        reviews: [
            { user: "budgetgamer", rating: 5, comment: "Great value!", date: ISODate("2024-11-20") },
            { user: "streamer1", rating: 4, comment: "Perfect for streaming", date: ISODate("2024-11-25") }
        ],
        price_history: [
            { date: ISODate("2024-01-01"), price: 449 },
            { date: ISODate("2024-12-01"), price: 409 }
        ]
    },
    {
        _id: ObjectId(),
        type: "CPU",
        name: "AMD Ryzen 9 7950X",
        manufacturer: "AMD",
        price: 549,
        release_date: ISODate("2024-09-27"),
        tags: ["Workstation", "High-End", "Multi-threaded"],
        specs: {
            socket: "AM5",
            cores: 16,
            threads: 32,
            base_clock: 4.5,
            boost_clock: 5.7,
            tdp: 170,
            score: 52000
        },
        requirements: {
            socket_match: "AM5",
            ram_generation: "DDR5",
            min_psu_wattage: 750
        },
        reviews: [
            { user: "videoeditor", rating: 5, comment: "Incredible for rendering!", date: ISODate("2024-10-15") },
            { user: "developer", rating: 5, comment: "Compiles so fast", date: ISODate("2024-10-20") },
            { user: "3dartist", rating: 5, comment: "Best for Blender", date: ISODate("2024-11-01") }
        ],
        price_history: [
            { date: ISODate("2024-01-01"), price: 699 },
            { date: ISODate("2024-06-01"), price: 599 },
            { date: ISODate("2024-12-01"), price: 549 }
        ]
    },
    {
        _id: ObjectId(),
        type: "CPU",
        name: "AMD Ryzen 7 7800X3D",
        manufacturer: "AMD",
        price: 449,
        release_date: ISODate("2024-04-06"),
        tags: ["Gaming", "3D V-Cache"],
        specs: {
            socket: "AM5",
            cores: 8,
            threads: 16,
            base_clock: 4.2,
            boost_clock: 5.0,
            tdp: 120,
            score: 42000
        },
        requirements: {
            socket_match: "AM5",
            ram_generation: "DDR5",
            min_psu_wattage: 550
        },
        reviews: [
            { user: "esportspro", rating: 5, comment: "Best gaming CPU period!", date: ISODate("2024-05-10") },
            { user: "casualgamer", rating: 5, comment: "No bottleneck ever", date: ISODate("2024-06-01") }
        ],
        price_history: [
            { date: ISODate("2024-04-06"), price: 499 },
            { date: ISODate("2024-12-01"), price: 449 }
        ]
    },
    {
        _id: ObjectId(),
        type: "CPU",
        name: "Intel Core i5-14600K",
        manufacturer: "Intel",
        price: 319,
        release_date: ISODate("2024-10-17"),
        tags: ["Budget", "Gaming"],
        specs: {
            socket: "LGA1700",
            cores: 14,
            threads: 20,
            base_clock: 3.5,
            boost_clock: 5.3,
            tdp: 125,
            score: 32000
        },
        requirements: {
            socket_match: "LGA1700",
            ram_generation: "DDR5",
            min_psu_wattage: 550
        },
        reviews: [
            { user: "budgetbuilder", rating: 4, comment: "Great for the price", date: ISODate("2024-11-05") }
        ],
        price_history: [
            { date: ISODate("2024-10-17"), price: 329 },
            { date: ISODate("2024-12-01"), price: 319 }
        ]
    }
])

print("נוספו 5 מעבדים (CPU) עם requirements")

// --- לוחות אם (Motherboard) - עם specs.socket לתאימות ---
print("\n--- הכנסת לוחות אם (Motherboard) עם socket תואם ---")

db.components.insertMany([
    {
        _id: ObjectId(),
        type: "Motherboard",
        name: "ASUS ROG Maximus Z790 Hero",
        manufacturer: "ASUS",
        price: 629,
        release_date: ISODate("2024-10-20"),
        tags: ["High-End", "RGB", "WiFi 7"],
        specs: {
            socket: "LGA1700",
            chipset: "Z790",
            ram_slots: 4,
            ram_type: "DDR5",
            form_factor: "ATX",
            max_ram: 192,
            score: 9500
        },
        reviews: [
            { user: "overclocker", rating: 5, comment: "Best VRMs in the market!", date: ISODate("2024-11-01") },
            { user: "rgblover", rating: 5, comment: "RGB is stunning", date: ISODate("2024-11-10") },
            { user: "techreviewer", rating: 4, comment: "Expensive but worth it", date: ISODate("2024-11-15") }
        ],
        price_history: [
            { date: ISODate("2024-10-20"), price: 699 },
            { date: ISODate("2024-12-01"), price: 629 }
        ]
    },
    {
        _id: ObjectId(),
        type: "Motherboard",
        name: "MSI MAG B650 Tomahawk WiFi",
        manufacturer: "MSI",
        price: 219,
        release_date: ISODate("2024-02-15"),
        tags: ["Mid-Range", "Value", "AM5"],
        specs: {
            socket: "AM5",
            chipset: "B650",
            ram_slots: 4,
            ram_type: "DDR5",
            form_factor: "ATX",
            max_ram: 128,
            score: 8500
        },
        reviews: [
            { user: "budgetbuilder", rating: 5, comment: "Best value AM5 board", date: ISODate("2024-03-01") },
            { user: "amdlover", rating: 4, comment: "Great for Ryzen 7000", date: ISODate("2024-04-01") }
        ],
        price_history: [
            { date: ISODate("2024-02-15"), price: 249 },
            { date: ISODate("2024-12-01"), price: 219 }
        ]
    },
    {
        _id: ObjectId(),
        type: "Motherboard",
        name: "Gigabyte Z790 AORUS Elite AX",
        manufacturer: "Gigabyte",
        price: 289,
        release_date: ISODate("2024-03-10"),
        tags: ["Mid-Range", "WiFi 6E", "LGA1700"],
        specs: {
            socket: "LGA1700",
            chipset: "Z790",
            ram_slots: 4,
            ram_type: "DDR5",
            form_factor: "ATX",
            max_ram: 128,
            score: 8800
        },
        reviews: [
            { user: "budgetgamer", rating: 5, comment: "Perfect mid-range Z790", date: ISODate("2024-04-15") }
        ],
        price_history: [
            { date: ISODate("2024-03-10"), price: 319 },
            { date: ISODate("2024-12-01"), price: 289 }
        ]
    }
])

print("נוספו 3 לוחות אם (Motherboard)")

// --- כרטיסי מסך (GPU) - עם specs.score ---
print("\n--- הכנסת כרטיסי מסך (GPU) עם score ---")

db.components.insertMany([
    {
        _id: ObjectId(),
        type: "GPU",
        name: "NVIDIA GeForce RTX 4090",
        manufacturer: "NVIDIA",
        price: 1599,
        release_date: ISODate("2024-10-12"),
        tags: ["Gaming", "High-End", "Ray Tracing"],
        specs: {
            vram: "24GB",
            memory_type: "GDDR6X",
            cuda_cores: 16384,
            boost_clock: 2520,
            power_draw: 450,
            length_mm: 340,
            score: 38000
        },
        reviews: [
            { user: "4kgamer", rating: 5, comment: "4K 120fps is real!", date: ISODate("2024-11-01") },
            { user: "vrenthusiast", rating: 5, comment: "VR is flawless", date: ISODate("2024-11-10") },
            { user: "contentcreator", rating: 5, comment: "NVENC is amazing", date: ISODate("2024-11-15") }
        ],
        price_history: [
            { date: ISODate("2024-01-01"), price: 1799 },
            { date: ISODate("2024-06-01"), price: 1699 },
            { date: ISODate("2024-12-01"), price: 1599 }
        ]
    },
    {
        _id: ObjectId(),
        type: "GPU",
        name: "NVIDIA GeForce RTX 4070 Ti Super",
        manufacturer: "NVIDIA",
        price: 799,
        release_date: ISODate("2024-01-24"),
        tags: ["Gaming", "Mid-Range", "DLSS"],
        specs: {
            vram: "16GB",
            memory_type: "GDDR6X",
            cuda_cores: 8448,
            boost_clock: 2610,
            power_draw: 285,
            length_mm: 310,
            score: 28000
        },
        reviews: [
            { user: "1440pgamer", rating: 5, comment: "Perfect for 1440p!", date: ISODate("2024-02-15") },
            { user: "streamer1", rating: 4, comment: "Great encoder", date: ISODate("2024-03-01") }
        ],
        price_history: [
            { date: ISODate("2024-01-24"), price: 849 },
            { date: ISODate("2024-12-01"), price: 799 }
        ]
    },
    {
        _id: ObjectId(),
        type: "GPU",
        name: "AMD Radeon RX 7900 XTX",
        manufacturer: "AMD",
        price: 899,
        release_date: ISODate("2024-12-13"),
        tags: ["Gaming", "High-End", "FSR"],
        specs: {
            vram: "24GB",
            memory_type: "GDDR6",
            stream_processors: 6144,
            boost_clock: 2500,
            power_draw: 355,
            length_mm: 320,
            score: 32000
        },
        reviews: [
            { user: "amdlover", rating: 5, comment: "Best AMD card ever!", date: ISODate("2024-01-10") },
            { user: "linuxgamer", rating: 5, comment: "Open source drivers!", date: ISODate("2024-02-01") },
            { user: "budgetpro", rating: 4, comment: "Great value vs 4090", date: ISODate("2024-03-15") }
        ],
        price_history: [
            { date: ISODate("2024-01-01"), price: 999 },
            { date: ISODate("2024-12-01"), price: 899 }
        ]
    },
    {
        _id: ObjectId(),
        type: "GPU",
        name: "NVIDIA GeForce RTX 4060",
        manufacturer: "NVIDIA",
        price: 299,
        release_date: ISODate("2024-06-29"),
        tags: ["Budget", "Entry Level", "DLSS"],
        specs: {
            vram: "8GB",
            memory_type: "GDDR6",
            cuda_cores: 3072,
            boost_clock: 2460,
            power_draw: 115,
            length_mm: 240,
            score: 18000
        },
        reviews: [
            { user: "budgetgamer", rating: 4, comment: "Good for 1080p", date: ISODate("2024-07-15") }
        ],
        price_history: [
            { date: ISODate("2024-06-29"), price: 329 },
            { date: ISODate("2024-12-01"), price: 299 }
        ]
    }
])

print("נוספו 4 כרטיסי מסך (GPU)")

// --- זיכרון (RAM) ---
print("\n--- הכנסת זיכרונות (RAM) ---")

db.components.insertMany([
    {
        _id: ObjectId(),
        type: "RAM",
        name: "G.Skill Trident Z5 RGB DDR5-6400",
        manufacturer: "G.Skill",
        price: 189,
        release_date: ISODate("2024-03-15"),
        tags: ["RGB", "High Speed", "DDR5"],
        specs: {
            capacity_gb: 32,
            speed_mhz: 6400,
            generation: "DDR5",
            modules: 2,
            latency: "CL32",
            score: 9200
        },
        reviews: [
            { user: "rgblover", rating: 5, comment: "Beautiful RGB!", date: ISODate("2024-04-01") },
            { user: "overclocker", rating: 5, comment: "Runs stable at 6600", date: ISODate("2024-04-15") }
        ],
        price_history: [
            { date: ISODate("2024-03-15"), price: 249 },
            { date: ISODate("2024-12-01"), price: 189 }
        ]
    },
    {
        _id: ObjectId(),
        type: "RAM",
        name: "Corsair Vengeance DDR5-5600",
        manufacturer: "Corsair",
        price: 129,
        release_date: ISODate("2024-01-10"),
        tags: ["Value", "DDR5"],
        specs: {
            capacity_gb: 32,
            speed_mhz: 5600,
            generation: "DDR5",
            modules: 2,
            latency: "CL36",
            score: 8500
        },
        reviews: [
            { user: "budgetbuilder", rating: 4, comment: "Good value DDR5", date: ISODate("2024-02-01") }
        ],
        price_history: [
            { date: ISODate("2024-01-10"), price: 159 },
            { date: ISODate("2024-12-01"), price: 129 }
        ]
    }
])

print("נוספו 2 זיכרונות (RAM)")

// --- אחסון (Storage) ---
print("\n--- הכנסת כונני אחסון (Storage) ---")

db.components.insertMany([
    {
        _id: ObjectId(),
        type: "Storage",
        name: "Samsung 990 Pro 2TB",
        manufacturer: "Samsung",
        price: 179,
        release_date: ISODate("2024-01-15"),
        tags: ["NVMe", "High Speed", "Gen4"],
        specs: {
            capacity_gb: 2000,
            storage_type: "NVMe SSD",
            read_speed: 7450,
            write_speed: 6900,
            interface: "PCIe 4.0",
            score: 9800
        },
        reviews: [
            { user: "fastloading", rating: 5, comment: "Lightning fast!", date: ISODate("2024-02-01") }
        ],
        price_history: [
            { date: ISODate("2024-01-15"), price: 229 },
            { date: ISODate("2024-12-01"), price: 179 }
        ]
    }
])

print("נוסף 1 כונן אחסון (Storage)")

// ============================================================
// הכנסת נתונים - אוסף builds (Referenced Data עם compatibility)
// ============================================================
print("\n--- יצירת מפרטים (Builds) עם References ---")

var cpu_i9 = db.components.findOne({ name: "Intel Core i9-14900K" })._id
var cpu_i7 = db.components.findOne({ name: "Intel Core i7-14700K" })._id
var cpu_ryzen9 = db.components.findOne({ name: "AMD Ryzen 9 7950X" })._id
var cpu_ryzen7 = db.components.findOne({ name: "AMD Ryzen 7 7800X3D" })._id
var cpu_i5 = db.components.findOne({ name: "Intel Core i5-14600K" })._id

var gpu_4090 = db.components.findOne({ name: "NVIDIA GeForce RTX 4090" })._id
var gpu_4070 = db.components.findOne({ name: "NVIDIA GeForce RTX 4070 Ti Super" })._id
var gpu_7900 = db.components.findOne({ name: "AMD Radeon RX 7900 XTX" })._id
var gpu_4060 = db.components.findOne({ name: "NVIDIA GeForce RTX 4060" })._id

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
        parts: [cpu_i9, gpu_4090, ram_gskill, ssd_samsung, mb_asus],
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
        parts: [cpu_ryzen9, gpu_7900, ram_gskill, ssd_samsung, mb_msi],
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
        parts: [cpu_ryzen7, gpu_4070, ram_corsair, mb_msi],
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
        parts: [cpu_i5, gpu_4060, ram_corsair, mb_gigabyte],
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
        parts: [cpu_i7, gpu_4070, ram_gskill, ssd_samsung, mb_asus],
        total_price: 2205,
        compatibility_verified: true,
        created_at: ISODate("2024-08-01"),
        last_updated: ISODate("2024-12-01")
    }
])

print("נוספו 5 מפרטים (Builds) עם compatibility_verified")

// ============================================================
// הכנסת נתונים - אוסף users
// ============================================================
print("\n--- יצירת משתמשים (Users) ---")

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
        preferences: { preferred_manufacturer: "NVIDIA", budget_range: { min: 2000, max: 5000 }, usage: "Gaming" }
    },
    {
        username: "videoeditor",
        email: "video.editor@email.com",
        registered_date: ISODate("2024-02-01"),
        saved_builds: [build_amd],
        preferences: { preferred_manufacturer: "AMD", budget_range: { min: 3000, max: 6000 }, usage: "Workstation" }
    },
    {
        username: "budgetgamer",
        email: "budget.gamer@email.com",
        registered_date: ISODate("2024-03-10"),
        saved_builds: [build_sweetspot, build_budget],
        preferences: { preferred_manufacturer: "AMD", budget_range: { min: 1000, max: 2500 }, usage: "Gaming" }
    },
    {
        username: "streamer1",
        email: "streamer@email.com",
        registered_date: ISODate("2024-04-05"),
        saved_builds: [build_highend],
        preferences: { preferred_manufacturer: "Intel", budget_range: { min: 2000, max: 4000 }, usage: "Streaming" }
    },
    {
        username: "firsttimebuilder",
        email: "newbuilder@email.com",
        registered_date: ISODate("2024-05-20"),
        saved_builds: [build_budget],
        preferences: { preferred_manufacturer: "Intel", budget_range: { min: 500, max: 1500 }, usage: "Budget" }
    }
])

print("נוספו 5 משתמשים (Users)")

// ============================================================
// סיכום הקמת הנתונים
// ============================================================
print("\n====================================")
print("=== סיכום הקמת מסד הנתונים ===")
print("====================================")
print("רכיבים (components):", db.components.countDocuments())
print("מפרטים (builds):", db.builds.countDocuments())
print("משתמשים (users):", db.users.countDocuments())
print("====================================\n")

// ============================================================
// סעיף 4: חיפוש ושליפת נתונים (Find & Query)
// ============================================================
print("\n===========================================")
print("=== סעיף 4: שליפות וחיפושים ===")
print("===========================================\n")

// שליפה עם Polymorphic - רכיבים מסוג CPU בלבד
print("א) רכיבים מסוג CPU (Polymorphic Query):")
db.components.find(
    { type: "CPU" },
    { name: 1, "specs.cores": 1, "specs.score": 1, "requirements.socket_match": 1, _id: 0 }
).pretty()

// שליפה עם Nested Field - requirements
print("\nב) CPUs שדורשים LGA1700:")
db.components.find(
    { type: "CPU", "requirements.socket_match": "LGA1700" },
    { name: 1, price: 1, "requirements.socket_match": 1, _id: 0 }
).pretty()

// שליפה עם $elemMatch
print("\nג) רכיבים עם ביקורת של gamer2024 שנתן ציון 5:")
db.components.find(
    { reviews: { $elemMatch: { user: "gamer2024", rating: 5 } } },
    { name: 1, type: 1, _id: 0 }
).pretty()

// שימוש ב-sort, limit, skip
print("\nד) 3 הרכיבים היקרים ביותר:")
db.components.find(
    {},
    { name: 1, price: 1, type: 1, _id: 0 }
).sort({ price: -1 }).limit(3).pretty()

// שימוש ב-$in עם סוגי רכיבים
print("\nה) רכיבי ביצועים (CPU או GPU):")
db.components.find(
    { type: { $in: ["CPU", "GPU"] } },
    { name: 1, type: 1, "specs.score": 1, _id: 0 }
).sort({ "specs.score": -1 }).pretty()

// ============================================================
// סעיף 5: עדכונים ומחיקות (Updates & Deletes)
// ============================================================
print("\n===========================================")
print("=== סעיף 5: עדכונים ומחיקות ===")
print("===========================================\n")

// $set - עדכון שדה
print("א) עדכון score עם $set:")
db.components.updateOne(
    { name: "Intel Core i5-14600K" },
    { $set: { "specs.score": 33000, is_featured: true } }
)
print("עודכן score ל-i5-14600K")

// $push - הוספת ביקורת
print("\nב) הוספת ביקורת עם $push:")
db.components.updateOne(
    { name: "AMD Ryzen 7 7800X3D" },
    { $push: { reviews: { user: "newreviewer", rating: 5, comment: "Excellent!", date: new Date() } } }
)
print("נוספה ביקורת חדשה")

// $pull - הסרת ביקורת
print("\nג) הסרת ביקורת עם $pull:")
db.components.updateOne(
    { name: "AMD Ryzen 7 7800X3D" },
    { $pull: { reviews: { user: "newreviewer" } } }
)
print("הוסרה הביקורת")

// updateMany - עדכון מרובה
print("\nד) הוספת in_stock לכל הרכיבים:")
db.components.updateMany({}, { $set: { in_stock: true } })
print("נוסף שדה in_stock לכל", db.components.countDocuments(), "רכיבים")

print("\n=== סיום סעיף 5 ===")

// ============================================================
// סעיף 6: אגרגציה מתקדמת - "The Auto-Builder"
// Self-Join Lookup לבניית מחשב אוטומטית
// ============================================================
print("\n===========================================")
print("=== סעיף 6: Auto-Builder עם Self-Join Lookup ===")
print("===========================================\n")

// ניקוי אוסף קודם
db.recommended_combos.drop()

// Pipeline מתקדם - מציאת שילובי CPU+Motherboard תואמים תחת תקציב
print("יצירת recommended_combos - שילובים תואמים תחת $1500:")

db.components.aggregate([
    // שלב 1: סינון CPUs בלבד
    { $match: { type: "CPU" } },

    // שלב 2: Self-Join - חיפוש לוחות אם עם socket תואם
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
                                { $eq: ["$specs.socket", "$$cpu_socket"] }
                            ]
                        }
                    }
                }
            ],
            as: "compatible_motherboards"
        }
    },

    // שלב 3: פריסת לוחות האם התואמים
    { $unwind: "$compatible_motherboards" },

    // שלב 4: חישוב מחיר משולב וציון ביצועים
    {
        $project: {
            cpu_name: "$name",
            cpu_price: "$price",
            cpu_score: "$specs.score",
            motherboard_name: "$compatible_motherboards.name",
            motherboard_price: "$compatible_motherboards.price",
            motherboard_score: "$compatible_motherboards.specs.score",
            socket: "$requirements.socket_match",
            total_price: { $add: ["$price", "$compatible_motherboards.price"] },
            combined_score: { $add: ["$specs.score", "$compatible_motherboards.specs.score"] }
        }
    },

    // שלב 5: סינון לפי תקציב
    { $match: { total_price: { $lt: 1500 } } },

    // שלב 6: מיון לפי ביצועים
    { $sort: { combined_score: -1 } },

    // שלב 7: שמירה לאוסף חדש
    { $out: "recommended_combos" }
])

print("נוצר אוסף recommended_combos:")
db.recommended_combos.find().pretty()

print("\n=== סיום סעיף 6 ===")

// ============================================================
// סעיף 7: MapReduce - "King of the Hill"
// מציאת המחשב הטוב ביותר לכל טווח תקציב
// ============================================================
print("\n===========================================")
print("=== סעיף 7: MapReduce - King of the Hill ===")
print("===========================================\n")

// חישוב ציוני ביצועים לכל build
print("שלב 1: חישוב ציוני ביצועים לכל build...")

var buildsWithScores = db.builds.aggregate([
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
                        input: { $filter: { input: "$part_details", cond: { $eq: ["$$this.type", "CPU"] } } },
                        in: "$$this.specs.score"
                    }
                }
            },
            gpu_score: {
                $sum: {
                    $map: {
                        input: { $filter: { input: "$part_details", cond: { $eq: ["$$this.type", "GPU"] } } },
                        in: "$$this.specs.score"
                    }
                }
            }
        }
    },
    {
        $addFields: {
            synthetic_score: { $add: ["$cpu_score", "$gpu_score"] }
        }
    }
]).toArray()

// שמירה לאוסף זמני לצורך MapReduce
db.builds_with_scores.drop()
db.builds_with_scores.insertMany(buildsWithScores)
print("נוצר אוסף builds_with_scores עם", buildsWithScores.length, "רשומות")

// MapReduce למציאת הטוב ביותר לכל טווח תקציב
print("\nשלב 2: הרצת MapReduce לחישוב King of the Hill...")

var mapBudgetTier = function () {
    // חישוב טווח תקציב
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
        actual_price: reducedValue.price,
        crown: "👑 King of " + key
    };
};

db.best_builds_per_tier.drop()

db.builds_with_scores.mapReduce(
    mapBudgetTier,
    reduceBestBuild,
    {
        out: "best_builds_per_tier",
        finalize: finalizeBestBuild
    }
)

print("\nתוצאות King of the Hill - הטוב ביותר לכל טווח תקציב:")
db.best_builds_per_tier.find().sort({ _id: 1 }).pretty()

print("\n=== סיום סעיף 7 ===")

// ============================================================
// סעיף 8: בדיקות אימות (Verification Tests)
// ============================================================
print("\n\n============================================================")
print("=== בדיקות אימות - וידוא תקינות הפרויקט ===")
print("============================================================\n")

// בדיקה 1: Polymorphic Pattern
print("בדיקה 1: Polymorphic Pattern")
var cpu = db.components.findOne({ type: "CPU" })
var gpu = db.components.findOne({ type: "GPU" })
var mb = db.components.findOne({ type: "Motherboard" })
print("  CPU יש 'requirements':", cpu && cpu.requirements !== undefined ? "✓" : "✗")
print("  GPU יש 'specs.vram':", gpu && gpu.specs.vram !== undefined ? "✓" : "✗")
print("  Motherboard יש 'specs.socket':", mb && mb.specs.socket !== undefined ? "✓" : "✗")

// בדיקה 2: Score field
print("\nבדיקה 2: Score Field לכל רכיבי ביצועים")
var cpuWithScore = db.components.findOne({ type: "CPU", "specs.score": { $exists: true } })
var gpuWithScore = db.components.findOne({ type: "GPU", "specs.score": { $exists: true } })
print("  CPU יש 'specs.score':", cpuWithScore !== null ? "✓" : "✗")
print("  GPU יש 'specs.score':", gpuWithScore !== null ? "✓" : "✗")

// בדיקה 3: Self-Join Lookup
print("\nבדיקה 3: Self-Join Lookup (recommended_combos)")
var collections = db.getCollectionNames()
var comboCount = db.recommended_combos.countDocuments()
print("  אוסף recommended_combos:", collections.includes("recommended_combos") ? "✓" : "✗")
print("  מספר שילובים:", comboCount)

// בדיקה 4: MapReduce
print("\nבדיקה 4: MapReduce (best_builds_per_tier)")
var tierCount = db.best_builds_per_tier.countDocuments()
print("  אוסף best_builds_per_tier:", collections.includes("best_builds_per_tier") ? "✓" : "✗")
print("  מספר טווחי תקציב:", tierCount)

// בדיקה 5: Referenced Data
print("\nבדיקה 5: Referenced Data")
var build = db.builds.findOne()
print("  builds.parts מכיל ObjectIds:", build && build.parts && build.parts.length > 0 ? "✓" : "✗")
print("  builds.compatibility_verified:", build && build.compatibility_verified !== undefined ? "✓" : "✗")

// סיכום
print("\n============================================================")
print("=== סיכום סופי ===")
print("============================================================")
print("סה\"כ רכיבים:", db.components.countDocuments())
print("סה\"כ מפרטים:", db.builds.countDocuments())
print("סה\"כ משתמשים:", db.users.countDocuments())
print("סה\"כ שילובים מומלצים:", db.recommended_combos.countDocuments())
print("סה\"כ טווחי תקציב:", db.best_builds_per_tier.countDocuments())
print("סה\"כ אוספים:", db.getCollectionNames().length)
print("============================================================")

print("\n")
print("   ____                            _       _   _                 _ ")
print("  / ___|___  _ __   __ _ _ __ __ _| |_ ___| | | | __ _ _ __   __| |")
print(" | |   / _ \\| '_ \\ / _` | '__/ _` | __/ __| | | |/ _` | '_ \\ / _` |")
print(" | |__| (_) | | | | (_| | | | (_| | |_\\__ \\_|_| | (_| | | | | (_| |")
print("  \\____\\___/|_| |_|\\__, |_|  \\__,_|\\__|___(_) (_)\\__,_|_| |_|\\__,_|")
print("                   |___/                                           ")
print("\n")
print("הפרויקט המתקדם הושלם בהצלחה!")
print("Advanced Features: Polymorphic Pattern, Self-Join Lookup, MapReduce Analytics")
print("============================================================")
