// Interface through which the landscape decode reports per-cell weightmap samples to the LAYERAT
// probe, keeping the decoder independent of the diagnostics layer.

namespace SfMapRenderer.Landscape;

/// <summary>
/// Receives per-cell weightmap samples during pass B, for the LAYERAT probe. Kept as an interface so the
/// decoder needn't know about the diagnostics layer.
/// </summary>
public interface ILayerAtSink
{
    /// <summary>Announce the probed cells (printed once, right after the pass-B header).</summary>
    void PrintSetup();

    /// <summary>A material layer's weight at a cell.</summary>
    void Observe(int column, int row, string layer, int weight);
}
