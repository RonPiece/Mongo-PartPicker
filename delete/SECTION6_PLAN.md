# Section 6: Aggregation — Implementation Plan

## Overview

Section 6 demonstrates MongoDB's **Aggregation Framework** through a "PC Auto-Builder" system
that assembles optimal computer builds from the `components` collection using a combination of
**pure aggregation pipelines** and **JavaScript functions** (Section 3 requirement: "שילוב בכל הסעיפים").

The system supports **4 usage profiles** (Gaming, Workstation, Budget, Enthusiast) with
weighted scoring and a fallback mechanism for low budgets.

---

## Allowed Operators (White-List from Course)

### Pipeline Stages (from course slides + project instructions)

| Operator | Source | Usage in Our Code |
|----------|--------|-------------------|
| `$match` | Instructions + Slide 9 | CPU filtering, Motherboard filtering, RAM filtering, budget check |
| `$project` | Instructions + Slide 9 | Calculate `partial_price` with `$add`, rename fields, `$subtract` for price range |
| `$lookup` | Instructions + Slide 10 | **Self-Join ×2** (CPU→Mobo by socket, Mobo→RAM by generation) |
| `$unwind` | Instructions + Slide 9 | Expand lookup results into individual documents |
| `$group` | Instructions + Slide 9 | Pick cheapest mobo/RAM per CPU (`$first`), statistics (`$sum`, `$avg`, `$min`, `$max`, `$push`) |
| `$sort` | Instructions + Slide 9 | Sort by score, price, count |
| `$out` | Instructions + Slide 9 | Save results to collections |
| `$limit` | "לפי הצורך" + Slide 5 | Prevent memory explosion in Self-Join |
| `$expr` | Slide 9, p.10 | Field-to-field comparison (socket validation), `$multiply` comparison |

### Mathematical Operators (Slide 9, p.36)

| Operator | Usage |
|----------|-------|
| `$add` | Sum component prices (CPU + Mobo + RAM) |
| `$subtract` | Calculate price range (max - min) |
| `$multiply` | Value ratio calculation (price × 2) |

### Group Accumulators (Slide 9, p.13)

| Accumulator | Usage |
|-------------|-------|
| `$first` | Pick cheapest component after `$sort` |
| `$sum` | Count components |
| `$avg` | Average prices |
| `$min` | Minimum price |
| `$max` | Maximum price |
| `$push` | Build array of product lines per manufacturer |

### FORBIDDEN (not taught in course)

| Operator | Replacement |
|----------|-------------|
| `$addFields` | `$project` (list all fields explicitly) |
| `$lookup` with `pipeline` | Basic `$lookup` + `$match` after `$unwind` |
| `$switch` | JavaScript `if/else` in wrapper function |
| `$ifNull` | JavaScript `\|\|` fallback |
| `$cond` | JavaScript conditionals |
| `$let` / `$$variables` | JavaScript variables |
| `$facet` | Multiple separate pipelines |

---

## Data Schema (Relevant Fields)

All components are in a single `components` collection (Polymorphic Pattern).

### CPU
```json
{
  "type": "CPU",
  "name": "AMD Ryzen 7 7800X3D",
  "manufacturer": "AMD",
  "price": 449,
  "specs": {
    "socket": "AM5",
    "cores": 8,
    "base_clock": 4.2,
    "boost_clock": 5.0,
    "tdp": 120,
    "score": 1010
  },
  "requirements": {
    "socket_match": "AM5"
  }
}
```

### Motherboard
```json
{
  "type": "Motherboard",
  "name": "MSI MAG B650 Tomahawk WiFi",
  "price": 219,
  "specs": {
    "socket": "AM5",
    "form_factor": "ATX",
    "max_ram": 128,
    "ram_type": "DDR5"
  }
}
```

### RAM
```json
{
  "type": "RAM",
  "name": "G.Skill Trident Z5 RGB DDR5-6400",
  "price": 189,
  "specs": {
    "capacity_gb": 32,
    "speed_mhz": 6400,
    "generation": "DDR5",
    "modules": 2
  }
}
```

### GPU
```json
{
  "type": "GPU",
  "name": "NVIDIA GeForce RTX 4070 Ti Super - ...",
  "price": 799,
  "specs": {
    "chipset": "GeForce RTX 4070 Ti Super",
    "vram": 16,
    "length_mm": 336,
    "score": 3200
  },
  "requirements": {
    "min_case_length": 336
  }
}
```

### Case
```json
{
  "type": "Case",
  "price": 89,
  "specs": {
    "form_factor": "ATX Mid Tower",
    "supported_motherboards": ["ATX", "Micro ATX", "Mini ITX"],
    "max_gpu_length": 400
  }
}
```

### Power Supply
```json
{
  "type": "Power Supply",
  "price": 129,
  "specs": { "wattage": 850, "efficiency": "80+ Gold" }
}
```

