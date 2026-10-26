# Bridge v2 Part 1 spike: change signals on the dedicated server

Throwaway probe on the starter plugin's local `spike/bridge-v2` branch (commit
`f842ef1`, never merged), built from this repository's `mod/` at
`feature/bridge-v2-spec` plus `Private/Spike/BridgeSpikeProbe.*`. Staged
2026-10-16 on the disposable CL513885 Linux server
(`~/projects/satisfactory-bridge-test`) with the SML-only Windows client; log
category `LogForemanBridgeSpike` in `evidence/server-current.log`. Log times are
UTC (2026-10-17), i.e. local time + 4 h. Every probe line reported `net=dedicated`.

**Status: in progress.** Only the rows marked *observed* have in-game evidence;
the rest are pending a further session or rest on header reading alone.

## How the hooks were installed

`SUBSCRIBE_METHOD_AFTER` for the non-virtual `SetRecipe`, and
`SUBSCRIBE_UOBJECT_METHOD_AFTER` for the virtual setters and `OnUseStop`. SML
(starter `Mods/SML/Source/SML/Private/Patching/NativeHookManager.cpp`) only uses
the class default object's vtable to *locate* the implementation, then patches
that function body with funchook, so every subclass that inherits the
implementation is hooked; an install failure is `Fatal`. The log confirms both:
`Spike hooks installed` at start-up, and the `AFGBuildableFactory`-installed
`SetIsProductionPaused` hook fired for a `Build_ConstructorMk1_C`. A hook that
stays silent therefore means the function was not called on the server.
Context7 (`/websites/ficsit_app_satisfactory-modding`, *hooking*) documents the
macros but not this detail; the SML source settles it.

## Findings

| Question | Evidence | Status |
| --- | --- | --- |
| `SetRecipe` hook fires | `01.33.26 Spike hook SetRecipe … recipe=Recipe_IronRod_C`, then `Recipe_FicsiteMesh_C` (01.33.29) and `Recipe_QuartzCrystal_C` (01.33.53); the after-read shows the new recipe each time | Observed |
| Recipe cleared → `recipe=None` | No `SetRecipe(None)` line in the session | Pending |
| `SetIsProductionPaused` signature and firing | Header: `virtual void SetIsProductionPaused( bool isPaused )` (`FGBuildableFactory.h:180`), no overrides. `01.33.40 … paused=1`, `01.33.41 … paused=0` | Observed |
| `mOnPendingPotentialChanged` / `mOnPendingProductionBoostChanged` | Header: dynamic multicast delegates without a building parameter, so they cannot be bound per buildable from C++ lambdas. Probe hooks `SetPendingPotential` / `SetPendingProductionBoost` and binds native `mOnCurrentPotentialChanged` instead | Header only |
| Clock slider drag | Construction calls both setters once (`01.33.14 SetPendingProductionBoost boost=1.000`, `SetPendingPotential(base) potential=1.000`); no slider drag was performed | Pending |
| Potential-inventory item delegates (shards, Somersloops) | Header: `OnItemAdded`/`OnItemRemoved` are dynamic and name the source inventory, so they cannot be bound per buildable | Header only; in game pending |
| Shard/Somersloop count read | Header: `GetPotentialInventory()` stacks + `UFGPowerShardDescriptor::GetPowerShardType` (`PST_Overclock` = `Desc_CrystalShard_C`, `PST_ProductionBoost` = `Desc_WAT1_C`); probe reads `shards=0 sloops=0` on a fresh machine | Read path works at zero; insert pending. Somersloops are not unlocked in this world |
| `OnUseStop_Implementation` fires on the server | No `Spike hook OnUseStop` line all session, although setting the recipe and pausing both require opening and closing the machine window. No factory class overrides it (`FGBuildable.h:263` only) | Observed: **does not fire** |
| Fresh build: config at construction vs +2 s | Hand-built Constructor: `constructed` and `settled+2s` identical (`recipe=None potential=1.000 boost=1.000 paused=0`) | Observed for a hand build; blueprint pending |
| Extractors: `GetExtractableResource()`, node, purity | Header: `Cast<AActor>(GetExtractableResource().GetObject())`, purity via `AFGResourceNode::GetResourcePurity`; no extractor in the world | Pending |
| Generator hierarchy (Coal, Fuel, Nuclear, Biomass) | Header: register `AFGBuildableGenerator` (GeoThermal is not `AFGBuildableGeneratorFuel`), fuel via `Cast<AFGBuildableGeneratorFuel>`; no generator in the world | Pending |

Baseline at start-up: `category=manufacturer count=8`, no other category present,
no unregistered factory classes logged.

## Decisions per change path

| Change path | Decision |
| --- | --- |
| Recipe | `SetRecipe` after-hook (verified) |
| Paused | `SetIsProductionPaused` after-hook (verified) |
| Player opens/closes a machine | Not used: `OnUseStop` does not fire on the dedicated server |
| Clock speed, Somersloop boost, shard/Somersloop items | Open: raised with the user (the planned safety net is gone) |
| Fresh build | Placement delegate + settle re-capture (kept; blueprint check pending) |
