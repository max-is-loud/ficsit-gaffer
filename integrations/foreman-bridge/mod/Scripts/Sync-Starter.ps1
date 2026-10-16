# Mirror this repository's plugin source into the starter project's
# Mods\ForemanBridge so Build.ps1 and the test scripts build what is committed
# here. The repository copy is canonical; the starter checkout is a build
# mirror. Build outputs, local settings and the starter's own .git are never
# touched, and the generated BridgeBuildInfo.h survives the mirror.
param([Parameter(Mandatory)][string]$Settings)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$config = Get-Content -Raw -LiteralPath $Settings | ConvertFrom-Json
$source = Split-Path $PSScriptRoot -Parent
$target = Join-Path $config.starterRoot 'Mods\ForemanBridge'
if (!(Test-Path -LiteralPath $target -PathType Container)) { throw "Missing starter plugin directory: $target" }
foreach ($directory in @('Source', 'Tests', 'Scripts', 'docs')) {
    & robocopy (Join-Path $source $directory) (Join-Path $target $directory) /MIR /NFL /NDL /NJH /NJS /NP /XF BridgeBuildInfo.h | Out-Null
    # Robocopy exit codes below 8 report success (copied, extra or mismatched files).
    if ($LASTEXITCODE -ge 8) { throw "Mirror of $directory failed with robocopy exit $LASTEXITCODE" }
}
foreach ($file in @('ForemanBridge.uplugin', 'README.md', '.clang-format', '.gitignore')) {
    Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $target $file) -Force
}
$global:LASTEXITCODE = 0
Write-Output "Mirrored $source -> $target"
