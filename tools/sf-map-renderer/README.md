# sf-map-renderer — offline base-map renderer ([upstream #246](https://github.com/StuartMeeks/ficsit-foreman/issues/246))

A single C#-only console tool that renders a first-party, top-down base map of the *Satisfactory*
world directly from the shipped game assets, via CUE4Parse. It decodes the landscape heightmap,
colours the terrain from the material weightmaps, rasterises the placed rock/cliff meshes and the
flora, lays the full water model, classifies ocean/void from the FGWaterVolume geometry, and builds
an interactive, toggleable-layer HTML artifact.

**The design, decode maths, water model, and every mechanism are documented in
[`docs/base-map-renderer.md`](../../docs/base-map-renderer.md).** This README is how to build and run it.

## Prerequisites

This tool builds and runs on the **Windows host with a game install** — the dev VM has no game
files (see the dev-environment note in the repo `AGENTS.md`). It needs:

- **.NET 10 SDK.**
- **A CUE4Parse clone** at `packages/sf-game-data/extract/CUE4Parse/` — the same clone the game-data
  extractor uses (gitignored; clone it per
  [`packages/sf-game-data/extract/README.md`](../../packages/sf-game-data/extract/README.md)). The
  project references it by relative path.
- **The Oodle native library** (`oo2core_*.dll` / `oodle-data-shared.dll`) beside the built exe —
  `OodleHelper.DownloadOodleDll()` fetches it at runtime. Proprietary — never committed.
- A **Satisfactory install** (paks + `FactoryGame.usmap`), the defaults target a Steam install and
  can be overridden with `--paks` / `--usmap` (or `SF_PAKS` / `SF_USMAP`).

The **Lato Regular** font used for overlay/layer labels is embedded in the assembly (SIL Open Font
Licence, `OFL.txt` beside it), so no system font is required. Imaging is done with **SixLabors.ImageSharp** (Apache-2.0 line: ImageSharp 2.x +
ImageSharp.Drawing 1.0), replacing the former Python (Pillow/numpy) companions.

## Build

```powershell
cd tools/sf-map-renderer
dotnet build sf-map-renderer.slnx -c Release
```

Shared build settings live in `Directory.Build.props` (net10.0, nullable, `TreatWarningsAsErrors`),
package versions in `Directory.Packages.props` (Central Package Management), and code style in
`.editorconfig`.

## Run

The tool is a Spectre.Console command app. Everything is driven by typed options (each maps to one of
the old environment variables with the same default):

```powershell
$dll = "sf-map-renderer/bin/Release/net10.0/sf-map-renderer.dll"

# Render the base map (full-res 3917x3409 with the layer sidecars):
dotnet $dll render --downsample 2 --layers

# Annotate a flat render with biome outlines/names + the 40x34 coordinate grid:
dotnet $dll overlay map.ppm

# Build the interactive layered HTML artifact from a --layers render:
dotnet $dll layers --width 1600

# Run a diagnostic survey (see docs for the full list):
dotnet $dll probe volat --at "-100000,-300000"
dotnet $dll probe meshes
```

Outputs are written to the working directory: `map.ppm` (flat composite), plus — with `--layers` —
`map.surf.ppm`, `map.obj.ppm`, `map.layers`, and always `map-bounds.txt`. `overlay` writes
`<name>_labeled.png` + `<name>_embed.jpg`; `layers` writes `map-layers.html`.

`render --help`, `probe --help`, etc. list every option. Diagnostic probes that ride on a render are
`render` options (`--probe-xy`, `--rock-at`, `--cells`, `--layer-at`, `--z-test`); the standalone
surveys are `probe <name>`.

## Layout

```
sf-map-renderer.slnx · Directory.Build.props · Directory.Packages.props · .editorconfig
sf-map-renderer/            the tool
  Program.cs                entry point — registers the commands
  Commands/                 Spectre command + settings classes
  Configuration/            RenderOptions + the WorldFrame coordinate transform
  Assets/                   CUE4Parse provider + component-property accessors
  Collection/               pass A: scene collector + collected-scene model
  Landscape/                pass B: heightmap decode + terrain colour
  Meshes/ · Terrain/        mesh geometry cache + the higher-ground (rock/flora) rasteriser
  Water/                    the water model (volumes, rivers, ponds, wet-sand)
  Rendering/                render state, shader, PPM/layer writers
  Geometry/                 point-in-polygon
  Artifacts/                biome dataset + overlay/layered-artifact renderers (the Pillow port)
  Imaging/                  PPM reader + embedded font
  Diagnostics/              the diagnostic probes (Surveys/ = the standalone MODE=… surveys)
sf-map-renderer-tests/      xUnit tests for the CUE4Parse-free logic (run on the host)
```
