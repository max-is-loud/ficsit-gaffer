// Extracts the *_C class-name tokens from a raw Unreal class-reference string, de-duplicated and in
// their original order.

using System.Text.RegularExpressions;

namespace SfGameData.Parse;

// Ported from @foreman/sf-core/src/classRef.ts. Extracts every `*_C` class-name
// token from a raw Unreal class-reference string, de-duplicated and
// order-preserving. The JS pattern \b([A-Za-z][A-Za-z0-9_]*_C)\b is reproduced
// with explicit ASCII classes (the JS token set), not .NET's Unicode \w.
public static partial class ClassRef
{
    [GeneratedRegex(@"\b([A-Za-z][A-Za-z0-9_]*_C)\b")]
    private static partial Regex ClassToken();

    public static List<string> ExtractClassNames(string raw)
    {
        var output = new List<string>();
        if (string.IsNullOrEmpty(raw))
        {
            return output;
        }
        var seen = new HashSet<string>();
        foreach (Match match in ClassToken().Matches(raw))
        {
            var name = match.Groups[1].Value;
            if (seen.Add(name))
            {
                output.Add(name);
            }
        }
        return output;
    }
}
