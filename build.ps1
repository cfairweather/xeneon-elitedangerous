#Requires -Version 5.1
<#
.SYNOPSIS
    Packages the widget and bootstraps the companion server.

.DESCRIPTION
    1. Zips com.fairweather.elitedangerous/ → EliteDangerousHUD.widget
       Drop that file into iCUE Widget Builder to import.
    2. Runs `npm install` inside companion/ if node_modules is missing.

.EXAMPLE
    .\build.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root      = $PSScriptRoot
$WidgetSrc = Join-Path $Root 'com.fairweather.elitedangerous'
$Companion = Join-Path $Root 'companion'
$OutFile   = Join-Path $Root 'EliteDangerousHUD.widget'

# ── Helpers ───────────────────────────────────────────────────────────────────

function Write-Header($text) {
    Write-Host ""
    Write-Host "  $text" -ForegroundColor Yellow
    Write-Host "  $('─' * $text.Length)" -ForegroundColor DarkGray
}

function Write-Step($text)  { Write-Host "  $text" -ForegroundColor Cyan }
function Write-Ok($text)    { Write-Host "  [ok]   $text" -ForegroundColor Green }
function Write-Skip($text)  { Write-Host "  [skip] $text" -ForegroundColor DarkGray }
function Write-Warn($text)  { Write-Host "  [warn] $text" -ForegroundColor Yellow }
function Write-Fail($text)  { Write-Host "  [fail] $text" -ForegroundColor Red }

# ── 1. Widget package ─────────────────────────────────────────────────────────

Write-Header "ELITE DANGEROUS HUD — BUILD"

Write-Step "Packaging $WidgetSrc ..."

if (-not (Test-Path $WidgetSrc)) {
    Write-Fail "Widget source directory not found: $WidgetSrc"
    exit 1
}

# Remove stale package
if (Test-Path $OutFile) {
    Remove-Item $OutFile -Force
}

# Zip contents (not the folder itself) so manifest.json sits at the archive root
Compress-Archive -Path "$WidgetSrc\*" -DestinationPath $OutFile -Force

$size = [math]::Round((Get-Item $OutFile).Length / 1KB, 1)
Write-Ok "EliteDangerousHUD.widget  ($size KB)"
Write-Host "       $OutFile" -ForegroundColor DarkGray

# ── 2. Companion — npm install ────────────────────────────────────────────────

Write-Step "Checking companion dependencies ..."

$nodeModules = Join-Path $Companion 'node_modules'

if (Test-Path $nodeModules) {
    Write-Skip "node_modules already present — skipping install"
} else {
    # Verify Node.js is available
    $nodeBin = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeBin) {
        Write-Warn "Node.js not found — skipping npm install."
        Write-Warn "Download from https://nodejs.org then re-run this script."
    } else {
        Write-Step "Running npm install in companion\ ..."
        Push-Location $Companion
        try {
            & npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install exited with code $LASTEXITCODE" }
            Write-Ok "Companion dependencies installed"
        } finally {
            Pop-Location
        }
    }
}

# ── Done ──────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "  BUILD COMPLETE" -ForegroundColor Green
Write-Host "  ─────────────────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  1. Open iCUE → Widget Builder → Import Widget" -ForegroundColor White
Write-Host "  2. Select EliteDangerousHUD.widget from this folder" -ForegroundColor White
Write-Host "  3. Double-click companion\start.bat to start the server" -ForegroundColor White
Write-Host ""
