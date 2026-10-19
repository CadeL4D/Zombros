# Zombros — Master Design

Open-world, low-poly co-op zombie survival that runs in the browser (phones included).
Goal of the game: **survive**. Build a safe place, push out into a huge dangerous world, and make it yours.

Status: living document. Items marked **[OPEN]** still need a decision.

---

## 1. Pillars

1. **Danger outside** — every trip out is risky; noise, darkness and scarcity force careful play.
2. **Freedom** — huge map, every building enterable, every vehicle drivable, any road leads somewhere.
3. **Your world** — build an outpost/safe place with Minecraft-style creative freedom.
4. **Together** — co-op first; PvP later as a host option.

**Tone:** middle ground — forgiving enough to be fun with friends, tense enough that one mistake hurts. A "Hardcore" server preset can push it toward Project Zomboid.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Client | TypeScript + Three.js (WebGPU renderer, WebGL2 fallback), Vite |
| Server | TypeScript (Bun/Node), authoritative, shares simulation code with the client |
| Netcode | WebSocket baseline, WebTransport where available; fixed tick, client prediction |
| Hosting | v1: a player's browser hosts friends via WebRTC (free). Later: dedicated servers |
| Hot paths | Rust → WASM in Web Workers only if profiling demands it (pathfinding, horde sim) |
| Native apps (later) | Capacitor (iOS/Android), Tauri (desktop) wrapping the same build |

---

## 3. Art direction & asset pipeline

**Look:** Synty POLYGON / Surroundead — faceted, slightly bevelled low-poly ("low poly, not blocky"), flat colours from one shared palette texture, strong lighting (sun + soft shadows, AO, fog, bloom, colour grading, day/night). Quality tiers per device.

**No third-party packs** for humans, animations or clutter. Everything is ours.

### Modular contracts
1. **Skeleton** — one canonical humanoid rig (~20–25 bones + helpers); every human, zombie, clothing piece and animation targets it.
2. **Palette** — one palette image; every model UVs into its swatches. Recolour = swap swatches.
3. **Slots** — `body · head · hair · top · bottom · shoes · hat · back · face`.
4. **Manifest** — JSON registry of every asset (id, slot, tris, tags). Game loads by id; swapping a file needs no code change.

### Pipeline (each stage is a swappable script)
`SOURCE (hand / parametric / local AI) → NORMALIZE → STYLIZE (remesh, flat shade, bevel, palette snap) → RIG (bind to canonical skeleton) → VALIDATE (tri budget, bones, palette) → EXPORT (GLB + meshopt) → MANIFEST`

### Sources
| Asset | Source |
|---|---|
| Base human (body, head, skeleton) | Hand-built in Blender via Python. One mesh + shape keys (sex/weight/height/muscle). POLYGON-style proportions |
| Clothing, hair, gear, zombie damage | Local AI shape gen → stylize → fit to body |
| Animations | Keyframed base cycles (~20 clips) + runtime procedural layer (IK, limps, lean, hit reactions, ragdoll); local text-to-motion / phone mocap for drafts |
| Buildings | Modular kit (walls, floors, windows, doors, roofs, stairs) on a grid — **the same kit players build with** |
| Vehicles | Hand-built in Blender, palette variants + damaged variants |
| Props/clutter | Parametric generators (tables, shelves, crates, cans, fences…), some generated in-browser |
| Weapons + FP arms | Hand-built, highest polycount budget |

Local hardware for AI tools: **Tesla P100 16 GB** (Pascal, sm_60: no tensor cores, no bf16, no flash-attention, no Triton), Intel N150 4-core, 15 GB RAM, Ubuntu 24.04. Pinned to **PyTorch 2.14 + CUDA 12.6**, the last release with Pascal wheels. Tools must run in fp16/fp32 with PyTorch SDPA attention; CUDA extensions are built for `TORCH_CUDA_ARCH_LIST=6.0`.

**Tri budgets:** zombie 1.5–3k · player 3–5k · car 2–4k · building piece 50–300 · FP weapon 3–6k. Full spec in §3a.

---

## 3a. Model detail spec

### The rule: detail follows distance
| Tier | What | Detail level |
|---|---|---|
| **Touch** (in your hands / in your face) | FP weapons, arms, items you hold, car dashboards, doors you open | Highest — clean bevels, small parts modelled |
| **Walk-past** (1–30 m) | Characters, zombies, furniture, cars, building interiors, fences | Medium — strong silhouette, key details modelled |
| **Landscape** (30 m +) | Building exteriors, trees, terrain, far city | Low per object, but silhouettes and colour blocks must read clearly |

