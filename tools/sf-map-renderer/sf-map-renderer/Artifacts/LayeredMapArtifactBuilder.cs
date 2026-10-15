// Builds map-layers.html, an interactive page of toggleable layers stacked in one pan/zoom frame:
// raster layers from the surface and object rasters, vector biome edges and grid, and positioned
// biome-name text.

using System.Globalization;
using System.Text;

using SfMapRenderer.Imaging;

using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace SfMapRenderer.Artifacts;

/// <summary>
/// Builds the interactive, toggleable-layer HTML artifact from a LAYERS render. Layers come in three kinds,
/// each stacked in the same pan/zoom frame so they scale together:
/// <list type="bullet">
///   <item><b>Raster</b> — the pixel data (void/water/ground from the surface raster; coral/rocks/trunks/foliage
///   from the object raster), one transparent PNG per layer.</item>
///   <item><b>Vector</b> — the biome edges, as SVG polygons (crisp at any zoom).</item>
///   <item><b>Text</b> — the biome names and named areas, as positioned HTML text (embedded Lato, white halo).</item>
/// </list>
/// The grid stays raster for now (a future vector+text candidate).
/// </summary>
public static class LayeredMapArtifactBuilder
{
    private const int Columns = MapAnnotations.Columns;
    private const int Rows = MapAnnotations.Rows;

    private enum LayerKind
    {
        Raster,
        Vector,
        Text,
    }

    /// <summary>One toggleable layer: <paramref name="Content"/> is a base64 PNG, inner SVG, or inner HTML per <paramref name="Kind"/>.</summary>
    private sealed record Layer(string Id, string Label, LayerKind Kind, string Content);

    public static void Build(string surfacePath, string objectPath, string layersPath, string biomesPath, int targetWidth)
    {
        var (width, height, surface) = PpmReader.Read(surfacePath);
        var (_, _, objectRaster) = PpmReader.Read(objectPath);
        var classes = File.ReadAllBytes(layersPath);

        var tw = Math.Min(targetWidth, width);
        var th = (int)Math.Round((double)tw * height / width);
        var scale = (double)tw / width;

        var layers = new List<Layer>
        {
            Raster("void", "Void", RasterLayer(width, height, tw, th, i => (classes[i] & 3) == 0, surface, null)),
            Raster("water", "Water", RasterLayer(width, height, tw, th, i => (classes[i] & 3) == 1, surface, null)),
            Raster("ground", "Ground", RasterLayer(width, height, tw, th, i => (classes[i] & 3) == 2, surface, null)),
            Raster("coral", "Coral", RasterLayer(width, height, tw, th, i => ((classes[i] >> 2) & 3) == 2, objectRaster, null)),
            Raster("rocks", "Rocks", RasterLayer(width, height, tw, th, i => ((classes[i] >> 2) & 3) == 1, objectRaster, null)),
            Raster("trunks", "Tree trunks", RasterLayer(width, height, tw, th, i => (classes[i] & 16) != 0, null, new Rgb24(120, 82, 52))),
            Raster("foliage", "Tree foliage", RasterLayer(width, height, tw, th, i => ((classes[i] >> 2) & 3) == 3, objectRaster, null)),
            new("biomes", "Biome edges", LayerKind.Vector, BiomeEdgesSvg(biomesPath, scale)),
            new("names", "Biome names", LayerKind.Text, BiomeNamesHtml(biomesPath, tw, th, scale)),
            new("areas", "Named areas", LayerKind.Text, NamedAreasHtml(biomesPath, tw, th, scale)),
            new("grid", "Grid A1-AN34", LayerKind.Vector, GridSvg(tw, th, scale)),
        };

        var html = AssembleHtml(layers, tw, th);
        File.WriteAllText(Path.Combine(Directory.GetCurrentDirectory(), "map-layers.html"), html);
        Console.WriteLine($"wrote map-layers.html  ({tw}x{th}, {layers.Count} layers, {html.Length / 1024} KB)");
    }

