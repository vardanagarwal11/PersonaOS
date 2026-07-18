# PersonaOS — local dev launcher (Windows / PowerShell)
# Starts the backend (:4000) and frontend (:4001) together.
# Usage:  ./start.ps1        (installs deps if missing, then runs)
#         ./start.ps1 -Fresh (force reinstall deps first)

param([switch]$Fresh)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Info($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }

Write-Host ""
Write-Host "PersonaOS — starting local dev" -ForegroundColor White
Write-Host ""

# --- 1. env check ---
if (-not (Test-Path "$root\backend\.env")) {
  Warn "backend\.env missing. Copy backend\.env.example to backend\.env and fill it in."
  exit 1
}
if (-not (Test-Path "$root\frontend\.env")) {
  Info "frontend\.env missing — creating a default one."
  "NEXT_PUBLIC_API=http://localhost:4000" | Out-File -FilePath "$root\frontend\.env" -Encoding utf8
}

# --- 2. deps ---
foreach ($dir in @("backend", "frontend")) {
  $path = Join-Path $root $dir
  if ($Fresh -or -not (Test-Path (Join-Path $path "node_modules"))) {
    Info "Installing $dir dependencies..."
    Push-Location $path
    npm install
    Pop-Location
  }
}

# --- 3. launch both, each in its own window so logs stay readable ---
Ok "Backend  -> http://localhost:4000"
Ok "Frontend -> http://localhost:4001"
Write-Host ""
Info "Two windows will open. Close them (or Ctrl+C in each) to stop."
Write-Host ""

Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$root\backend'; `$host.UI.RawUI.WindowTitle='PersonaOS API :4000'; npm start"
)

Start-Process powershell -ArgumentList @(
  "-NoExit", "-Command",
  "Set-Location '$root\frontend'; `$host.UI.RawUI.WindowTitle='PersonaOS Web :4001'; `$env:PORT=4001; npm run dev"
)

Start-Sleep -Seconds 2
Ok "Launched. Open http://localhost:4001 once the frontend finishes compiling."