### Style rules (everything)
- **Detail comes from geometry, not textures.** Window frames, trims, gutters, AC units, pipes and signs are separate small modular pieces, drawn cheaply with instancing.
- **Bevel** visible outer edges once (~2–5 cm chamfer); never bevel hidden edges. Faceted, not blocky.
- **2–4 palette colours per object.** The palette also has **gradient strips** (light→dark) for subtle grime/shading on walls and ground, the trick Synty uses.
- **One decal atlas** (the only real texture besides the palette): signs and lettering, posters, graffiti, cracks, grime, blood, road markings. It does a lot for "looks amazing" at little cost.
- **Night:** windows, street lights and signs use emissive palette swatches, so far-away cities glow.

### Scale & grid contract (needed for modular building)
| Item | Size |
|---|---|
| 1 unit | 1 m |
| Build grid | 1 m, with 0.5 m snap for decor |
| Wall module | 2 m wide × 3 m tall (one storey) |
| Wall thickness | 0.2 m |
| Door opening | 1 m × 2.1 m (double: 2 m) |
| Window opening | 1 m × 1.2 m, sill at 0.9 m |
| Stairs | fit in 2 × 4 m, one storey |
| Garage door | 3 m (single), 6 m (double) |
| Human height | ~1.8 m |

World buildings and player builds use exactly these numbers.

### Budgets by category (triangles, LOD0 → furthest LOD)
| Category | LOD0 | Far | Notes |
|---|---|---|---|
| Wall / floor / roof piece | 50–300 | merged | instanced; merged per building when far |
| House exterior (assembled) | 2–5k | 300 | |
| House interior (furnished) | 5–15k | — | streamed only when you're near/inside (door portals) |
| Shop / gas station | 4–10k ext. | 500 | |
| Big landmark (mall, airport, base) | split into rooms/zones | per-zone LOD | hand-designed prefabs, streamed in parts |
| Skyscraper | modular floors | 1 merged block | all floors enterable; upper floors generated + streamed per floor |
| Far city block | — | ~3k for the whole block | merged "HLOD" silhouette + glowing windows |
| Furniture | 200–1.5k | 50 | doors/drawers separate so containers open |
| Small items (cans, tools) | 20–300 | — | world pickup version; held version can be nicer |
| Car | 2–4k ext. + 1–2k interior | 300 | doors/hood/trunk/wheels separate (damage, looting) |
| Truck / bus | 4–6k | 500 | |
| Boat | 2–5k | 400 | |
| Plane / helicopter | 4–8k + cockpit | 600 | cockpit only loaded when you're inside |
| Survivor (body + clothes) | 3–5k | 400 | |
| Zombie | 1.5–3k | 300 | far hordes use baked-animation instancing |
| FP weapon | 3–6k | — | world/dropped version 300–800 |
| FP arms | ~3k | — | |
| Tree | 300–1.5k | billboard | |
| Rock | 50–500 | 20 | |
| Grass / crops | instanced shader | fades out | |
| Terrain | flat-shaded heightmap chunks, coloured by region | quadtree LOD | |

### Frame budgets
| | Phone | PC |
|---|---|---|
| Triangles on screen | 300–500k | 2–5M |
| Draw calls | < 200 | < 1,000 |
| Textures | palette (256–512 px) + decal atlas (1–2k) | same, higher-res decals |
| Effects | shadows (1 cascade), fog, light bloom | cascaded soft shadows, AO, bloom, grading, volumetric fog |

---

## 4. The world

### Size
**Default 16 × 16 km (256 km²)**, plus a **32 × 32 km "Large World"** setting. Air and sea travel make that size worth it. The client only streams nearby chunks, so map size barely affects phones; saves store only changes (deltas) on top of the seed.

### Generation layers
1. **Macro (seeded):** coastline, mountains, rivers, lakes, highways, **region layout** (§5).
2. **Settlements:** towns/cities placed along roads, streets laid out, lots filled with buildings assembled from the modular kit; interiors filled by room-type rules (kitchen, bedroom, garage…).
3. **Landmarks:** hand-designed prefabs (mall, airport, military base, hospital, police station, research facility…) placed by the generator.
4. **Living world:** horde migrations, helicopter crashes, airdrops, blackouts, weather, seasons.

Every player generates the world from the same seed; the server only syncs deltas (looted containers, broken doors, builds).

