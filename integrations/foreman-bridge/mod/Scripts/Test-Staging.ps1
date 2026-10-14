$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$stage = Join-Path $PSScriptRoot 'Stage-Test.ps1'
if (!(Test-Path $stage)) { throw 'FAIL: staging implementation is absent' }
$scratch = Join-Path $PSScriptRoot '../out/staging-tests'
New-Item -ItemType Directory -Force $scratch | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$destination = '\\wsl.localhost\Debian\home\max\projects\satisfactory-bridge-test\server'
$manifestPath = Join-Path $scratch 'manifest.json'
$archive = Join-Path $scratch 'ForemanBridge-LinuxServer.zip'
function Write-Fixture([string]$Entry) {
    if (Test-Path $archive) { Remove-Item $archive }
    $zip = [IO.Compression.ZipFile]::Open($archive, 'Create')
    try {
        $item = $zip.CreateEntry($Entry)
        $writer = [IO.StreamWriter]::new($item.Open())
        try { $writer.Write('{}') } finally { $writer.Dispose() }
    } finally { $zip.Dispose() }
    @{ packages = @(@{ plugin = 'ForemanBridge'; platform = 'LinuxServer'; path = $archive; sha256 = (Get-FileHash $archive -Algorithm SHA256).Hash }) } |
        ConvertTo-Json -Depth 5 | Set-Content $manifestPath
}
function Expect-Rejection([string]$Name, [scriptblock]$Action, [string]$Pattern) {
    try { & $Action } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw }
        Write-Host "PASS: $Name"
        return
    }
    throw "FAIL: $Name was accepted"
}
Write-Fixture 'ForemanBridge.uplugin'
Expect-Rejection 'production destination' { & $stage -Manifest $manifestPath -Destination 'D:\Epic\Satisfactory' -ValidateOnly } 'allowlist'
Expect-Rejection 'prefix sibling' { & $stage -Manifest $manifestPath -Destination ($destination + '-other') -ValidateOnly } 'allowlist'
Expect-Rejection 'normalised escape' { & $stage -Manifest $manifestPath -Destination ($destination + '\..\production') -ValidateOnly } 'allowlist'
& $stage -Manifest $manifestPath -Destination $destination -ValidateOnly
Write-Host 'PASS: valid package validation'
Add-Content $archive 'tamper'
Expect-Rejection 'tampered archive' { & $stage -Manifest $manifestPath -Destination $destination -ValidateOnly } 'hash'
foreach ($entry in @('../escape', '/absolute', 'C:/absolute', 'Binaries/../../../escape', 'file:stream', 'Source/code.cpp')) {
    Write-Fixture $entry
    Expect-Rejection "unsafe archive entry $entry" { & $stage -Manifest $manifestPath -Destination $destination -ValidateOnly } 'entry'
}
Write-Host 'All staging checks passed; no installation was modified.'