    private static Layer Raster(string id, string label, string base64) => new(id, label, LayerKind.Raster, base64);

    /// <summary>A full-extent raster layer: source colour where the predicate holds, transparent elsewhere, then downscaled.</summary>
    private static string RasterLayer(int width, int height, int tw, int th, Func<int, bool> included, byte[]? source, Rgb24? flat)
    {
        var pixels = new byte[width * height * 4];
        for (var i = 0; i < width * height; i++)
        {
            if (!included(i))
            {
                continue;
            }

            if (flat is { } colour)
            {
                pixels[i * 4] = colour.R;
                pixels[i * 4 + 1] = colour.G;
                pixels[i * 4 + 2] = colour.B;
            }
            else
            {
                pixels[i * 4] = source![i * 3];
                pixels[i * 4 + 1] = source[i * 3 + 1];
                pixels[i * 4 + 2] = source[i * 3 + 2];
            }

            pixels[i * 4 + 3] = 255;
        }

        using var image = Image.LoadPixelData<Rgba32>(pixels, width, height);
        image.Mutate(x => x.Resize(new ResizeOptions { Size = new Size(tw, th), Sampler = KnownResamplers.Lanczos3, Mode = ResizeMode.Stretch }));
        return ToPngBase64(image);
    }

    /// <summary>The biome outlines as SVG polygons (one per ring), in the <c>tw×th</c> viewBox space.</summary>
    private static string BiomeEdgesSvg(string biomesPath, double scale)
    {
        var sb = new StringBuilder();
        foreach (var biome in BiomeDataset.Load(biomesPath))
        {
            foreach (var polygon in biome.Polygons)
            {
                sb.Append("<polygon points=\"");
                foreach (var p in polygon)
                {
                    var pt = MapAnnotations.Pixel(p.X, p.Y, scale);
                    sb.Append(CultureInfo.InvariantCulture, $"{pt.X:0.#},{pt.Y:0.#} ");
                }

                sb.Append("\"/>");
            }
        }

        return sb.ToString();
    }

    private static string BiomeNamesHtml(string biomesPath, int tw, int th, double scale)
    {
        var fontPx = Math.Max(11, Math.Round(15 * scale / 0.4));
        var sb = new StringBuilder();
        foreach (var biome in BiomeDataset.Load(biomesPath))
        {
            var centre = MapAnnotations.BiomeLabelAnchor(biome, tw, th, scale);
            AppendLabel(sb, biome.DisplayLabel, centre, fontPx, biome.LabelColour);
        }

        return sb.ToString();
    }

    private static string NamedAreasHtml(string biomesPath, int tw, int th, double scale)
    {
        // Slightly smaller than the biome-name font (same Lato weight), Sentence Case as authored.
        var fontPx = Math.Max(9, Math.Round(12 * scale / 0.4));
        var sb = new StringBuilder();
        foreach (var area in BiomeDataset.Load(biomesPath).SelectMany(b => b.SubLocations))
        {
            if (MapAnnotations.TryCellCentre(area.LabelCell, tw, th, out var centre))
            {
                AppendLabel(sb, area.Name, centre, fontPx, null);
            }
        }

        return sb.ToString();
    }