### Zombie population & respawn (core rule)
- Map split into ~100 × 100 m cells. Each stores `original`, `current`, `cap`, `cleared`.
- Cell is **cleared** when players push it below ~20 % of `original`.
- Once cleared, `cap = 50 % of original` permanently; it regrows slowly (days, server setting) toward the cap.
- Regrowth arrives by **migration from neighbouring cells**, never popping in where players can see.
- A claimed/barricaded safehouse holds its cell at zero.
- Hordes can temporarily overflow any cap.
- Far-away cells are just numbers (virtual population); only cells near players spawn real zombies.
- **[OPEN]** Does clearing again drop further (50 → 25 %)? Default: no, stays at 50 %.

---

## 5. Regions — each has things found **only there**

Regions give the world identity and a reason to travel. Each one has an exclusive **resource**, **zombie type**, **vehicle**, **landmark** and **hazard**.

| Region | Exclusive resource | Exclusive zombie | Exclusive vehicles | Signature landmarks | Hazard |
|---|---|---|---|---|---|
| **Suburbs & small towns** (start) | Everyday basics, seeds packets | — (walkers) | Sedans, bikes, minivans | Gas station, school, church | Low — the learning zone |
| **Metro City** | Electronics, pharmacy meds, rare clothing | **Screamer** (calls the horde) | Police cars, buses, ambulances | Downtown towers, mall, hospital, subway | Densest hordes, sightlines blocked |
| **Industrial Port & Refinery** | **Bulk fuel**, shipping-container loot, steel | **Bloater** (bursts into gas) | Boats, forklifts, semi trucks | Refinery, container yard, docks, cranes | Fires, toxic gas |
| **Farmland & Plains** | **Crops, seeds, livestock feed**, fertiliser | Crawlers in fields (hide in crops) | Tractors, pickups, **crop-duster planes** | Barns, grain silos, county fair | Wide open — hard to hide |
| **Forest & Mountains** | Hunting gear, **wood**, wild game, cold-weather clothing | **Feral** (fast, climbs) | ATVs, dirt bikes, snowmobiles | Ranger station, ski resort, radio tower, cabins | Cold, wolves(?), getting lost |
| **Lakes & Wetlands** | Fish, clean-water filters | **Drowned** (rises from water) | Airboats, canoes, seaplanes | Fishing village, dam, power plant | Fog, water ambushes |
| **Quarry & Canyonlands** | **Explosives**, stone, metal ore | **Brute** (heavy, shrugs off hits) | Dump trucks, dune buggies | Quarry, mine tunnels, prison | Falls, cave-ins |
| **Military Zone** | **Military weapons & ammo**, armour, keycards | **Armoured** (helmets/vests — aim for gaps) | Humvees, APCs, **helicopters** | Army base, checkpoints, quarantine camp | Turrets, minefields, heavy hordes |
| **Airport & Airfields** | Luggage loot, aviation fuel | — | **Planes** (small props → cargo) | International airport, private airstrips | Massive open runway hordes |
| **Coast & Islands** | Untouched loot, boat parts | Drowned | Yachts, jet skis | Resort, lighthouse, island town | Only reachable by boat/air |
| **Quarantine Zone** (endgame) | **Research samples, cure reagents** | **Lab mutants** (unique specials) | — | **Research Facility** (the only place to make a cure) | Contamination, the most dangerous zone |

Rule of thumb: a region's exclusive resource is something a growing outpost *needs* (fuel, seeds, explosives, ammo, wood, meds), so players must eventually venture out.

**Region placement:** the generator places regions logically — Suburbs at the edges of the start area, Metro inland on highways, Port on the coast, Farmland in flat areas, Forest/Mountains on high ground, Military + Quarantine Zone deep and far from spawn. Danger rises with distance from spawn.

---

## 6. Survival

- **Needs:** hunger, thirst, tiredness, temperature. Lighter than Zomboid — a push outside, not a chore.
- **Health:** hit-location injuries (bleeding, fractures), bandages, splints, meds.
- **Infection:** bites start an infection timer; scratches have a chance to infect; antibiotics slow it.
- **The cure:** can **only** be made at a **Research Facility** (Quarantine Zone). One synthesis = **one dose = heals one person**. Needs samples from special zombies + reagents. Co-op groups must make multiple trips to save multiple people.
- **Stealth & noise:** zombies hear and see; crouch/sneak, light at night, broken glass, gunshots, car alarms. Noise propagates through the cell system and pulls virtual zombies in.

---

## 7. Combat

