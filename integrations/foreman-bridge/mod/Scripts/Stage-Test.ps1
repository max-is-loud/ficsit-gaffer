param(
    [Parameter(Mandatory)][string]$Manifest,
    [Parameter(Mandatory)][string]$Destination,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem
$target = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
$allowed = @{
    '\\wsl.localhost\Debian\home\max\projects\satisfactory-bridge-test\server' = 'LinuxServer'
    'D:\Modding\ForemanBridgeTest\client' = 'Windows'
}
if (!$allowed.ContainsKey($target)) { throw 'Destination is not on the disposable installation allowlist' }
$platform = $allowed[$target]
$data = Get-Content -Raw -LiteralPath $Manifest | ConvertFrom-Json
$packages = @($data.packages | Where-Object { $_.platform -eq $platform })
if ($packages.Count -ne 1) { throw 'Manifest must select exactly one package for this destination' }
$package = $packages[0]
if ($package.plugin -notin @('ForemanBridge', 'SML')) { throw 'Unapproved plugin in manifest' }
if ($platform -eq 'Windows' -and $package.plugin -eq 'ForemanBridge') { throw 'Task 1 permits the bridge on the server only' }
$archive = $package.path
if (![IO.Path]::IsPathRooted($archive)) { $archive = Join-Path (Split-Path -Parent ([IO.Path]::GetFullPath($Manifest))) $archive }
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $package.sha256) { throw 'Archive hash mismatch' }
$modPath = Join-Path $target "FactoryGame\Mods\$($package.plugin)"
# Reject links at every existing path component before writing, including UNC descendants.
$walk = $modPath
while ($walk -and $walk -ne [IO.Path]::GetPathRoot($walk)) {
    if (Test-Path -LiteralPath $walk) {
        if (((Get-Item -Force -LiteralPath $walk).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Destination contains a reparse point' }
    }
    $walk = Split-Path -Parent $walk
}
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $hasDescriptor = $false
    foreach ($entry in $zip.Entries) {
        $name = $entry.FullName.Replace('\', '/')
        $parts = $name.Split('/')
        if ($name.StartsWith('/') -or $name.Contains(':') -or $parts -contains '..' -or $parts -contains '.' -or !$names.Add($name)) { throw "Unsafe archive entry: $name" }
        if ($name -ne "$($package.plugin).uplugin" -and $name -notmatch '^(Binaries|Content|Config|Resources|Localization)/') { throw "Unapproved archive entry: $name" }
        if (($entry.ExternalAttributes -shr 16 -band 0xF000) -eq 0xA000) { throw "Symlink archive entry: $name" }
        if ($name -eq "$($package.plugin).uplugin") { $hasDescriptor = $true }
    }
    if (!$hasDescriptor) { throw 'Archive has no plugin descriptor entry' }
    if ($ValidateOnly) { Write-Host "Validated $($package.plugin) for $platform at $target"; return }
    if (!(Test-Path -LiteralPath (Join-Path $target 'FactoryGame') -PathType Container)) { throw 'Disposable game installation is missing' }
    if (Test-Path -LiteralPath $modPath) { throw 'Plugin already installed; archive it outside Mods before replacing' }
    New-Item -ItemType Directory -Force -Path $modPath | Out-Null
    foreach ($entry in $zip.Entries) {
        $path = Join-Path $modPath $entry.FullName
        if ($entry.FullName.EndsWith('/')) { New-Item -ItemType Directory -Force $path | Out-Null; continue }
        New-Item -ItemType Directory -Force (Split-Path -Parent $path) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $path, $false)
    }
} finally { $zip.Dispose() }
Write-Host "Staged $($package.plugin) $platform at $modPath"
