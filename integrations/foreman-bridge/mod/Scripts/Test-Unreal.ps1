param(
    [Parameter(Mandatory)][string]$Filter,
    [string]$Settings = './build.local.json',
    [int]$TimeoutSeconds = 240,
    [string]$TransportConfig,
    [string]$TestCa
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($Filter -notmatch '^ForemanBridge(?:\.[A-Za-z0-9.]+)?$') { throw 'Invalid bridge test filter' }
$config = Get-Content -Raw -LiteralPath $Settings | ConvertFrom-Json
$editor = Join-Path $config.engineRoot 'Engine\Binaries\Win64\UnrealEditor-Cmd.exe'
$project = Join-Path $config.starterRoot 'FactoryGame.uproject'
$output = Join-Path $config.outputRoot ('automation-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $output | Out-Null
$arguments = @('"' + $project + '"', '-unattended', '-nopause', '-nosplash', '-NullRHI', '-nosound',
    '"-ExecCmds=Automation RunTests ' + $Filter + '"', '"-TestExit=Automation Test Queue Empty"',
    '"-ReportExportPath=' + $output + '"', '"-abslog=' + (Join-Path $output 'editor.log') + '"')
if ($TransportConfig) { $arguments += '"-BridgeTransportTestConfig=' + $TransportConfig + '"' }
if ($TestCa) { $arguments += '"-ini:Engine:[SSL]:DebuggingCertificatePath=' + $TestCa + '"' }
$process = Start-Process -FilePath $editor -ArgumentList ($arguments -join ' ') -PassThru
if (!$process.WaitForExit($TimeoutSeconds * 1000)) {
    $process.Kill()
    throw "Editor automation timed out; output: $output"
}
$process.Refresh()
if ($process.ExitCode -ne 0) { throw "Editor automation exit $($process.ExitCode); output: $output" }
$reportPath = Join-Path $output 'index.json'
if (!(Test-Path $reportPath)) { throw "Automation report missing: $reportPath" }
$report = Get-Content -Raw $reportPath | ConvertFrom-Json
$tests = @($report.tests | Where-Object { $_.fullTestPath.StartsWith($Filter) })
if ($tests.Count -eq 0) { throw "No matching automation tests in $reportPath" }
$failed = @($tests | Where-Object { $_.state -ne 'Success' })
if ($failed.Count -ne 0) { throw "Automation failed/incomplete: $($failed.fullTestPath -join ', '); $reportPath" }
Write-Host "PASS: $($tests.Count) $Filter tests; report: $reportPath"