- **Melee** is the backbone: stamina, shove, weapon durability.
- **Guns** are powerful but **loud** — every shot is a decision.
- **Hit zones:** head = kill, legs = cripple (zombie becomes a crawler), arms = weaker grabs, torso = knockback. Driven by the procedural animation layer.
- **Zombie types:** walker, runner, crawler + regional specials (§5).
- Camera: **first-person by default, third-person toggle** (both supported; FP viewmodel gets the highest quality bar).

---

## 8. Loot & inventory

- **No weight limits.** Capacity comes from a **grid inventory** (items have shapes, can rotate, can stack).
- Grids: pockets (small), rig/vest, backpack (sizes vary — finding a bigger backpack matters), vehicle trunks, containers.
- Very large items (generator, tyre, engine parts) are **carried in hands** (no sprinting, no weapon) or moved by vehicle.
- Loot matches room type and region (§5).

---

## 9. Building — your outpost, Minecraft-style creativity

- **Snap-grid building** with the same modular kit the world's buildings use: walls, floors, roofs, stairs, doors, windows, fences, gates.
- **Free-form decorating:** place any furniture/prop you find; paint pieces with palette colours.
- **Deconstruct the world:** take apart existing buildings and vehicles for materials.
- **Utilities:** generators, lights, rain collectors, farming plots, workbenches, storage, beds.
- **Defence:** barricades, spikes, walls, gates, traps, alarms.
- **Safehouse claim:** a claimed outpost stops zombie regrowth in its cell.
- **Blueprints:** save a build and share it.
- **Creative mode** (server setting): no zombies/needs, unlimited pieces — pure building.

---

## 9a. Crafting — "Bench Tinkering"

Simple like Minecraft, with some nested recipes, but crafted in our own way: **physically on a workbench, and the tool you use decides what you make.**

### How it works
1. **Lay parts on the bench.** At a station, drag items from your grid inventory onto the bench surface. They sit there as real 3D objects (first- or third-person; drag-and-drop on phones).
2. **The bench guesses.** As soon as the parts match something, a **ghost preview** of the result floats over the bench. If you're one part short, the ghost appears with the **missing part outlined**: "pipe + tape + ??? → spear (needs a blade)". Experimenting is how you discover recipes.
3. **Pick a tool, the tool is the verb.** The same parts make different things depending on the tool:
   - scrap metal + **hammer** → nails
   - scrap metal + **welder** → metal plate
   - cloth + **knife** → rags; cloth + **needle** → padding
4. **Craft.** A short first-person animation snaps the parts together (procedural, no animation pack needed).
5. **Learned forever.** Every recipe you make goes into your **notebook**. From then on it's **one tap** from the notebook (and batch crafting), so repeat crafting is never tedious.

### Ways to learn recipes
- **Experiment** on the bench (ghost hints).
- **Take things apart:** disassembling a found item gives parts *and* teaches its recipe (fits "deconstruct the world").
- **Manuals & magazines** found in the world. Some are **regional exclusives** (military manuals in the Military Zone, farming almanacs in Farmland, chemistry notes in the Quarantine Zone).
- In co-op, teammates can **copy recipes** from each other's notebooks.

### Recipe depth: max ~3 levels
```
Raw (found/harvested)  →  Parts                →  Items / builds
logs                    →  planks               →  wall frame, crate, bed
scrap metal             →  nails, metal plate   →  barricade, armour plate, spike trap
cloth                   →  rags, padding        →  bandage, padded vest
pipe + tape + blade     →                       →  spear
chemicals + rags        →  disinfectant         →  sterile bandage
```
Keep the list short and readable: ~60–100 recipes at launch, grown over time.

### Stations (placeable in your outpost)
| Station | Makes |
|---|---|
| Hands (anywhere) | rags, simple bandages, torches, basic tools |
| Workbench | wood & basic metal parts, melee weapons, barricades, furniture |
| Forge / welder | metal plates, armour, vehicle parts, strong defences |
| Sewing table | clothing, bags (bigger backpack grids!), padding |
| Kitchen / campfire | food, clean water |
| Chem station | medicine, disinfectant, explosives (with manuals) |
| Electronics bench | lights, radios, alarms, generator wiring |

The cure is **not** craftable here; only at a Research Facility.

Skills follow the "enhance, don't block" rule: higher skill = faster crafting, better durability/quality, sometimes extra output.

---

## 10. Vehicles — lots of them