### Storage
```json
{
  "type": "Storage",
  "price": 179,
  "specs": { "capacity_gb": 2000, "storage_type": "SSD" }
}
```

### CPU Cooler
```json
{
  "type": "CPU Cooler",
  "price": 34,
  "specs": { "kind": "Air", "rpm_min": 600, "rpm_max": 1500 }
}
```

---

## Cross-Reference Fields (Join Keys)

| Relationship | Local Field | Foreign Field | `$lookup` Type |
|-------------|------------|---------------|----------------|
| CPU → Motherboard | `requirements.socket_match` | `specs.socket` | ✅ Basic (Self-Join) |
| Motherboard → RAM | `specs.ram_type` | `specs.generation` | ✅ Basic (Self-Join) |
| GPU → Case | `requirements.min_case_length` | `specs.max_gpu_length` | ❌ No FK (inequality, not equality) |
| CPU+GPU → PSU | Calculated (TDP + VRAM×20 + 100) | `specs.wattage` | ❌ No FK (inequality) |

**Conclusion**: Basic `$lookup` works for CPU→Mobo and Mobo→RAM (equality joins).
GPU, Case, PSU, Storage, Cooler must be handled by JavaScript (Section 3).

---

## Architecture: 4 Pipelines + JavaScript

### Pipeline #1: "The Auto-Builder" (Main)

**Purpose**: Find optimal CPU + Motherboard + RAM combination via Self-Join.

**Data Flow**:
```
components (type: CPU)
  │
  ├─ $match → CPUs within budget, valid score/socket
  ├─ $sort → by specs.score DESC, price ASC
  ├─ $limit 5 → top 5 candidates
  │
  ├─ $lookup (Self-Join #1) ─── components → components
  │   localField: requirements.socket_match
  │   foreignField: specs.socket
  │   as: socket_matches
  │
  ├─ $unwind → socket_matches
  ├─ $match → type: "Motherboard" only (filter Self-Join noise)
  ├─ $sort → cheapest motherboard first
  ├─ $group → $first picks cheapest mobo per CPU
  │
  ├─ $lookup (Self-Join #2) ─── components → components
  │   localField: mobo_ram_type
  │   foreignField: specs.generation
  │   as: ram_matches
  │
  ├─ $unwind → ram_matches
  ├─ $match → type: "RAM", capacity ≥ minRamGb
  ├─ $sort → cheapest RAM first
  ├─ $group → $first picks cheapest RAM per CPU+Mobo
  │
  ├─ $project → partial_price: $add[cpu_price, mobo_price, ram_price]
  ├─ $match → partial_price ≤ budgetForCore
  │           + $expr: cpu_socket == mobo_socket (validation)
  ├─ $sort → best score, cheapest
  ├─ $limit 1 → single best option
  └─ $out → "recommended_combos"
```

**Total stages**: 18 (demonstrates every required operator)

**JavaScript Completion (Phase B)**:
After pipeline saves core build, JavaScript:
1. Reads result from `recommended_combos`
2. Finds best GPU within remaining budget (`findOne` + sort by score)
3. Finds Case that fits GPU length
4. Calculates required PSU wattage, finds matching PSU
5. Finds cheapest Storage and CPU Cooler
6. Computes `total_price` and `weighted_score`
7. Saves complete build back to collection

**Retry Logic** (JavaScript):
1. If `preferX3D` yields no results → retry without X3D regex
2. If high RAM requirement yields no results → retry with 16GB minimum
3. If still nothing → call `buildCheapestPossible()` (fallback)

### Pipeline #2: "Market Analysis"

```
$match → price is numeric
$group → _id: "$type", count: $sum, avg: $avg, min: $min, max: $max
$sort → avg_price DESC
$project → price_range: $subtract[max, min]
$out → "market_analysis"
```

**Demonstrates**: `$group` with 4 accumulators, `$subtract` in `$project`

### Pipeline #3: "Manufacturer Breakdown"

```
$match → manufacturer not null, price numeric
$group #1 → _id: {manufacturer, type}, count: $sum, avg_price: $avg
$sort → by manufacturer, count DESC
$group #2 → _id: manufacturer, product_lines: $push{...}, total: $sum
$sort → total DESC
$out → "manufacturer_breakdown"
```

**Demonstrates**: Double `$group`, `$push` accumulator

### Pipeline #4: "High-Value Components" ($expr Demo)

```
$match → score and price exist
$match → $expr: score > $multiply[price, 2]
$project → value_ratio: $subtract[score, $multiply[price, 2]]
$sort → value_ratio DESC
$limit 10
$out → "high_value_components"
```

**Demonstrates**: `$expr` with `$multiply` for field-to-field comparison

---

## 4 Usage Profiles

