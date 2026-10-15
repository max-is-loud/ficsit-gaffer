// Reads a Satisfactory install through CUE4Parse and extracts the world dataset: collectibles,
// resource nodes, loose crash-site parts, drop-pod unlock costs and project-assembly phase costs.
// It returns the dataset to its caller and writes nothing itself; Program.cs owns the output file.

using System.Text.RegularExpressions;
using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider.Usmap;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Objects;
using CUE4Parse.UE4.Objects.Core.Math;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Objects.UObject;
using CUE4Parse.UE4.Versions;

namespace SfGameData.Extraction;

/// <summary>Inputs for one world-data extraction run.</summary>
public sealed record ExtractOptions(string Paks, string Usmap, string GameVersion, int Build);

/// <summary>
/// The world dataset plus the project-assembly (space-elevator) phase deliverable
/// costs (#172 slice E). The latter is game data sourced from cooked assets — not the
/// Docs — so the caller attaches it under the merged file's <c>gameData</c>.
/// </summary>
public sealed record ExtractResult(object Dataset, List<object> ProjectAssemblyPhases);

/// <summary>
/// Reads a local Satisfactory install via CUE4Parse and writes the world-location
/// dataset — collectibles, resource nodes and loose crash-site parts. This is the
/// former standalone <c>fg-extract</c> program (#158): the extraction logic is
/// unchanged; only the entry shape moved — the env-var reads now live in the
/// calling tool and arrive via <see cref="ExtractOptions"/>.
/// </summary>
public static class WorldExtractor
{
    /// <summary>
    /// Runs the CUE4Parse world extraction and returns the dataset (gameVersion,
    /// build, source, counts, collectibles, resourceNodes, lootPickups) as an
    /// anonymous object ready to serialise. The caller owns output: the
    /// sf-game-data-extractor tool merges this with the parsed gameData and writes
    /// one file (#160).
    /// </summary>
    public static ExtractResult Extract(ExtractOptions options)
    {
        OodleHelper.DownloadOodleDll();
        OodleHelper.Initialize();

        var paks = options.Paks;
        var usmap = options.Usmap;
        var gameVersion = options.GameVersion;
        var build = options.Build;

var provider = new DefaultFileProvider(paks, SearchOption.TopDirectoryOnly, new VersionContainer(EGame.GAME_UE5_6));
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap);
provider.Initialize();
provider.SubmitKey(new FGuid(), new FAesKey(new byte[32]));
Console.WriteLine($"mounted. files = {provider.Files.Count}");

// Collectible classes, mapped to dataset kinds. The first six are GUID-keyed
// pickups in the _Generated_ cells (spheres/sloops/slugs) plus drop pods. The
// customizer pickups (helmet in a cell, music tapes in the persistent level) are
// SCHEMATIC-keyed instead — they carry no mItemPickupGuid; what they grant is a
// cosmetic schematic (mSchematic), so "collected" is read from the save's
// unlocked schematics rather than mDestroyedPickups.
var collectibleKinds = new Dictionary<string, string>
{
    ["BP_WAT2_C"] = "mercerSphere",     // 298 in assets — matches the known Mercer total
    ["BP_WAT1_C"] = "somersloop",       // 106 in assets — matches the known Somersloop total
    ["BP_Crystal_C"] = "powerSlugBlue",
    ["BP_Crystal_mk2_C"] = "powerSlugYellow",
    ["BP_Crystal_mk3_C"] = "powerSlugPurple",
    ["BP_DropPod_C"] = "hardDrive",
    ["BP_UnlockPickup_Customization_C"] = "helmet", // 1, in a cell; grants a Helmet schematic
    ["BP_TapePickup_C"] = "mtape",                  // 3, in the persistent level; grant Tape schematics
};

// Kinds keyed by the schematic they unlock rather than a pickup GUID.
var schematicKinds = new HashSet<string> { "helmet", "mtape" };

// Resource-node classes (live in the base Persistent_Level), mapped to dataset kinds.
var nodeKinds = new Dictionary<string, string>
{
    ["BP_ResourceNode_C"] = "resourceNode",
    ["BP_FrackingSatellite_C"] = "frackingSatellite",
    ["BP_FrackingCore_C"] = "frackingCore",
    ["BP_ResourceNodeGeyser_C"] = "geyser",
};

FVector? Loc(UObject e)
{
    var root = e.GetOrDefault<UObject?>("RootComponent");
    return root?.GetOrDefault<FVector>("RelativeLocation");
}

// The actor's stable GUID, as the save records it when the collectible is
// collected. Pickups (spheres/sloops/slugs) carry it as `mItemPickupGuid`
// (matched against FGScannableSubsystem.mDestroyedPickups); drop pods carry it
// as `mDropPodGuid` (matched against mLootedDropPods). Emitted as 32 uppercase
// hex chars (the four FGuid uint32s, in file order) so the save MCP can match it
// directly. Null when absent/zero (so the field is simply omitted).
string? GuidFor(UObject e, string kind)
{
    var g = kind == "hardDrive"
        ? e.GetOrDefault<FGuid>("mDropPodGuid")
        : e.GetOrDefault<FGuid>("mItemPickupGuid");
    if (g.A == 0 && g.B == 0 && g.C == 0 && g.D == 0) { return null; }
    return $"{g.A:X8}{g.B:X8}{g.C:X8}{g.D:X8}";
}

// The cosmetic schematic a customizer pickup grants (helmet/tape), as the save
// records it once unlocked. `mSchematic` is a class reference; we keep its
// trailing `Schematic_*_C` identifier, which the save MCP matches against the
// pioneer's unlocked schematics to compute collected status. Null when absent.
string? SchematicFor(UObject e)
{
    var raw = e.Properties.FirstOrDefault(p => p.Name.Text == "mSchematic")?.Tag?.GenericValue?.ToString();
    if (raw == null) { return null; }
    var m = Regex.Match(raw, @"\.([A-Za-z0-9_]+)'?$");
    return m.Success ? m.Groups[1].Value : null;
}

// Extract the trailing "Desc_X_C" class identifier from an object-reference property.
string? Ref(UObject e, string prop)
{
    var raw = e.Properties.FirstOrDefault(p => p.Name.Text == prop)?.Tag?.GenericValue?.ToString();
    if (raw == null) { return null; }
    var m = Regex.Match(raw, @"\.([A-Za-z0-9_]+)'?$");
    return m.Success ? m.Groups[1].Value : raw;
}

string Purity(UObject e)
{
    var raw = e.Properties.FirstOrDefault(p => p.Name.Text == "mPurity")?.Tag?.GenericValue?.ToString();
    if (raw == null) { return "normal"; }            // unversioned default is omitted
    if (raw.Contains("Inpure")) { return "impure"; } // game's enum spells it "RP_Inpure"
    if (raw.Contains("Pure")) { return "pure"; }
    return "normal";
}

// --- Helpers for loose crash-site parts + drop-pod unlock costs ---------------------

// Trailing class/asset identifier from a full object path, e.g.
// "/Game/.../Desc_Computer.Desc_Computer_C" -> "Desc_Computer_C".
static string? Trail(string? path)
{
    if (path == null) { return null; }
    var i = path.LastIndexOf('.');
    var s = i >= 0 ? path[(i + 1)..] : path;
    return s.TrimEnd('\'');
}

// The full object path an ObjectProperty points at (resolved), or null.
static string? ObjPath(UObject e, string prop)
    => (e.Properties.FirstOrDefault(p => p.Name.Text == prop)?.Tag?.GenericValue as FPackageIndex)?.ResolvedObject?.GetPathName();

// Unwrap a StructProperty value (an FScriptStruct wrapper) to its FStructFallback.
static FStructFallback? Struct(object? v) => v as FStructFallback ?? (v as FScriptStruct)?.StructType as FStructFallback;

static FStructFallback? StructProp(UObject e, string prop) => Struct(e.Properties.FirstOrDefault(p => p.Name.Text == prop)?.Tag?.GenericValue);

// --- Build a mesh -> item-descriptor map ----------------------------------------------
// A loose crash-site pickup (FGItemPickup_Spawnable) does not store its item class; the
// item is recovered from the static mesh the pickup displays, which is the item
// descriptor's `mConveyorMesh`. We build mesh-path -> Desc_*_C across all descriptors.
// Collisions (a mesh shared by several descriptors — mostly a solid item and its
// fluid/packaged twin) are resolved by preferring the SOLID form, then by name overlap.
Console.WriteLine("building mesh -> item map from descriptors...");
var meshCandidates = new Dictionary<string, List<(string item, bool fluid)>>();
var descFiles = provider.Files.Keys.Where(k =>
{
    if (!k.EndsWith(".uasset")) { return false; }
    var name = k[(k.LastIndexOf('/') + 1)..];
    return name.StartsWith("Desc_") || name.Contains("EquipmentDescriptor") || name.StartsWith("BP_ItemDescriptor");
}).ToList();
foreach (var f in descFiles)
{
    try
    {
        var cdo = provider.LoadPackage(f).GetExports().FirstOrDefault(x => x.Name.StartsWith("Default__"));
        if (cdo == null) { continue; }
        var mesh = ObjPath(cdo, "mConveyorMesh");
        if (mesh == null) { continue; }
        var item = cdo.Name.Replace("Default__", "");
        var form = cdo.Properties.FirstOrDefault(p => p.Name.Text == "mForm")?.Tag?.GenericValue?.ToString() ?? "";
        var fluid = form.Contains("LIQUID") || form.Contains("GAS");
        meshCandidates.TryAdd(mesh, new List<(string, bool)>());
        meshCandidates[mesh].Add((item, fluid));
    }
    catch (Exception ex) { Console.Error.WriteLine($"[desc] {f}: {ex.Message}"); }
}
var meshToItem = new Dictionary<string, string>();
foreach (var (mesh, cands) in meshCandidates)
{
    var solids = cands.Where(c => !c.fluid).Select(c => c.item).Distinct().ToList();
    var pool = solids.Count > 0 ? solids : cands.Select(c => c.item).Distinct().ToList();
    // Tie-break a genuine solid-vs-solid collision by name overlap with the mesh, then shortest name.
    var meshName = Trail(mesh) ?? mesh;
    meshToItem[mesh] = pool
        .OrderByDescending(it => SharedRun(meshName, it))
        .ThenBy(it => it.Length)
        .ThenBy(it => it, StringComparer.Ordinal)
        .First();
}
// Verified overrides: a few pickups use a dedicated "drop" mesh that differs from the
// item's mConveyorMesh and is referenced by no descriptor (matched by trailing mesh name).
var meshNameOverrides = new Dictionary<string, string>
{
    ["SM_Medkit_01"] = "Desc_Medkit_C",
    ["SM_RifleMag_Drop"] = "Desc_CartridgeStandard_C",
    ["SM_SuperCom_01"] = "Desc_ComputerSuper_C",
};
Console.WriteLine($"mesh->item: {meshToItem.Count} entries (+{meshNameOverrides.Count} overrides)");

// Length of the longest run of letters shared between two identifiers (case-insensitive),
// used only to break solid-vs-solid mesh collisions toward the best-matching descriptor.
static int SharedRun(string a, string b)
{
    a = a.ToLowerInvariant(); b = b.ToLowerInvariant();
    var best = 0;
    for (var i = 0; i < a.Length; i++)
        for (var j = 0; j < b.Length; j++)
        {
            var n = 0;
            while (i + n < a.Length && j + n < b.Length && a[i + n] == b[j + n]) { n++; }
            if (n > best) { best = n; }
        }
    return best;
}

string? ResolveItem(string? meshPath)
{
    if (meshPath == null) { return null; }
    if (meshToItem.TryGetValue(meshPath, out var item)) { return item; }
    var name = Trail(meshPath);
    return name != null && meshNameOverrides.TryGetValue(name, out var ov) ? ov : null;
}

// The drop-pod unlock cost (item and/or power), read from `mUnlockCost`. The CostType
// enum is omitted at its default value, so we read by the PRESENCE of the sub-fields:
// `ItemCost { ItemClass, Amount }` and/or `PowerConsumption` (MW). Null = free (no cost).
object? UnlockFor(UObject e)
{
    var uc = StructProp(e, "mUnlockCost");
    if (uc == null) { return null; }
    string? itemClass = null;
    var amount = 0;
    var itemCost = Struct(uc.Properties.FirstOrDefault(p => p.Name.Text == "ItemCost")?.Tag?.GenericValue);
    if (itemCost != null)
    {
        var ic = (itemCost.Properties.FirstOrDefault(p => p.Name.Text == "ItemClass")?.Tag?.GenericValue as FPackageIndex)?.ResolvedObject?.GetPathName();
        itemClass = Trail(ic);
        if (itemCost.Properties.FirstOrDefault(p => p.Name.Text == "Amount")?.Tag?.GenericValue is int a) { amount = a; }
    }
    int? powerMW = uc.Properties.FirstOrDefault(p => p.Name.Text == "PowerConsumption")?.Tag?.GenericValue is float f && f > 0
        ? (int) Math.Round(f)
        : null;
    var hasItem = itemClass != null && amount > 0;
    if (!hasItem && powerMW == null) { return null; }
    if (hasItem && powerMW != null) { return new { item = new { itemClass, amount }, powerMW }; }
    if (hasItem) { return new { item = new { itemClass, amount } }; }
    return new { powerMW };
}

var collectibles = new List<object>();
var collCounts = new Dictionary<string, int>();
var nodes = new List<object>();
var nodeCounts = new Dictionary<string, int>();
var lootPickups = new List<object>();
var seenCollectibles = new HashSet<string>(); // dedupe by id across both passes
var seenLoot = new HashSet<string>();          // dedupe loose parts by id across both passes
var lootUnresolved = new Dictionary<string, int>(); // mesh -> count, for pickups we could not resolve

void AddCollectible(UObject e, string kind)
{
    var loc = Loc(e);
    if (loc == null) { return; }
    if (!seenCollectibles.Add($"{kind}:{e.Name}")) { return; }
    int x = (int) loc.Value.X, y = (int) loc.Value.Y, z = (int) loc.Value.Z;
    object entry;
    if (schematicKinds.Contains(kind))
    {
        entry = new { id = e.Name, kind, schematic = SchematicFor(e), x, y, z };
    }
    else
    {
        var guid = GuidFor(e, kind);
        // Hard-drive drop pods carry a per-instance unlock cost (item and/or power).
        var unlock = kind == "hardDrive" ? UnlockFor(e) : null;
        entry = unlock == null
            ? new { id = e.Name, kind, guid, x, y, z }
            : new { id = e.Name, kind, guid, x, y, z, unlock };
    }
    collectibles.Add(entry);
    collCounts[kind] = collCounts.GetValueOrDefault(kind) + 1;
}

// A loose crash-site part (FGItemPickup_Spawnable): item resolved from the mesh, amount
// from NumItems, plus the pickup GUID (matched against the save's mDestroyedPickups).
void AddLoot(UObject e)
{
    var loc = Loc(e);
    if (loc == null) { return; }
    if (!seenLoot.Add(e.Name)) { return; }
    var meshComp = e.GetOrDefault<UObject?>("mMeshComponent");
    var meshPath = meshComp == null ? null : ObjPath(meshComp, "StaticMesh");
    var itemClass = ResolveItem(meshPath);
    var stack = StructProp(e, "mPickupItems");
    var amount = stack?.Properties.FirstOrDefault(p => p.Name.Text == "NumItems")?.Tag?.GenericValue is int n ? n : 0;
    var guid = GuidFor(e, "crashSitePart");
    if (itemClass == null)
    {
        var key = Trail(meshPath) ?? "(no mesh)";
        lootUnresolved[key] = lootUnresolved.GetValueOrDefault(key) + 1;
        return; // leave unresolved out; the run prints a warning and the count won't reach 703
    }
    int x = (int) loc.Value.X, y = (int) loc.Value.Y, z = (int) loc.Value.Z;
    lootPickups.Add(new { id = e.Name, guid, itemClass, amount, x, y, z });
}

// --- Pass 1: collectibles (incl. the customizer helmet) + loose parts from the WP cells ---
var cells = provider.Files.Keys.Where(k => k.Contains("/_Generated_/") && k.EndsWith(".umap")).ToList();
Console.WriteLine($"sweeping {cells.Count} cells for collectibles + crash-site parts...");
var n = 0;
foreach (var cell in cells)
{
    if (++n % 1000 == 0) { Console.WriteLine($"  ...{n}/{cells.Count}"); }
    try
    {
        foreach (var e in provider.LoadPackage(cell).GetExports())
        {
            if (collectibleKinds.TryGetValue(e.ExportType, out var kind)) { AddCollectible(e, kind); }
            else if (e.ExportType.Contains("ItemPickup_Spawnable")) { AddLoot(e); }
        }
    }
    catch (Exception ex) { Console.Error.WriteLine($"[cell] {cell}: {ex.Message}"); }
}

// --- Pass 2: resource nodes (+ drop pods, music tapes, loose parts) from the persistent level ---
var levelPkgs = provider.Files.Keys
    .Where(k => k.Contains("/GameLevel01/") && k.EndsWith(".umap") && !k.Contains("/_Generated_/"))
    .ToList();
Console.WriteLine($"sweeping {levelPkgs.Count} persistent-level package(s) for resource nodes...");
foreach (var pkgPath in levelPkgs)
{
    try
    {
        foreach (var e in provider.LoadPackage(pkgPath).GetExports())
        {
            // Collectibles that live in the persistent level rather than the cells.
            if (collectibleKinds.TryGetValue(e.ExportType, out var ck) && (ck == "hardDrive" || ck == "mtape"))
            {
                AddCollectible(e, ck);
            }
            if (e.ExportType.Contains("ItemPickup_Spawnable")) { AddLoot(e); }
            if (!nodeKinds.TryGetValue(e.ExportType, out var kind)) { continue; }
            var loc = Loc(e);
            if (loc == null) { continue; }
            var resourceClass = kind == "geyser" ? null : Ref(e, "mResourceClass");
            var purity = kind == "frackingCore" ? null : Purity(e);
            nodes.Add(new { id = e.Name, kind, resourceClass, purity, x = (int) loc.Value.X, y = (int) loc.Value.Y, z = (int) loc.Value.Z });
            nodeCounts[kind] = nodeCounts.GetValueOrDefault(kind) + 1;
        }
    }
    catch (Exception ex) { Console.Error.WriteLine($"[lvl] {pkgPath}: {ex.Message}"); }
}

// --- Project-assembly (space-elevator) phase deliverable costs (#172 slice E) ---------
// FGGamePhase assets at /GamePhases/GP_Project_Assembly_Phase_N carry `mCosts` (an array
// of FItemAmount { ItemClass -> Desc_SpaceElevatorPart_*_C, Amount }) and the HUB tier
// they unlock (`mLastTierOfPhase`). Only the deliverable phases carry costs (the early
// onboarding phase and the post-launch phases have none) — we emit just those.
var phases = new List<object>();
var phaseKeys = provider.Files.Keys
    .Where(k => k.Contains("/GamePhases/GP_Project_Assembly_Phase_") && k.EndsWith(".uasset"))
    .OrderBy(k => k, StringComparer.Ordinal)
    .ToList();
Console.WriteLine($"extracting {phaseKeys.Count} project-assembly phase asset(s)...");
foreach (var pk in phaseKeys)
{
    try
    {
        var e = provider.LoadPackage(pk).GetExports().FirstOrDefault(x => x.ExportType == "FGGamePhase");
        if (e == null) { continue; }
        var nm = Regex.Match(e.Name, @"Phase_(\d+)$");
        if (!nm.Success) { continue; }
        var phaseNum = int.Parse(nm.Groups[1].Value);
        var lastTier = e.GetOrDefault<int>("mLastTierOfPhase");
        var cost = new List<object>();
        if (e.Properties.FirstOrDefault(p => p.Name.Text == "mCosts")?.Tag?.GenericValue is UScriptArray arr)
        {
            foreach (var el in arr.Properties)
            {
                var s = Struct(el.GenericValue);
                if (s == null) { continue; }
                var ic = (s.Properties.FirstOrDefault(p => p.Name.Text == "ItemClass")?.Tag?.GenericValue as FPackageIndex)?.ResolvedObject?.GetPathName();
                var itemClass = Trail(ic);
                var amount = s.Properties.FirstOrDefault(p => p.Name.Text == "Amount")?.Tag?.GenericValue is int a ? a : 0;
                if (itemClass != null && amount > 0) { cost.Add(new { itemClassName = itemClass, amount }); }
            }
        }
        if (cost.Count > 0) { phases.Add(new { phase = phaseNum, lastTierOfPhase = lastTier, cost }); }
    }
    catch (Exception ex) { Console.Error.WriteLine($"[phase] {pk}: {ex.Message}"); }
}
phases = phases.OrderBy(p => (int) ((dynamic) p).phase).ToList();
Console.WriteLine($"project-assembly phases with costs: {phases.Count}");

// Alphabetical so the counts block is stable across re-extractions.
var counts = new SortedDictionary<string, int>(StringComparer.Ordinal);
foreach (var kv in collCounts) { counts[kv.Key] = kv.Value; }
foreach (var kv in nodeCounts) { counts[kv.Key] = kv.Value; }
counts["crashSitePart"] = lootPickups.Count;

var dataset = new
{
    gameVersion,
    build,
    source = "first-party asset extraction (CUE4Parse + shipped FactoryGame.usmap)",
    counts,
    // Deterministic ordering (kind, then id) so a regenerated dataset diffs only
    // on genuine world changes, not on asset-enumeration order.
    collectibles = collectibles
        .OrderBy(c => (string) ((dynamic) c).kind, StringComparer.Ordinal)
        .ThenBy(c => (string) ((dynamic) c).id, StringComparer.Ordinal)
        .ToList(),
    resourceNodes = nodes
        .OrderBy(c => (string) ((dynamic) c).kind, StringComparer.Ordinal)
        .ThenBy(c => (string) ((dynamic) c).id, StringComparer.Ordinal)
        .ToList(),
    // Loose crash-site parts, ordered by item then id for a stable diff.
    lootPickups = lootPickups
        .OrderBy(c => (string) ((dynamic) c).itemClass, StringComparer.Ordinal)
        .ThenBy(c => (string) ((dynamic) c).id, StringComparer.Ordinal)
        .ToList(),
};

Console.WriteLine("=== COUNTS ===");
foreach (var kv in counts.OrderBy(k => k.Key)) { Console.WriteLine($"  {kv.Key}: {kv.Value}"); }
Console.WriteLine($"collectibles={collectibles.Count} resourceNodes={nodes.Count} lootPickups={lootPickups.Count}");
if (lootUnresolved.Count > 0)
{
    Console.WriteLine($"WARNING: {lootUnresolved.Values.Sum()} loose pickup(s) had an unresolved mesh:");
    foreach (var (m, c) in lootUnresolved.OrderByDescending(k => k.Value)) { Console.WriteLine($"  {c,4}  {m}"); }
}

return new ExtractResult(dataset, phases);
    }
}