| Class | Examples |
|---|---|
| Land | bicycles, motorbikes, dirt bikes, ATVs, sedans, pickups, SUVs, vans, police, ambulances, buses, semis, tractors, dump trucks, humvees, APCs, snowmobiles |
| Water | canoes, motorboats, airboats, jet skis, yachts |
| Air | crop-dusters, small props, seaplanes, helicopters, cargo planes |

- Fuel (regional fuel types: petrol, diesel, aviation fuel), keys (houses/zombie pockets) or hotwiring, noise, trunk grid storage, part damage + repair.
- Aircraft need runways/landing areas and are the only practical way to reach some islands quickly.

---

## 11. Skills — enhance, rarely block

- Learn by doing (+ books/magazines to speed up).
- Skills **improve** things, they don't gate them: anyone can shoot, build, cook, drive, but skill improves accuracy, speed, quality, durability, yields.
- **A few hard gates** where it makes sense:
  - **Flying** (planes/helicopters) needs a flight manual / pilot skill.
  - **Surgery** (removing a bitten limb?), **advanced electronics** (wiring a base grid), **advanced mechanics** (engine swaps).
- **[OPEN]** Final list of gated skills.

---

## 12. Death & saves

- Saves: single-player in the browser; multiplayer on the host. Small because the world rebuilds from its seed.
- Death modes (chosen by the host when the world is created):
  1. **Same survivor, same world** — respawn at your bed/sleeping bag (or a spawn point) as the same character; the world and your outpost remain. Penalty: **you drop your gear** where you died (go back for it) and take a **small skill loss**.
  2. **New survivor, same world** — your character's stats/skills are lost and you start as someone new, but the world and your outpost remain.
  3. **New survivor, new world** — permadeath: the character and the world are both gone; start fresh.

