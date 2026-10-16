param([ValidateSet('State','Delivery','Recapture')][string]$Case = 'State')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root 'out\core-tests'
New-Item -ItemType Directory -Force $output | Out-Null
$vcvars = 'D:\Modding\Toolchains\VS2022\VC\Auxiliary\Build\vcvarsall.bat'
$core = Join-Path $root 'Source\ForemanBridge\Private\Core'
$sources = @((Join-Path $root 'Tests\CoreTests.cpp'), (Join-Path $core 'BridgeState.cpp'), (Join-Path $core 'BridgeDelivery.cpp'), (Join-Path $core 'RecaptureQueue.cpp'))
$sourceArgs = ($sources | ForEach-Object { '"' + $_ + '"' }) -join ' '
$exe = Join-Path $output 'CoreTests.exe'
$batch = Join-Path $output 'compile.cmd'
@"
@echo off
call "$vcvars" x64 10.0.22621.0 -vcvars_ver=14.38
if errorlevel 1 exit /b 1
cl /nologo /std:c++20 /EHsc /W4 /WX /utf-8 /I"$core" $sourceArgs /Fe:"$exe" /Fo:"$output\\"
exit /b %errorlevel%
"@ | Set-Content -Encoding ASCII $batch
& $env:ComSpec /d /c $batch
if ($LASTEXITCODE -ne 0) { throw 'Core compilation failed' }
& $exe $Case
if ($LASTEXITCODE -ne 0) { throw "Core $Case tests failed" }