| Parameter | Gaming | Workstation | Budget | Enthusiast |
|-----------|--------|-------------|--------|------------|
| CPU Budget Ratio | 25% | 40% | 30% | 30% |
| GPU Budget Ratio | 45% | 25% | 35% | 40% |
| Min RAM (GB) | 16 | 32 | 16 | 64 |
| Preferred RAM (GB) | 32 | 64 | 16 | 128 |
| Prefer X3D CPUs | Yes | No | No | Yes |
| Score Weight: CPU | 0.4 | 0.5 | 0.3 | 0.4 |
| Score Weight: GPU | 0.6 | 0.2 | 0.5 | 0.5 |
| Score Weight: RAM | 0.0 | 0.3 | 0.2 | 0.1 |

---

## Scoring System

### Component Scores (from ETL in data.js):
- **CPU**: `cores × 100 + base_clock × 50`
- **GPU**: `vram × 200`

### Weighted Score:
```
score = (cpuScore × weights.cpu) + (gpuScore × weights.gpu) + (ramCapacityGB × weights.ram)
```

### PSU Wattage Calculation:
```
requiredWatts = cpuTDP + (gpuVRAM × 20) + 100 (safety)
```

---

## Fallback Mechanism

Triggered when no build fits within budget after all retries.

1. Finds absolute cheapest CPU (with valid `socket_match`)
2. Finds cheapest Motherboard matching that socket
3. Infers RAM type from Motherboard (default: DDR4)
4. Finds cheapest RAM/GPU/Case/PSU/Storage/Cooler
5. Returns document with `warning` field
6. No compatibility checks (just cheapest of everything)

---

## Operator Coverage Checklist

| Operator | Pipeline 1 | Pipeline 2 | Pipeline 3 | Pipeline 4 |
|----------|-----------|-----------|-----------|-----------|
| `$match` | ✅ ×4 | ✅ | ✅ | ✅ ×2 |
| `$project` | ✅ (`$add`) | ✅ (`$subtract`) | — | ✅ (`$subtract`, `$multiply`) |
| `$lookup` | ✅ Self-Join ×2 | — | — | — |
| `$unwind` | ✅ ×2 | — | — | — |
| `$group` | ✅ ×2 (`$first`) | ✅ (`$sum`,`$avg`,`$min`,`$max`) | ✅ ×2 (`$push`,`$sum`,`$avg`) | — |
| `$sort` | ✅ ×4 | ✅ | ✅ ×2 | ✅ |
| `$limit` | ✅ ×2 | — | — | ✅ |
| `$out` | ✅ | ✅ | ✅ | ✅ |
| `$expr` | ✅ | — | — | ✅ (`$multiply`) |
| `$add` | ✅ | — | — | — |
| `$subtract` | — | ✅ | — | ✅ |
| `$multiply` | — | — | — | ✅ |
| JS Functions | ✅ (wrapper + completion) | — | — | — |

**✅ All required operators appear at least once across the 4 pipelines.**

---

## Demo Runs (in section6_aggregate)

| Demo | Budget | Profile | Expected Outcome |
|------|--------|---------|-----------------|
| 1 | $1,700 | Gaming | Full build with X3D CPU preference |
| 2 | $2,500 | Workstation | Full build with high-core CPU, 32GB+ RAM |
| 3 | $5,000 | Enthusiast | Top-tier build with X3D + best GPU |
| 4 | $500 | Budget | Likely triggers fallback mechanism |

---

## Output Collections

| Collection | Created By | Contents |
|------------|-----------|----------|
| `recommended_combos` | Pipeline #1 + JS | All 4 demo builds |
| `market_analysis` | Pipeline #2 | Stats per component type |
| `manufacturer_breakdown` | Pipeline #3 | Products per manufacturer |
| `high_value_components` | Pipeline #4 | Top value-ratio components |

---

## File Structure

```
project_section6_final.js
├── Header (what the file demonstrates)
├── getProfileParams()           — Section 3: JS helper
├── calculateWeightedScore()     — Section 3: scoring function
├── calculateRequiredWatts()     — Section 3: PSU calculation
├── buildAutoPC()                — Section 3 + 6: main function
│   ├── Phase A: Aggregation Pipeline (18 stages)
│   ├── Retry Logic (JS)
│   ├── Phase B: JS Completion (GPU, Case, PSU, Storage, Cooler)
│   └── Phase C: Save complete build
├── buildCheapestPossible()      — Section 3: fallback
├── runMarketAnalysis()          — Pipeline #2
├── runManufacturerBreakdown()   — Pipeline #3
├── runHighValueAnalysis()       — Pipeline #4 ($expr demo)
├── section6_aggregate()         — Entry point (4 demos + stats)
└── Footer (load confirmation)
```

---

## How to Run

```javascript
// Load the file
load("project_section6_final.js")

// Run all demos
section6_aggregate()

// Or run individually
buildAutoPC(1700, "gaming")
buildAutoPC(2500, "workstation")
buildAutoPC(5000, "enthusiast")
buildAutoPC(500, "budget")

// Check results
db.recommended_combos.find().pretty()
db.market_analysis.find().pretty()
db.manufacturer_breakdown.find().pretty()
db.high_value_components.find().pretty()
```
