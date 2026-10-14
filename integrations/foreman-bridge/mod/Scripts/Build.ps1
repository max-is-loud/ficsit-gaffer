param(
    [Parameter(Mandatory)][ValidateSet('Editor', 'Package')][string]$Mode,
    [Parameter(Mandatory)][string]$Settings,
    [ValidateSet('ForemanBridge', 'SML')][string]$Plugin = 'ForemanBridge'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$config = Get-Content -Raw -LiteralPath $Settings | ConvertFrom-Json
$git = 'C:\Program Files\Git\cmd\git.exe'
$pin = '8eebc9e659f0b2ff4392d2f8cf6e2cff60c8ea49'
$head = & $git -C $config.starterRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $head -ne $pin) { throw 'Starter source pin mismatch' }
$project = Join-Path $config.starterRoot 'FactoryGame.uproject'
$descriptor = Join-Path $config.starterRoot "Mods\$Plugin\$Plugin.uplugin"
foreach ($path in @($project, $descriptor)) {
    if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing build input: $path" }
}
$version = Get-Content -Raw (Join-Path $config.engineRoot 'Engine\Build\Build.version') | ConvertFrom-Json
if ($version.MajorVersion -ne 5 -or $version.MinorVersion -ne 6 -or $version.PatchVersion -ne 1 -or $version.Changelist -ne 83) {
    throw 'Custom engine version mismatch'
}
$env:LINUX_MULTIARCH_ROOT = [Environment]::GetEnvironmentVariable('LINUX_MULTIARCH_ROOT', 'Machine')
if (!(Test-Path "$env:LINUX_MULTIARCH_ROOT\x86_64-unknown-linux-gnu\bin\clang++.exe")) { throw 'Linux cross-compiler missing' }
$output = [IO.Path]::GetFullPath($config.outputRoot)
New-Item -ItemType Directory -Force -Path $output | Out-Null
if ($Plugin -eq 'ForemanBridge') {
    $pluginRoot = Split-Path $descriptor -Parent
    $generated = Join-Path $pluginRoot 'Source\ForemanBridge\Private\BridgeBuildInfo.h'
    $records = Get-ChildItem (Join-Path $pluginRoot 'Source') -Recurse -File | Where-Object { $_.FullName -ne $generated } | Sort-Object FullName | ForEach-Object {
        $_.FullName.Substring($pluginRoot.Length).Replace('\','/') + ':' + (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $sourceHash = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes(($records -join "`n")))).Replace('-','').ToLowerInvariant() } finally { $hash.Dispose() }
    $info = "#pragma once`n#define FOREMAN_SOURCE_SHA `"$sourceHash`"`n#define FOREMAN_STARTER_SHA `"$pin`"`n"
    if (!(Test-Path $generated) -or (Get-Content -Raw $generated) -ne $info) { [IO.File]::WriteAllText($generated,$info,[Text.UTF8Encoding]::new($false)) }
}
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$log = Join-Path $output "$Plugin-$Mode-$stamp.log"
$compiler = '-CompilerVersion=14.38.33130 -WindowsSdkVersion=10.0.22621.0 -MaxParallelActions=6'
if ($Mode -eq 'Editor') {
    $exe = Join-Path $config.engineRoot 'Engine\Build\BatchFiles\Build.bat'
    $arguments = @('FactoryEditor', 'Win64', 'Development', "-Project=$project", '-CompilerVersion=14.38.33130', '-WindowsSdkVersion=10.0.22621.0', '-MaxParallelActions=6', '-NoHotReloadFromIDE')
} else {
    $exe = Join-Path $config.engineRoot 'Engine\Build\BatchFiles\RunUAT.bat'
    $arguments = @("-ScriptsForProject=$project", 'PackagePlugin', "-project=$project", "-dlcname=$Plugin", '-build', '-server', '-clientconfig=Shipping', '-serverconfig=Shipping', '-platform=Win64', '-serverplatform=Linux', '-nocompileeditor', '-installed', '-utf8output', "-ubtargs=$compiler")
}
@{ executable = $exe; arguments = $arguments; startedUtc = [DateTime]::UtcNow.ToString('o') } |
    ConvertTo-Json -Depth 4 | Set-Content (Join-Path $output "$Plugin-$Mode-$stamp.command.json")
$started = [DateTime]::UtcNow
& $exe @arguments 2>&1 | Tee-Object -FilePath $log
$result = $LASTEXITCODE
if ($result -ne 0) { throw "Build failed with exit $result; log: $log" }
if ($Mode -eq 'Package') {
    $packages = @()
    foreach ($platform in @('Windows', 'LinuxServer')) {
        $archive = Join-Path $config.starterRoot "Saved\ArchivedPlugins\$Plugin\$Plugin-$platform.zip"
        if (!(Test-Path $archive) -or (Get-Item $archive).Length -eq 0 -or (Get-Item $archive).LastWriteTimeUtc -lt $started) {
            throw "Build did not produce a fresh archive: $archive"
        }
        $copy = Join-Path $output "$Plugin-$platform.zip"
        Copy-Item -LiteralPath $archive -Destination $copy -Force
        $packages += @{ plugin = $Plugin; platform = $platform; path = $copy; sha256 = (Get-FileHash $copy -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    @{ starterCommit = $pin; packages = $packages; log = $log; builtUtc = [DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json -Depth 5 | Set-Content (Join-Path $output "$Plugin-packages.json")
}
Write-Host "PASS: $Plugin $Mode; $log"
