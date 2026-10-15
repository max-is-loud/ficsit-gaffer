# Game-data extractor (`sf-game-data-extractor`)

The one-off tool that generates
[`packages/sf-game-data/data/<channel>/sf-game-data.json`](../data/stable/sf-game-data.json)
— the static dataset of every fixed collectible and resource node in the
Satisfactory world (coordinates, resource type, purity).

It is three projects (see [`../../../docs/sf-game-data-extractor.md`](../../../docs/sf-game-data-extractor.md)):

- **`sf-game-data-extraction/`** — a class library holding the CUE4Parse world
  extraction (`WorldExtractor.Extract`). This was the standalone `fg-extract`
  program, repackaged as a library ([upstream #158](https://github.com/StuartMeeks/ficsit-foreman/issues/158)).
- **`sf-game-data-parse/`** — a **CUE4Parse-free** class library: the `en-US.json`
  parser. Ported 1:1 from the original hand-written TypeScript parser (validated at
  port time by a golden-diff against it, [upstream #159](https://github.com/StuartMeeks/ficsit-foreman/issues/159)) and **became the canonical parser**
  when the TypeScript one was retired ([upstream #162](https://github.com/StuartMeeks/ficsit-foreman/issues/162)). Zero dependencies, so it builds and
  runs anywhere.
- **`sf-game-data-extractor/`** — the console tool you run. Extracts the world data
  (via `sf-game-data-extraction`) **and** parses `en-US.json` (via
  `sf-game-data-parse`), writing one merged `sf-game-data.json`: the world fields
  plus a top-level `gameData` object, with `gameVersion`/`build` stamped in ([upstream #160](https://github.com/StuartMeeks/ficsit-foreman/issues/160)).
  The runtime loads this file directly ([upstream #161](https://github.com/StuartMeeks/ficsit-foreman/issues/161)).

It reads coordinates straight out of the **packaged game level files** with
[CUE4Parse](https://github.com/FabianFG/CUE4Parse), using the `FactoryGame.usmap`
mappings Coffee Stain ships in the game's `CommunityResources/`. Only factual
coordinates are written out — no game assets are redistributed.

> **The extraction is host-only, run-by-hand.** The CUE4Parse projects
> (`sf-game-data-extraction` / `sf-game-data-extractor`) are C#, need a local
> Satisfactory install and a C++ toolchain to build CUE4Parse's native library,
> and are deliberately **not** part of the npm workspaces, the TypeScript build,
> lint, or CI — they only run when the game updates. (The `sf-game-data-parse`
> projects are CUE4Parse-free and build anywhere.)

## Why CUE4Parse isn't vendored

CUE4Parse is ~36 MB / 4,000+ files with its own native git submodule and licence.
We changed exactly **one thing** in it, captured in
[`cue4parse-optional-property.patch`](./cue4parse-optional-property.patch). So we
keep CUE4Parse external (clone + patch) and vendor only our extractor + the patch.

### The patch, in one sentence

Coffee Stain's shipped `FactoryGame.usmap` serialises `OptionalProperty` **without**
an inner-type byte. CUE4Parse's `UsmapProperties.ParsePropertyType` assumes one and
reads it, which misaligns and derails the parse of every property after the first
`OptionalProperty` (~byte 1.27 M of the decompressed mappings). The patch makes
`OptionalProperty` a terminal type — no inner read. (Array/Set/Map/Enum genuinely
do carry inner types and are left untouched.) Verified by hex-dumping the
decompressed mappings: with the fix, the bytes decode as a clean run of
`OptionalProperty` properties followed by a well-formed struct header.

This is a **local workaround for this specific usmap**, not a proven general fix —
see "Upstreaming" below.

## Prerequisites (Windows host with the game installed)

- **Satisfactory** installed (the dataset is read from its `Paks` + the shipped
  `CommunityResources/FactoryGame.usmap`).
- **.NET 10 SDK**.
- **Visual Studio** with the **"Desktop development with C++"** workload — CUE4Parse
  builds its native `CUE4Parse-Natives` library via CMake/MSVC at build time.
- Oodle: downloaded automatically at runtime by `OodleHelper.DownloadOodleDll()`.

## Regenerating the dataset

1. **Clone CUE4Parse** as a sibling of `fg-extract`, at the pinned commit, with
   submodules:

   ```powershell
   cd packages/sf-game-data/extract
   git clone --recursive https://github.com/FabianFG/CUE4Parse.git
   cd CUE4Parse
   git checkout 024b005c4d15e8082ecebfb202700d59bb6113c0
   git submodule update --init --recursive
   ```

   (`sf-game-data-extraction.csproj` references `..\CUE4Parse\CUE4Parse\CUE4Parse.csproj`.)

2. **Apply the patch** from the CUE4Parse repo root:

   ```powershell
   git apply ..\cue4parse-optional-property.patch
   ```

   If a newer CUE4Parse has drifted and the patch won't apply, make the change by
   hand — it's the one edit described under "The patch" above.

3. **Build & run** from a Visual Studio Developer PowerShell (so MSVC/CMake are on
   PATH for the native build). The game engine is **UE 5.6** (`EGame.GAME_UE5_6` in
   `WorldExtractor.cs`) — bump this if a future Satisfactory moves to a new engine.

   The tool extracts world data (CUE4Parse) **and** parses `en-US.json`, writing one
   merged `sf-game-data.json` (the world fields plus a top-level `gameData` object).
   Inputs come from `--flags` (preferred — no shell-quoting pitfalls), then
   environment variables, then defaults that point at a default Steam install:

   ```powershell
   cd packages/sf-game-data/extract/sf-game-data-extractor
   # --version/--build are stamped into the dataset; --build must not regress the
   # channel's current build (same build = re-extraction, allowed):
   dotnet run -c Release -- --version 1.2.3.1 --build 495413 --out sf-game-data.json
   # Optional overrides:
   #   --paks  "D:\...\Satisfactory\FactoryGame\Content\Paks"
   #   --usmap "D:\...\Satisfactory\CommunityResources\FactoryGame.usmap"
   #   --enus  "D:\...\Satisfactory\CommunityResources\Docs\en-US.json"
   ```

   `--version`/`--build` are stamped into the dataset header — **set them**, never
   hand-edit the resulting file's version. World output is deterministically ordered
   (counts alphabetical; `collectibles`/`resourceNodes` by `kind` then `id`) so a
   regenerated dataset diffs only on genuine world changes.

   It prints per-kind counts and writes `sf-game-data.json`. **Sanity check**: the
   collectible counts must read mercerSphere 298, somersloop 106, powerSlugBlue 596,
   powerSlugYellow 389, powerSlugPurple 257, hardDrive 118 — if any differs, the
   extraction is incomplete or the game changed.

4. **Install** the result into the channel you're updating, then commit it
   (`gameVersion`/`build` are stamped into the file itself — there is no separate
   `meta.json`):

   ```
   cp sf-game-data.json ../../data/stable/sf-game-data.json
   ```

   `.github/scripts/check-game-data.mjs` re-validates counts, version and build on
   the PR. A data PR touches only that one channel's `sf-game-data.json`.

## How the world is laid out (notes for future spelunking)

- **Collectibles** (`BP_WAT2_C` = Mercer Sphere, `BP_WAT1_C` = Somersloop,
  `BP_Crystal_C/_mk2_C/_mk3_C` = blue/yellow/purple slug, `BP_DropPod_C` = hard-drive
  pod) live in the World-Partition cells under
  `.../GameLevel01/Persistent_Level/_Generated_/*.umap`. Drop pods are split between
  the cells and the persistent level, so both are scanned and unioned by id.
- **Resource nodes** (`BP_ResourceNode_C`, `BP_FrackingSatellite_C`,
  `BP_FrackingCore_C`, `BP_ResourceNodeGeyser_C`) live in the base
  `Persistent_Level.umap`. The cells only hold the merged HLOD meshes
  (`NodeMeshActor_C`), whose `mNodeActor` points back to the real actor.
- Location = `RootComponent.RelativeLocation` (Unreal units / cm). Resource =
  `mResourceClass` → trailing `Desc_*_C`. Purity = `mPurity` (`RP_Inpure`/`RP_Pure`;
  **absent means Normal** — the unversioned default is omitted; the game misspells
  impure as "Inpure").
- Each collectible carries a `guid` (32 hex chars, the four FGuid uint32s in file
  order): `mItemPickupGuid` for pickups (spheres/sloops/slugs), `mDropPodGuid` for
  hard-drive pods. This is the key a *save* records when a collectible is collected
  (`FGScannableSubsystem.mDestroyedPickups` / `mLootedDropPods`), so the save-game
  MCP can compute exact, per-actor collected status at any progression by GUID match.

## Upstreaming the fix

Worth considering, but **not a blind PR**: our patch removes the inner-type read for
`OptionalProperty` entirely, which would regress any usmap that *does* encode one.
The right contribution is the **diagnosis** — open a CUE4Parse issue with the hex
evidence and ask whether `OptionalProperty` should carry an inner type at all (and if
so, why CSS's usmap omits it / whether it's usmap-version-gated). A safe PR can follow
once the maintainers confirm the correct, general behaviour.