### Co-op: death is permanent — except infection
- In co-op, a dead player is **permanently dead** (they rejoin as a new survivor in the same world; the world itself only resets in mode 3 when the whole group is dead).
- **Exception — death by infection:** the player doesn't just die, they **turn**. Their body rises as a zombie that keeps their look, clothes and gear.
- Teammates can bring them back **only with a cure**: subdue the turned player (cripple / restrain — don't destroy the head), then administer a cure dose. The player revives as themselves, with their character and skills.
- If the turned player is killed (head destroyed) or wanders off and is lost, the death becomes permanent.
- Because a cure is one dose for one person and only made at a Research Facility, saving a friend is a major expedition.
- Deaths from anything else (bleeding out, falls, bites that kill outright, PvP) are permanent.

---

## 13. Multiplayer

- v1: co-op, 1–8 players, browser-hosted.
- Later: PvP as a host option, dedicated servers, bigger player counts.

---

## 14. Controls & UI

### Controls
| Platform | Scheme |
|---|---|
| PC | WASD + mouse; Shift sprint, C crouch, Space jump/vault, E interact, Tab inventory, **V first/third-person**, 1–6 hotbar, M map, N notebook |
| Gamepad | Standard twin-stick layout, radial menu for hotbar |
| Phone (landscape) | Floating left stick (push to edge = sprint), drag right half to look, context buttons on the right (attack, aim, interact, crouch, reload) that change with what you're holding, optional **gyro aiming**, light aim assist, tap highlighted objects to interact |

### HUD: minimal, the world comes first
- **Compass strip** at the top (marks, teammates, sounds you heard).
- **Hotbar** (4–6 slots) at the bottom.
- **Needs and injuries only appear when they matter** (low hunger, bleeding, infected).
- **Noise ring** around the crosshair shows how loud you are.
- **Map is an item:** you start knowing nothing; exploring fills it in, and **finding a regional map** reveals that region. Mark it up, and co-op teammates can share markers.
- Inventory: grid screen (drag, rotate, split stacks) — same on touch.
- Accessibility: colour-blind palette swap, text size, subtitles, hold-vs-toggle options.

---

## 15. Starting a new game

### World creation (host)
- Seed (random or typed), size (**16 km** / **32 km Large World**)
- Death mode (§12), co-op (PvP later)
- Difficulty preset: **Casual / Normal (the middle tone, default) / Hardcore**, with advanced sliders: zombie density, regrowth speed, needs speed, loot amount, infection
- **Creative mode** toggle

### Character creation
- Body sliders (sex/weight/height/muscle shape keys), face, hair, skin tone, clothing colours.
- **Background** gives small skill head starts (never blocks): Mechanic, Nurse, Carpenter, Farmer, Police Officer, Hunter, Electrician, **Pilot** (starts able to fly).

### First minutes
- You wake in a house in the **Suburbs** on Day 1 of the outbreak; an emergency broadcast plays on the radio.
- **No tutorial level.** Instead, an optional **survival journal** suggests first goals (find food & water, a weapon, secure the house, build a bench) and **contextual hints** pop up the first time you meet something (first bench, first zombie, first car). Both can be turned off.

---

## 16. Code architecture

### Principles
- **Data-driven:** items, recipes, regions, loot tables, zombie types, vehicles and buildings live in JSON/data files. Changing the game is mostly editing data, which keeps everything swappable (and moddable later).
- **Shared simulation:** one TypeScript simulation package runs on the server and on clients (prediction).
- **Deterministic generation:** seeded RNG everywhere; the world rebuilds from the seed + saved changes.
- **Off the main thread:** world generation, chunk meshing, pathfinding run in Web Workers.

### Building blocks
| Concern | Choice |
|---|---|
| Game objects | ECS (entity-component-system), e.g. bitECS |
| Physics | Rapier (WASM): vehicles, ragdolls, collisions |
| Pathfinding | Per-chunk navmesh (recast-navigation, WASM) for individuals + flow fields for hordes |
| Rendering | Three.js WebGPU/WebGL2, instancing, LOD/HLOD, quality tiers |
| UI | Lightweight DOM UI (e.g. Preact) over the canvas |
| Network | Binary snapshot + delta protocol, interest management by cell; WebRTC host for v1 |
| Saves | Seed + delta log, IndexedDB in browser, files on dedicated servers |

### Repo layout
```
zombros/
  DESIGN.md
  packages/
    shared/     simulation: ECS, rules, worldgen, crafting, net protocol
    client/     Three.js rendering, input, UI, audio
    server/     dedicated/headless host (Bun)
  content/      game data: items, recipes, regions, loot, zombies, vehicles (JSON)
  assets/
    pipeline/   Blender Python: base_human, stylize, generators/, export
    source/     .blend + raw AI output (heavy files git-ignored)
    build/      exported GLB + manifest
  tools/ai/     local AI model setup (weights git-ignored)
```

---

## 17. Roadmap

Each milestone ends with something playable in the browser.

| # | Milestone | Done when |
|---|---|---|
| M0 | **Foundations** | Repo + contracts (skeleton, palette, slots, manifest, scale grid); auto-deploy to a free static host |
| M1 | **Walk the world** | Streamed terrain chunks, FP/TP controller, day/night lighting, phone + PC + gamepad controls |
| M2 | **First bite** | Walkers (capsules), melee, hit zones, noise & stealth, cell population system |
| M3 | **Together** | 2–8 player co-op in the browser (WebRTC host), prediction, synced zombies |
| M4 | **Scavenge** | Generated towns from the modular kit, enterable interiors, loot tables, grid inventory, needs, infection |
| M5 | **Home** | Building, Bench Tinkering crafting + stations, safehouse claim, saves, all death modes |
| M6 | **Roads** | Land vehicles: bikes → cars → trucks; fuel, keys/hotwire, damage |
| M7 | **The world** | All regions + landmarks, special zombies, events, horde migration, full 16 km map |
| M8 | **Sky & sea** | Boats, planes, helicopters |
| M9 | **The cure** | Research Facility, cure synthesis, turned-player revive |
| M10 | **Polish** | Audio, UI polish, phone performance pass, 32 km Large World, trader NPC |
| Later | | Survivor + zombie models and animation (capsules until then), PvP, dedicated public servers, more NPCs |

**Vertical slice** (show friends) = end of M4: walk a generated town with friends, scavenge, fight, get infected.

---

## 18. Decisions log

### Decided
- Browser-first, TypeScript + Three.js; completely **free**.
- Map: **16 × 16 km default**, **32 × 32 km Large World**.
- Middle tone with Casual/Hardcore presets; FP default + third-person toggle.
- Grid inventory, no weight limits.
- Crafting: simple + nested, "Bench Tinkering" (§9a).
- Three death modes + co-op infection revive (§12).
- Cure: Research Facility only, one dose heals one person.
- Our own assets only — no packs for humans, animations or clutter.

### Defaults (change any time)
- Clearing an area again doesn't lower it below 50 % (§4).
- A turned player can be cured until their zombie is killed.
- Hard-gated skills: flying (Pilot background or flight manual), base electrical wiring, engine rebuilds. Everything else only enhanced.
- Wildlife: yes, light: deer, rabbits, fish for food; wolves in Forest & Mountains.

### Later
- Human NPCs (at least a trader to barter with).
- Audio direction (last).
- PvP.
