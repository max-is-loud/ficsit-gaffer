// CLI settings shared by every command that reads the game files (Paks directory and usmap path,
// defaulting to SF_PAKS, SF_USMAP or a Steam install), plus the helper that mounts them.

using System.ComponentModel;

using SfMapRenderer.Assets;

using Spectre.Console.Cli;

namespace SfMapRenderer.Commands;

/// <summary>Shared CUE4Parse inputs (paks + mappings). Defaults honour SF_PAKS/SF_USMAP, then a Steam install.</summary>
public class AssetSettings : CommandSettings
{
    [CommandOption("--paks <PATH>")]
    [Description("Satisfactory Paks directory (default: SF_PAKS or a Steam install).")]
    public string Paks { get; init; } =
        Environment.GetEnvironmentVariable("SF_PAKS") ?? @"D:\Games\Steam\steamapps\common\Satisfactory\FactoryGame\Content\Paks";

    [CommandOption("--usmap <PATH>")]
    [Description("FactoryGame.usmap mappings file (default: SF_USMAP or a Steam install).")]
    public string Usmap { get; init; } =
        Environment.GetEnvironmentVariable("SF_USMAP") ?? @"D:\Games\Steam\steamapps\common\Satisfactory\CommunityResources\FactoryGame.usmap";
}

/// <summary>Opens the game-asset provider and prints the mount banner every mode shares.</summary>
public static class AssetMount
{
    public static GameAssetProvider Open(AssetSettings settings)
    {
        var provider = new GameAssetProvider(settings.Paks, settings.Usmap);
        Console.WriteLine($"mounted. files = {provider.FileCount}");
        return provider;
    }
}
