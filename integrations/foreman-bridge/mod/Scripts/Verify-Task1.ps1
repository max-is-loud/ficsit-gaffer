param([Parameter(Mandatory)][string]$Settings)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$config = Get-Content -Raw $Settings | ConvertFrom-Json
& (Join-Path $PSScriptRoot 'Test-Staging.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$provenance = Get-Content -Raw (Join-Path $repo 'docs/build-manifest.json') | ConvertFrom-Json
foreach ($source in $provenance.sourceInputs.PSObject.Properties) {
    if ((Get-FileHash (Join-Path $repo $source.Name) -Algorithm SHA256).Hash -ne $source.Value) {
        throw "Task 1 incomplete: source changed since the tested build: $($source.Name)"
    }
}
if ($provenance.editorBuild.result -ne 'passed' -or $provenance.packageBuild.exitCode -ne 0) {
    throw 'Task 1 incomplete: successful editor/package evidence missing'
}
$manifest = Join-Path $config.outputRoot 'ForemanBridge-packages.json'
if (!(Test-Path $manifest)) { throw 'Task 1 incomplete: dual-target package manifest missing' }
$packages = (Get-Content -Raw $manifest | ConvertFrom-Json).packages
foreach ($platform in @('Windows', 'LinuxServer')) {
    $match = @($packages | Where-Object { $_.platform -eq $platform -and $_.plugin -eq 'ForemanBridge' })
    if ($match.Count -ne 1) { throw "Task 1 incomplete: $platform package missing" }
    if ((Get-FileHash $match[0].path -Algorithm SHA256).Hash -ne $match[0].sha256) { throw "Task 1 incomplete: $platform hash mismatch" }
}
$evidenceRoot = '\\wsl.localhost\Debian\home\max\projects\satisfactory-bridge-test\evidence'
foreach ($file in @('task1-sml-only.json', 'task1-empty-bridge.json')) {
    $path = Join-Path $evidenceRoot $file
    if (!(Test-Path $path)) { throw "Task 1 incomplete: actual game evidence missing: $file" }
    $record = Get-Content -Raw $path | ConvertFrom-Json
    if ($record.connectedPlayers -lt 1 -or !($record.evidence -match 'Join succeeded:')) {
        throw "Task 1 incomplete: no corroborated player join: $file"
    }
    if ($record.world -ne 'ForemanBridge-Disposable-20261013') { throw 'Unexpected acceptance world' }
    if ($file -eq 'task1-empty-bridge.json') {
        if (!($record.evidence -match 'ForemanBridge 0.1.0 empty load probe')) { throw 'Empty bridge load not evidenced' }
        $linuxPackage = $packages | Where-Object { $_.platform -eq 'LinuxServer' }
        if ($record.bridgePackageSha256 -ne $linuxPackage.sha256) { throw 'Game evidence belongs to another package' }
    }
}
Write-Host 'PASS: Task 1 packaging hashes, staging checks and recorded actual-game joins verified.'