    /// <summary>A positioned text label, centred on its point, with a contrast halo (white behind dark text).</summary>
    private static void AppendLabel(StringBuilder sb, string text, PointF centre, double fontPx, string? colourSpec)
    {
        var white = string.Equals(colourSpec, "white", StringComparison.OrdinalIgnoreCase);
        var html = System.Net.WebUtility.HtmlEncode(text).Replace("\r\n", "<br>").Replace("\n", "<br>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<span class=\"lbl {(white ? "onDark" : "onLight")}\" style=\"left:{centre.X:0.#}px;top:{centre.Y:0.#}px;font-size:{fontPx:0.#}px;color:{(white ? "#fff" : "#000")};\">{html}</span>");
    }

    /// <summary>The A1..AN34 coordinate grid as SVG lines plus a cell label per cell (vector, crisp at any zoom).</summary>
    private static string GridSvg(int tw, int th, double scale)
    {
        double cellWidth = (double)tw / Columns, cellHeight = (double)th / Rows;
        var fontPx = Math.Max(7, Math.Round(11 * scale / 0.4));
        var sb = new StringBuilder();
        for (var c = 0; c <= Columns; c++)
        {
            sb.Append(CultureInfo.InvariantCulture, $"<line x1=\"{c * cellWidth:0.#}\" y1=\"0\" x2=\"{c * cellWidth:0.#}\" y2=\"{th}\"/>");
        }

        for (var r = 0; r <= Rows; r++)
        {
            sb.Append(CultureInfo.InvariantCulture, $"<line x1=\"0\" y1=\"{r * cellHeight:0.#}\" x2=\"{tw}\" y2=\"{r * cellHeight:0.#}\"/>");
        }

        for (var c = 0; c < Columns; c++)
        {
            for (var r = 0; r < Rows; r++)
            {
                sb.Append(CultureInfo.InvariantCulture,
                    $"<text x=\"{c * cellWidth + 2:0.#}\" y=\"{r * cellHeight + fontPx + 1:0.#}\" font-size=\"{fontPx:0.#}\">{MapAnnotations.ColumnLabel(c)}{r + 1}</text>");
            }
        }

        return sb.ToString();
    }

    private static string ToPngBase64(Image image)
    {
        using var stream = new MemoryStream();
        image.SaveAsPng(stream);
        return Convert.ToBase64String(stream.ToArray());
    }

    private static string AssembleHtml(List<Layer> layers, int tw, int th)
    {
        var elements = new StringBuilder();
        var rows = new StringBuilder();
        for (var i = 0; i < layers.Count; i++)
        {
            var layer = layers[i];
            var z = (i + 1) * 10;
            elements.Append(layer.Kind switch
            {
                LayerKind.Raster => $"<img class=\"ly\" id=\"ly-{layer.Id}\" style=\"z-index:{z};\" src=\"data:image/png;base64,{layer.Content}\" alt=\"{layer.Label}\">\n",
                LayerKind.Vector => $"<svg class=\"ly vec\" id=\"ly-{layer.Id}\" style=\"z-index:{z};\" viewBox=\"0 0 {tw} {th}\" preserveAspectRatio=\"none\">{layer.Content}</svg>\n",
                _ => $"<div class=\"ly txt\" id=\"ly-{layer.Id}\" style=\"z-index:{z};\">{layer.Content}</div>\n",
            });
            rows.Append(CultureInfo.InvariantCulture, $"<label class=\"row\"><input type=\"checkbox\" data-ly=\"{layer.Id}\" checked> {layer.Label}</label>\n");
        }

        return HtmlTemplate
            .Replace("__TW__", tw.ToString(CultureInfo.InvariantCulture))
            .Replace("__TH__", th.ToString(CultureInfo.InvariantCulture))
            .Replace("__FONT__", Convert.ToBase64String(EmbeddedFont.RegularTtfBytes()))
            .Replace("__ELEMENTS__", elements.ToString())
            .Replace("__ROWS__", rows.ToString());
    }

    private const string HtmlTemplate = """
<title>Satisfactory base map — layers (#246)</title>
<style>
  @font-face { font-family:'Lato'; src:url(data:font/ttf;base64,__FONT__) format('truetype'); font-weight:400; font-style:normal; }
  :root { color-scheme: dark; }
  * { box-sizing:border-box; }
  body { margin:0; background:#14171c; color:#dfe3ea; font:14px/1.4 system-ui,sans-serif; }
  #wrap { display:flex; align-items:flex-start; gap:14px; padding:14px; height:100vh; }
  #map { position:relative; flex:1 1 auto; height:100%; overflow:hidden; background:#0d0f13; border-radius:8px;
          box-shadow:0 2px 16px #0008; cursor:grab; touch-action:none; }
  #map.drag { cursor:grabbing; }
  #view { position:absolute; top:0; left:0; width:__TW__px; aspect-ratio:__TW__/__TH__; transform-origin:0 0; }
  #view .ly { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
  #view svg.ly { overflow:visible; }
  .vec polygon { fill:none; stroke:rgba(255,240,60,.82); stroke-width:2; stroke-linejoin:round; }
  #ly-grid line { stroke:rgba(0,255,255,.5); stroke-width:1; vector-effect:non-scaling-stroke; }
  #ly-grid text { fill:#000; font-family:'Lato',system-ui,sans-serif; }
  .lbl { position:absolute; transform:translate(-50%,-50%); white-space:nowrap; text-align:center; line-height:1.05;
         font-family:'Lato',system-ui,sans-serif; font-weight:400; }
  .lbl.onLight { text-shadow:-1px -1px 2px #fff,1px -1px 2px #fff,-1px 1px 2px #fff,1px 1px 2px #fff,0 0 3px #fff; }
  .lbl.onDark { text-shadow:-1px -1px 2px #000,1px -1px 2px #000,-1px 1px 2px #000,1px 1px 2px #000; }
  #panel { flex:0 0 190px; background:#1c2129; border:1px solid #2c333d; border-radius:10px; padding:12px 14px; align-self:flex-start; }
  #panel h1 { font-size:13px; letter-spacing:.06em; text-transform:uppercase; color:#8b97a8; margin:0 0 6px; }
  #panel .hint { color:#6b7686; font-size:11px; margin:0 0 10px; }
  .row { display:flex; align-items:center; gap:8px; padding:4px 0; cursor:pointer; user-select:none; }
  .row input { accent-color:#e6b800; width:15px; height:15px; }
  #reset { margin-top:10px; width:100%; background:#2c333d; color:#dfe3ea; border:0; border-radius:6px; padding:6px; cursor:pointer; }
</style>
<div id="wrap">
  <div id="map"><div id="view">
__ELEMENTS__
  </div></div>
  <div id="panel">
    <h1>Layers</h1>
    <p class="hint">scroll to zoom · drag to pan</p>
__ROWS__
    <button id="reset">Reset view</button>
  </div>
</div>
<script>
  document.querySelectorAll('#panel input').forEach(cb => cb.addEventListener('change', () => {
    document.getElementById('ly-' + cb.dataset.ly).style.display = cb.checked ? '' : 'none';
  }));
  const map = document.getElementById('map'), view = document.getElementById('view');
  let sc = 1, tx = 0, ty = 0;
  const BASE = __TW__;
  function fit() { sc = map.clientWidth / BASE; tx = 0; ty = 0; apply(); }
  function apply() { view.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`; }
  map.addEventListener('wheel', e => {
    e.preventDefault();
    const r = map.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const f = Math.exp(-e.deltaY * 0.0015), ns = Math.min(40, Math.max(map.clientWidth / BASE * 0.9, sc * f));
    tx = mx - (mx - tx) * (ns / sc); ty = my - (my - ty) * (ns / sc); sc = ns; apply();
  }, { passive: false });
  let dragging = false, px2 = 0, py2 = 0;
  map.addEventListener('pointerdown', e => { dragging = true; px2 = e.clientX; py2 = e.clientY; map.classList.add('drag'); map.setPointerCapture(e.pointerId); });
  map.addEventListener('pointermove', e => { if (!dragging) return; tx += e.clientX - px2; ty += e.clientY - py2; px2 = e.clientX; py2 = e.clientY; apply(); });
  map.addEventListener('pointerup', e => { dragging = false; map.classList.remove('drag'); });
  document.getElementById('reset').addEventListener('click', fit);
  window.addEventListener('resize', fit); fit();
</script>
""";
}
