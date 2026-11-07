$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageVersion = (Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$packageName = "SmallStocks-TW-$packageVersion-windows-x64"
$packageDir = Join-Path $projectRoot "releases\$packageName"
$exePath = Join-Path $projectRoot 'src-tauri\target\release\smallstocks-tw.exe'
if (-not (Test-Path -LiteralPath $exePath)) { throw 'Build the release executable first.' }
New-Item -ItemType Directory -Force -Path $packageDir | Out-Null
Copy-Item -LiteralPath $exePath -Destination (Join-Path $packageDir 'smallstocks-tw.exe')
foreach ($documentName in @('README.md', 'LICENSE', 'NOTICE')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $documentName) -Destination (Join-Path $packageDir $documentName)
}
$guideDir = Join-Path $packageDir 'docs'
New-Item -ItemType Directory -Force -Path $guideDir | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\USAGE.zh-TW.md') -Destination (Join-Path $guideDir 'USAGE.zh-TW.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\media') -Destination (Join-Path $guideDir 'media') -Recurse -Force
$iconDir = Join-Path $packageDir 'src-tauri\icons'
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'src-tauri\icons\128x128.png') -Destination (Join-Path $iconDir '128x128.png')
Set-Content -LiteralPath (Join-Path $packageDir 'Demo.cmd') -Encoding ascii -Value '@echo off', 'start "" "%~dp0smallstocks-tw.exe" --demo'
$zipPath = Join-Path $projectRoot "releases\$packageName.zip"
Compress-Archive -LiteralPath $packageDir -DestinationPath $zipPath -Force
Get-Item -LiteralPath $zipPath | Select-Object FullName, Length
Get-FileHash -LiteralPath (Join-Path $packageDir 'smallstocks-tw.exe') -Algorithm SHA256
