# Builds the Windows installer and the distributable zip.
#
#   npm run dist           (or: powershell -ExecutionPolicy Bypass -File installer\build.ps1)
#
# Output in installer\out\:
#   FinancialVisualizationTool-Setup-<version>.exe
#   FinancialVisualizationTool-<version>.zip   (Setup .exe + README.txt + SHA256SUMS.txt)
#
# -SkipBackend reuses backend\dist\fvt-backend when only the installer or screens changed.
param([switch]$SkipBackend)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }

Step '1/5 Backend: install pinned dependencies'
if (-not $SkipBackend) {
& backend\.venv\Scripts\python.exe -m pip install --quiet -r backend\requirements-dev.txt
if ($LASTEXITCODE) { throw 'pip install failed' }

Step '2/5 Backend: package with PyInstaller (no Python needed on the target PC)'
Push-Location backend
& .venv\Scripts\pyinstaller.exe backend.spec --noconfirm --clean --log-level WARN
$code = $LASTEXITCODE
Pop-Location
if ($code) { throw 'PyInstaller failed' }
} else { Write-Host 'skipped (using existing backend\dist\fvt-backend)' }

Step '3/5 Screens and desktop shell'
& npm run build
if ($LASTEXITCODE) { throw 'npm run build failed' }

Step '4/5 Windows installer (electron-builder, NSIS)'
Remove-Item -Recurse -Force installer\out -ErrorAction SilentlyContinue
& npx electron-builder --config installer/electron-builder.yml --win nsis --x64 --publish never
if ($LASTEXITCODE) { throw 'electron-builder failed' }

Step '5/5 Checksum and zip'
$version = (Get-Content package.json -Raw | ConvertFrom-Json).version
$setup = Get-Item "installer\out\FinancialVisualizationTool-Setup-$version.exe"
$hash = (Get-FileHash $setup.FullName -Algorithm SHA256).Hash.ToLower()
$sums = Join-Path installer\out 'SHA256SUMS.txt'
"$hash  $($setup.Name)" | Set-Content -Encoding ascii $sums
$stage = Join-Path installer\out 'zip'
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item $setup.FullName, $sums $stage
Copy-Item installer\README-install.txt (Join-Path $stage 'README.txt')
$zip = "installer\out\FinancialVisualizationTool-$version.zip"
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
Remove-Item -Recurse -Force $stage

Write-Host "`nDone." -ForegroundColor Green
Write-Host "Installer: $($setup.FullName)"
Write-Host "Zip:       $(Resolve-Path $zip)"
Write-Host "SHA-256:   $hash"
