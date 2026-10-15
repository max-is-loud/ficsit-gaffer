# Base-map renderer ([upstream #246](https://github.com/StuartMeeks/ficsit-foreman/issues/246))

> Status: **in progress — rendering end-to-end; committed tool.** A first-party, top-down base
> map of the *Satisfactory* world renders correctly: landscape relief, terrain colour, rock
> formations, the full water model, a geometrically-derived ocean/void boundary, and **flora**
> (alien coral + Titan-Forest trees, incl. instanced foliage). It also emits an **interactive,
> toggleable-layer** HTML artifact (the step toward the eventual rotatable/tiltable 3D layered
> map). The tool lives in the repo at `tools/sf-map-renderer/` and runs **offline** on the Windows
> host against a real game install via CUE4Parse. Remaining: the other tree species, per-mesh
> **textures**, and wiring the output into the interactive map ([upstream #64](https://github.com/StuartMeeks/ficsit-foreman/issues/64)) and [upstream #239](https://github.com/StuartMeeks/ficsit-foreman/issues/239) coastline. This
> document records the approach, the decode maths, every mechanism, and the diagnostic/override
> surface so the work can resume cold.
>
> **Ultimate goal (Stu):** a **3D, rotatable/tiltable** map with independently toggleable
> **layers** — topography, altitude shading, biomes, ground textures, mesh textures, resource
> nodes, collectibles, flora, … Every feature is built to be a separable layer, not baked into
> one flat image.

## Why this exists

The interactive map ([upstream #64](https://github.com/StuartMeeks/ficsit-foreman/issues/64)) and the biome/coastline work ([upstream #239](https://github.com/StuartMeeks/ficsit-foreman/issues/239)) need a base raster of the world:
a land/water/void mask plus relief and terrain colour. The obvious source — community maps
(SCIM and the "topological map") — is **licensing-encumbered** and is the very thing [upstream #246](https://github.com/StuartMeeks/ficsit-foreman/issues/246)
exists to avoid. So we derive everything from the shipped game assets ourselves: the cooked
landscape, the placed rock meshes, and the water-volume geometry. The pipeline is
**deterministic and topo-free** — no community asset is baked into the output. (A community
topo map was used *briefly* as a build-time oracle while classifying rock; it has since been
fully removed in favour of pure game geometry — see *Off-map cliff exclusion*.)

## Pipeline overview

All stages run offline against a game install. Outputs: the flat composite raster (`map.ppm`),
and — with `--layers` — a **surface** raster + an **object** raster + a per-cell class byte that
the `layers` command assembles into the interactive layered artifact.

1. **Decode the landscape heightmap** → a height grid in a world-cm frame.
2. **Colour the terrain** from the landscape material weightmaps.
3. **Null visibility holes** — cells masked by the landscape visibility layer become void.
4. **Raise "higher ground"** — rasterise placed rock/cliff meshes' tops into the height grid,
   tracking the **height-ranked topmost object** per cell (`objKind`).
5. **Raise flora** — rasterise coral + trees (individual + instanced foliage) as flora; split
   tree meshes into trunk vs foliage sections; compute a filled trunk cross-section per tree.
6. **Lay the water** — FGWaterVolume footprints (ocean + lakes) + BP_River ribbons +
   BP_Water ponds + a wet-sand-seeded shallow shelf.
7. **Classify ocean vs void** — a void cell is ocean iff it sits inside an ocean
   FGWaterVolume footprint (`volVoid`); everything else off-map is grey void.
8. **Exclude off-map junk** — a small, explicit list of enormous cliff meshes placed beyond
   the playable edge, removed by mesh-name + origin.
9. **Render** — compute a full **surface** colour (land/water/void, hillshaded on the bare
   landscape) and a separate **object** colour (rock/coral/foliage on the object height), so
   layers can reveal the ground beneath an object; the flat composite is surface + object.

## 1. Landscape decode (the crux)

The world's ground surface is a UE5.6 `Landscape`: **2289 `LandscapeComponent`s** across
**~125–149 `LandscapeStreamingProxy`** cells (plus a parent `Landscape` actor). Each component
is a **128×128** vertex tile (`ComponentSizeQuads = 127`, `NumSubsections = 1`) placed by its
`SectionBaseX/Y`. Stitching = lay each 128×128 tile on the section grid.

- Height data lives in `LandscapeComponent.HeightmapTexture` — a `PF_B8G8R8A8` `UTexture2D`,
  128×128, 65 536 bytes. `GetFirstMip()` resolves real bytes because CUE4Parse ships
  `ULandscapeTextureStorageProviderFactory`, which handles UE5.6's compressed landscape-texture
  storage. Height is encoded across two channels: `h16 = (R << 8) | G` (byte order for
  PF_B8G8R8A8 is `{B,G,R,A}` = indices `{0,1,2,3}`; the decode reads `hd[p+2] << 8 | hd[p+1]`).
- **Height in cm:** `Z = ACTOR_Z + (h16 − ZMID) · ZSCALE · SCALE` with `ACTOR_Z = 100`,
  `ZMID = 32768`, `ZSCALE = 1/128`, `SCALE = 100`. (An earlier `ZADJ` "+51" correction was a
  **mis-diagnosis** and is reverted to 0 — see *Water model → ocean unify*. All 125 proxies have
  a uniform `rootLoc.Z = 100`, `scale.Z = 100`, so there is no per-proxy Z variation.)
- **Collision heights are stripped** from the cooked build
  (`LandscapeHeightfieldCollisionComponent.CollisionHeightData` is absent) — the texture is the
  only source, hence the decode above is load-bearing.

## 2. World alignment (coordinate frames)

The landscape sits in the same world-cm frame as collectibles and biomes ([upstream #239](https://github.com/StuartMeeks/ficsit-foreman/issues/239)), so alignment
is essentially free once the transform is right.

- **Proxy → world:** `worldX = ACTOR_X + SectionBaseX · SCALE`, `worldY = ACTOR_Y + SectionBaseY · SCALE`,
  with `ACTOR_X = ACTOR_Y = −50800`, `SCALE = 100` (1 quad = 1 m). Each proxy's root location =
  origin + its min `SectionBase` × 100. **The parent `Landscape` actor location
  `(−304800, 203200)` is a red herring — do not use it.**
- **Grid:** section X spans roughly `[−2540, 4445]`, Y `[−2540, 3429]`. A **`PADQ = 360`**-quad
  margin is added per side (`minSX = minSY = comps.Min − 360 = −2900`) so the map has an ocean
  frame and nothing clips. The output grid is downsampled by **`DS`** (default 8; standard
  render uses **`DS = 2`** → **3917 × 3409**).
- **Cell ↔ world (at DS = 2):** `worldX = −340800 + gx · 200`, `worldY = −340800 + gy · 200`
  (gx, gy are output-grid pixels). General form:
  `worldX = ACTOR_X + (minSX + gx · ds) · SCALE`.

## 3. Terrain colour (material weightmaps)

Each `LandscapeComponent` carries `WeightmapTextures` + `WeightmapLayerAllocations` (layer name
→ weightmap texture index + channel; channel byte order for PF_B8G8R8A8 maps `{R,G,B,A}` →
`{2,1,0,3}`). Per pixel we **weight-blend** the layers' palette colours (Sand/Dune → tan,
Grass → green, Forest/Jungle → dark green, Rock/Gravel → grey, Soil → brown) and multiply by a
NW hillshade. Weight-*blend* rather than dominant-pick avoids speckle. The result matches the
real map (sand dunes in Dune Desert, etc.). Weightmap failure loses colour only, never height.

## 4. Landscape visibility holes → void

Cells painted with **`LandscapeVisibilityLayerInfo`** are masked out in-game — invisible
landscape, i.e. holes down to the caves. Their heightmap still carries (deep) data, so without
handling they render as deep terrain. In pass B, any cell with
`LandscapeVisibilityLayerInfo` weight ≥ **`VISTHRESH`** (128) has its height **nulled to 0**,
turning it into void. This cleaned up **~113 k cells** map-wide (e.g. the AB24 pit, −253 m,
ringed by +100 m terrain). Toggle with `--no-visibility-holes`.

## 5. Higher ground (rock meshes)

The landscape heightmap is the ground surface only; mesas, spires, cliffs and canyons are
separate placed `StaticMeshComponent`s. We rasterise their tops into the height grid.

- **Include filter:** mesh path contains **`/Environment/Rock/`** (subfolders Cliff, DesertRock,
  Boulder, Rubble, Arc, SmoothRock, DestructibleRock). Explicitly *excluded*: foliage
  (trees/coral/grass), DropPod, resource/fracking nodes, waterfalls, hot springs, caves,
  spaceship debris.
- Each instance is an individual (non-instanced) component with **absolute** `RelativeLocation`
  (world-cm) + `RelativeRotation` (FRotator) + `RelativeScale3D`. Mesh via
  `pi.ResolvedObject.Load()` → `UStaticMesh.RenderData.LODs[0]` (LOD0 = full detail, for smooth
  cliffs) `PositionVertexBuffer.Verts` + `IndexBuffer`. Each triangle is transformed
  (scale → UE `FRotationMatrix` → translate) and **z-buffered** into the grid via barycentric
  max-Z. Guards skip runaway triangles (grid-bbox span > 150 cells, or thin slivers). ~20.8 k
  instances, ~114 unique meshes.
- A cell is coloured rock-grey only where a formation rises **> ~3 m** above the landscape
  baseline (so scattered boulders add relief without greying everything).
- **Rocks draw *on top of* water.** Water is classified on `baseH` (a clone of the height grid
  taken *before* the rock/flora passes = the seabed), so submerged spires don't punch holes in
  the water; in the render an object cell (`objKind ≠ 0`) draws over the water branch. This is
  the Spire Coast archipelago.
- **Height-ranked topmost object (`objKind`).** As each rock/coral/tree triangle sets a new max
  height above the colour threshold, the cell records that object's category (1 rock · 2 coral ·
  3 tree). So where objects overlap, the **taller** one wins per cell — a rock over a shorter
  coral, a canopy over a trunk — which is the render/layer z-order.

## 6. Flora (coral & trees)

The landscape + rock passes miss the conspicuous alien flora — the "mushroom/coral" landmarks and
the giant Titan-Forest trees. These are placed both as individual `StaticMeshComponent`s **and** as
**instanced foliage**, and are rasterised the same way as rocks (tops z-buffered into the height
grid), tagged `kind` 1 = coral · 2 = tree.

- **Include filter** (`--flora`, default `/Environment/Foliage/,/Environment/Bush/` = **all flora**;
  `--flora off` disables): every mesh under `/Foliage/` (Coral, all `/Trees/` species, Grass,
  Flowers, `/SmallFoliage/` ferns/bushes/roots) plus the large `/Environment/Bush/` bushes.
  A `/Coral/` segment → coral; everything else → tree. ~2.6M instances, ~2 min full-res. Narrow
  with e.g. `--flora "/Foliage/Trees/,/Environment/Bush/"` for a trees-only map.
- **Instanced foliage.** The bulk of flora has **no** `RelativeLocation` — transforms live in the
  serialized instance buffer of a `UInstancedStaticMeshComponent`, whose `PerInstanceSMData` carries
  per-instance `FTransform`s. Two sources, two world-position formulas:
  - *Stock* `FoliageInstancedStaticMeshComponent`: position = `TranslatedInstanceSpaceOrigin` (a
    UProperty FVector) **+** the instance `.Translation`.
  - *Satisfactory's* `FGFoliageInstancedSMC` (the ~3.3 M-instance bulk — most trees, all small
    foliage): position = the owning `InstancedFoliageActor` cell offset (the actor RootComponent
    `RelativeLocation`, via `AttachParent`) **+** the instance `.Translation`. See
    [base-map-foliage-decode.md](./base-map-foliage-decode.md).

  Rotation = `.Rotation.Rotator()`; scale = `.Scale3D`. **HLOD** components
  (`HLODInstancedStaticMeshComponent`) are skipped — they are 1:1 low-detail proxies of the real
  instances and would double-plant.
- **Colour threshold.** Flora canopies droop to the ground at the rim, so a 3 m cut trims them to a
  core; flora uses its own low cut **`FLORAH`** (default 50 cm) so the full canopy colours. Coral
  renders at true scale (e.g. `SM_CoralTree_02` is 34 m × 2.5 = ~86 m).
- **Trunk vs foliage** (`--tree-part` = `trunk` | `foliage` | `both`, default both). Tree meshes
  are one static mesh with separate **material sections** — bark/trunk vs leaf/branch. `GetMesh`
  classifies each LOD0 section by material **basename** (keywords leaf/branch/liana/ivy/frond/
  mushroom/canopy → foliage; else trunk — must use the *basename*, not the full path, or the
  `/Foliage/` folder falsely matches everything).
- **Trunk cross-section (filled disc).** A trunk mesh is a hollow tube, so rasterising its wall
  gives a *ring*. Instead, per tree, find the highest ground point the trunk footprint touches,
  take a horizontal **slice** of the trunk-section vertices at **`TRUNKBAND`** (default 250 cm)
  above it, and **fill** the disc enclosing the slice (radius = 75th-pctile of the ring, capped).
- **Placeholder colours** (per-mesh textures are the next step): coral `(205,116,104)`, tree
  foliage `(70,120,74)`, trunk `(120,82,52)`, rock `(143,135,122)`.

## 7. Water model

The full water stack, in order (all off `baseH` = seabed, pre-rock):

- **FGWaterVolume BSP faces (ocean + lakes).** Each `FGWaterVolume` root is a `BrushComponent`
  whose `Brush` is a `UModel`; `.Points` (verts), `.Nodes` (convex BSP faces), `.Verts`
  (`pVertex` → Points index) are populated in the cooked build. Each face's verts transform by
  the component (loc + yaw + scale) → a world-XY polygon with `surfZ = maxZ`. Rasterise every
  face (bbox + point-in-poly); the union of a volume's convex faces = its exact concave
  footprint. A cell is water where the **seabed** (`baseH`) is at/below `surfZ`. 269 volumes →
  5342 faces. Captures ocean, lakes, and high-altitude crater/plateau lakes at true heights;
  below-sea *dry* land (held by a coastline) is never flooded because no volume sits over it.
- **Ocean unify.** The game ships the sea as ~32 deep FGWaterVolumes with `surfZ` staggered
  **−1635 … −1815** (invisible physics volumes; the *visible* water is one uniform mesh). Every
  sea-band volume (`surfZ` in −1850 … −1600, `oceanBand`) is snapped to a single
  **`OCEANZ = −1755`** so the shoreline has no authoring-noise steps. Lakes (`surfZ > −1600`) are
  untouched. −1755 is the game's modal ocean value; it was calibrated against Stu's in-game
  waterline measurements (gentle Spire Coast slopes are sensitive to the level; steep west coast
  barely moves).
- **BP_River ribbons.** Rivers are `BP_River_PROT_C` actors whose `RootComponent` is a
  `SplineComponent` carrying the world transform; `mSplineMeshComponents` each deform
  `SM_RiverPlane` along a segment with a `SplineParams` struct (Start/End Pos + Tangent in the
  local frame, Start/End Scale where `.X` = cross-stream width). We cubic-Hermite-sample each
  segment's centreline, transform to world, and stamp a disc ribbon of half-width
  `RIVERW (200) × scaleX` wherever terrain ≤ `surfZ + RIVERTOL (400)`. Toggle `--no-rivers`.
- **BP_Water ponds.** Small shallow bodies with a visual `WaterSurface` plane but no
  FGWaterVolume — a footprint fill clipped to terrain ≤ surface, only where not already ocean.
- **Wet-sand shallow shelf.** The landscape mesh continues underwater past the shoreline, so
  meshed below-sea terrain reads as land up to the mesh edge. The game's own submerged signal is
  the **`WetSand`/`Puddles`** material. Seed = shallow WetSand/Puddles cells, then **BFS-spread
  through connected shallow below-sea terrain** (any material) within a depth cap. Coral/sand
  shelf fills only where a wet seed reaches it, so isolated inland coral and deep crater walls
  stay dry. Tunables: `--wet-sea` (−1755), `--wet-rise` (0), `--wet-deep` (500 cm cap), `--wet-threshold` (50).
  `--no-wet-sand` disables.

### Ocean vs void — the classifier that matters

Past the coast, "ocean-blue" vs "grey void" is **not** derivable from distance or from the
landscape mesh edge (the game authors no crisp boundary out there — the visible distant ocean
is just two enormous `SM_GEN_WaterPlane` meshes parked over the S/SE, plus skybox). An earlier
heuristic — `seaVoid`, blue for border-connected void within R=300 cells of a real ocean cell —
both over-reached and under-reached and was abandoned.

**The correct signal is FGWaterVolume membership.** A void cell (no seabed, `baseH == 0`) is
ocean **iff it falls inside an ocean-band FGWaterVolume footprint**. Implemented as the
**`volVoid`** mask: during the volume rasterise, void cells inside an ocean-band volume are
flagged (instead of skipped); the render paints `volVoid` blue and all other off-map void grey.
This is deterministic, topo-free game geometry, verified against ground-truth cells (cells
inside `FGWaterVolume107/32` render blue; cells inside no volume render grey). It also fixed the
long-standing north-edge-above-Spire-Coast blue bleed for free.

- **`BLUEBOX` override.** The far-west frame **margin** (grid cols A–B + C33/C34) is west ocean
  that the FGWaterVolume footprints don't quite reach. A small list of world-XY rectangles forces
  those void cells blue — the one honest exception layered on top of the geometric classifier
  (default covers ~599 k cells in the west margin).

## 8. Off-map cliff exclusion

Beyond the playable landscape edge the game places enormous decorative cliff meshes (the
"Abyss Cliffs" formations, north/east/SE cliff walls). Top-down they read as junk landmasses
floating in the void/ocean. **Every general rule to remove them failed**, because each fails on
a real case:

- *waterline* (keep only above-sea rock): real below-sea land south of Grass Fields breaks it;
- *outerVoid / fringe / connectivity*: either clip the coast or keep the Abyss masses;
- *kill-boxes* (drop rock in a world-XY region): too blunt, and by-origin they miss because a
  mega-cliff's **origin sits a grid-column away from its footprint**.

**Settled approach: exclude specific mesh *instances* individually.** Each off-map landmass is
only a handful of mega-meshes. The enabling tool is the **`ROCKAT`** footprint probe: point it
at a rendered cell and it reports exactly which instances rasterise there (mesh @ origin, z,
scale). Add those to **`ROCKEXCLUDEAT`** (`"MeshName@x,y;…"`, matched within ±100 m of the
origin), which drops just that placement — other placements of the same mesh are untouched
(critical: `CliffFormation_05` alone has 544 placements). The current default list holds ~15
instances (CliffFormation_05, CliffPillar_01, CaveSplitter_01) covering the east column, SE
corner, bottom strip, and north edge. All other rock is rendered — per-instance exclusion is the
only clip (the earlier topo/geometry clip-mode masks have been removed).

## 9. Layered output & the interactive artifact

The endgame is a layered map, so the renderer keeps the surface and the objects **separable**
rather than baking one flat image. With **`--layers`** it emits, alongside the flat `map.ppm`:

- **`map.surf.ppm`** — the base **surface** colour for *every* cell (land / water / void),
  hillshaded on the bare **landscape** (no rocks/flora). Because it is full, hiding an object
  reveals the ground beneath.
- **`map.obj.ppm`** — the **object** colour (rock / coral / foliage), hillshaded on the object
  height, only where an object is topmost.
- **`map.layers`** — one byte per cell: bits 0–1 `sClass` (0 void · 1 water · 2 land), bits 2–3
  `objKind` (0 none · 1 rock · 2 coral · 3 foliage), bit 4 = trunk-disc present.

The **`layers`** command reads those three files and builds the self-contained interactive HTML artifact:
one transparent PNG per layer (`ground`/`water`/`void` from the surface raster, `rocks`/`coral`/
`foliage` from the object raster, `trunks` as flat discs) plus biome-outline / biome-name / grid
overlays, stacked by height-ranked z-order with a **checkbox per layer** and **pan/zoom** (scroll
to zoom to cursor, drag to pan). It reads the canonical `packages/sf-game-data/data/biomes.json`.
Layers: Void · Water · Ground · Coral · Rocks · Tree trunks · Tree foliage · Biome edges ·
Biome names · Grid (A1–AN34). Each layer is its own PNG, so touching one layer only re-emits that
PNG and rebuilds the (tiny) HTML.

> Layer model note: layers are **height-ranked won-cells** — each cell shows its single topmost
> object, so hiding a layer reveals the *surface* beneath, not the next object down. True
> per-pixel multi-depth compositing is the natural fit for the eventual 3D (canvas/WebGL) version.

## The offline tool (`sf-map-renderer`)

A single **C#-only** console program (CUE4Parse + `EGame.GAME_UE5_6`), committed at
**`tools/sf-map-renderer/`**. It builds/runs **only on the Windows game host** (`ssh winbuild`); the
VM has no game files (see the dev-environment note in `AGENTS.md`). It needs the CUE4Parse clone at
`packages/sf-game-data/extract/CUE4Parse/` (same as the extractor) + the Oodle DLL from the game
install. The imaging that used to live in the Python companions (`overlay.py`/`layers.py`, Pillow +
numpy) is now done in-process with **SixLabors.ImageSharp** (the Apache-2.0 line: ImageSharp 2.x +
ImageSharp.Drawing 1.0), with the Lato label font embedded in the assembly. See the tool's
`README.md` for the build/run details and the full project layout.

- **Build:** `dotnet build sf-map-renderer.slnx -c Release`.
- **Command surface** (Spectre.Console.Cli; `--help` on each): `render` (the base map), `overlay`
  (the labelled review image), `layers` (the interactive layered artifact), and `probe <name>` (a
  standalone diagnostic survey).
- **Inputs:** `--paks` / `--usmap` (default a Steam install; also honour `SF_PAKS` / `SF_USMAP`).
- **Output:** `map.ppm` (+ the `--layers` rasters above) and `map-bounds.txt`, to the working
  directory; `overlay <map.ppm>` adds `<name>_labeled.png` / `_embed.jpg` (the **40 × 34** grid,
  cols A–Z then AA–AN, + biome outlines/names); `layers` writes `map-layers.html`.

### Render options (were environment variables)

Every former environment variable is now a typed `render` option with the same default, so a bare
`render` reproduces the old default render exactly:

| Option | Default | Was | Purpose |
|---|---|---|---|
| `--paks` / `--usmap` | Steam install | `SF_PAKS`/`SF_USMAP` | CUE4Parse inputs |
| `--downsample` | 8 | `DS` | output downsample (use **2** for full-res 3917×3409) |
| `--z-adjust` | 0 | `ZADJ` | landscape Z offset (leave 0 — the "+51" was a mis-diagnosis) |
| `--no-rocks` | off | `ROCKS=0` | skip the rock/flora higher-ground pass |
| `--rock-exclude` | ~15 instances | `ROCKEXCLUDEAT` | per-instance exclusion list `"Mesh@x,y;…"` |
| `--flora` | coral + TitanTree | `FLORA` | flora folders (path substrings; `off` disables) |
| `--flora-height` | 50 | `FLORAH` | flora colour-cut, cm above landscape |
| `--tree-part` | both | `TREEPART` | tree sections — `trunk` \| `foliage` \| `both` |
| `--trunk-band` | 250 | `TRUNKBAND` | trunk-disc slice height, cm |
| `--layers` | off | `LAYERS=1` | also emit `map.surf.ppm` + `map.obj.ppm` + `map.layers` |
| `--ocean-z` | −1755 | `OCEANZ` | unified sea level for ocean-band volumes |
| `--blue-box` | west margin | `BLUEBOX` | force void cells ocean-blue in world-XY rectangles |
| `--no-visibility-holes` / `--visibility-threshold` | off / 128 | `VISHOLE`/`VISTHRESH` | null landscape-visibility holes to void |
| `--no-rivers` / `--river-width` / `--river-tolerance` | off / 200 / 400 | `RIVERS`/`RIVERW`/`RIVERTOL` | BP_River ribbon stamping |
| `--no-wet-sand` / `--wet-sea` / `--wet-rise` / `--wet-deep` / `--wet-threshold` | off / −1755 / 0 / 500 / 50 | `WETWATER`/… | wet-sand shallow shelf |
| `--sea-level` | −1646 | `SEA` | ocean surface Z for the land colour ramp + bounds sidecar |

### Diagnostic probes

Probes that ride on a render are `render` options that early-return with a report instead of writing
the map (unless noted):

- **`--probe-xy "x,y;…"`** — per world-coord: rockTopZ, seabedZ, isRock, isOcean, isLake, waterZ,
  oceanVoid, volVoid, and a `render=` prediction. The first-reach land/water/void diagnostic.
- **`--rock-at "x,y,label;…"`** — which instances rasterise onto each target cell (mesh @ origin, z,
  scale); traces a rendered landmass to the meshes to exclude. Runs as part of a full render.
- **`--layer-at "x,y;…"`** — per-cell weightmap dump (material layers + weights). Runs during a render.
- **`--cells "J4,H3,…"`** — land/sea/lake/void percentages of named cells (a 20 × 17 lettered grid).
- **`--z-test`** (+ `--world-locations`) — decoded Z vs each collectible's true Z (mean offset).

Standalone surveys are **`probe <name>`**: `meshes`, `landscape-layers` (was `MODE=layers`), `proxy`,
`floradump`, `meshinspect`, `meshsections`, `volat` (`--at`), `objectsat`
(`--at`/`--radius`/`--list`/`--mesh`/`--all`), `voldist`, `voldump`, `oceandump`, `oceanmesh`,
`riverdump`, `pickupdump` (`--at`/`--radius`), `nearwater` (`--at`), `sealevel`.

## Open items / next steps

- ~~**Refactor `Program.cs`**~~ **done** — `fg-hprobe`'s single ~1830-line `Program.cs` plus its
  Python companions are now the C#-only **`sf-map-renderer`** solution: pass A/B, higher-ground, the
  water model, shading and output split into single-responsibility classes behind a Spectre command
  surface, with the Pillow/numpy overlays ported to ImageSharp. Renderer + probe outputs were
  verified byte-identical to the pre-refactor baseline.
- **The other tree species** — fold Kapok/DioTree/GreenTree/BluePalm/Bamboo/… into `FLORA` for
  full forest canopy (denser + slower, same proven path).
- **Per-mesh textures** — replace the placeholder flora/rock colours by sampling each mesh's
  material/texture for a realistic top-down look (a layer in its own right).
- **Wire the output into [upstream #64](https://github.com/StuartMeeks/ficsit-foreman/issues/64)** (interactive map base layer) and the **[upstream #239](https://github.com/StuartMeeks/ficsit-foreman/issues/239)** coastline; decide the
  shipped output format (rasters vs a land/water/void mask + relief).
- **True per-pixel multi-depth compositing** for the rotatable/tiltable 3D layered map (canvas/
  WebGL), superseding the won-cells layer model.
- Any remaining off-map landmasses are handled the same way: name the cells → `ROCKAT` →
  add to `ROCKEXCLUDEAT`.

## Related

- Decode/alignment share the world-cm frame with the **biome overlay ([upstream #239](https://github.com/StuartMeeks/ficsit-foreman/issues/239))** and collectibles.
- The offline-extractor host mechanics mirror the **single-producer pipeline
  (`sf-game-data-extractor`, [upstream #164](https://github.com/StuartMeeks/ficsit-foreman/issues/164))** — same `ssh winbuild` CUE4Parse setup.
