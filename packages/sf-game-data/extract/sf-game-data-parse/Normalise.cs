// Normalises Unreal's string encodings: parses ingredient and product lists, scales fluid amounts
// from thousandths of a cubic metre to m³, and derives per-minute rates.

using System.Globalization;
using System.Text.RegularExpressions;

namespace SfGameData.Parse;

public readonly record struct RawItemAmount(string ClassName, double Amount);

public readonly record struct DisplayAmount(double Amount, string Unit);

// Ported from src/parser/normalise/ingredients.ts and normalise/fluids.ts.
public static partial class Normalise
{
    private const double FluidUnitsPerCubicMetre = 1000;

    // `[^']+'[^.]+\.(\w+)'` and `Amount=(\d+)` from the TS source (\w → ASCII).
    [GeneratedRegex(@"[^']+'[^.]+\.([A-Za-z0-9_]+)'")]
    private static partial Regex ClassInEntry();

    [GeneratedRegex(@"Amount=([0-9]+)")]
    private static partial Regex AmountInEntry();

    /// <summary>
    /// Parses the Unreal encoding used by mIngredients/mProduct/schematic mCost:
    /// <c>((ItemClass="…'/Game/…/Desc_X.Desc_X_C'",Amount=100),(…))</c>.
    /// </summary>
    public static List<RawItemAmount> ParseItemAmountList(string raw)
    {
        var result = new List<RawItemAmount>();
        if (string.IsNullOrEmpty(raw))
        {
            return result;
        }
        var trimmed = raw.Trim();
        if (trimmed.Length < 4 || !trimmed.StartsWith("((", StringComparison.Ordinal)
            || !trimmed.EndsWith("))", StringComparison.Ordinal))
        {
            return result;
        }
        var inner = trimmed[2..^2];
        if (inner.Trim().Length == 0)
        {
            return result;
        }
        foreach (var entry in SplitOnEntryBoundary(inner))
        {
            var classMatch = ClassInEntry().Match(entry);
            var amountMatch = AmountInEntry().Match(entry);
            var className = classMatch.Success ? classMatch.Groups[1].Value : "";
            var amountText = amountMatch.Success ? amountMatch.Groups[1].Value : "0";
            var amount = double.Parse(amountText, CultureInfo.InvariantCulture);
            if (className.Length > 0)
            {
                result.Add(new RawItemAmount(className, amount));
            }
        }
        return result;
    }

    // Equivalent to JS String.split("),(") — split on the literal boundary,
    // keeping empty segments (the C# overload would otherwise differ on edges).
    private static IEnumerable<string> SplitOnEntryBoundary(string inner)
        => inner.Split("),(");

    public static bool IsFluid(string form) => form is "liquid" or "gas";

    /// <summary>Converts a raw per-craft amount into display amount + unit (fluids → m³).</summary>
    public static DisplayAmount ToDisplayAmount(double rawAmount, string form)
        => IsFluid(form)
            ? new DisplayAmount(rawAmount / FluidUnitsPerCubicMetre, "m³")
            : new DisplayAmount(rawAmount, "items");

    /// <summary>Per-minute rate: amount * 60 / craftTime. Guards against zero duration.</summary>
    public static double PerMinute(double displayAmount, double craftTimeSeconds)
        => craftTimeSeconds <= 0 ? 0 : displayAmount * 60 / craftTimeSeconds;
}
