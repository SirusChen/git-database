# launch-edge-debug.ps1
# Launch Microsoft Edge with a CDP (Chrome DevTools Protocol) remote-debugging
# port, using an ISOLATED user-data-dir so your daily Edge / login state is
# never touched. Then wait until the DevTools HTTP endpoint is ready and print
# the active port in a machine-readable form (CDP_PORT=<port>).
#
# This is the built-in launcher for the `edge-debug-browser` skill. After
# "CDP READY" you drive the browser entirely through agent-browser:
#
#   agent-browser --cdp <port> open <URL>
#   agent-browser --cdp <port> console
#
# Usage (PowerShell):
#   pwsh -File launch-edge-debug.ps1                 # default port 9222
#   pwsh -File launch-edge-debug.ps1 -Port 9333      # custom port
#   pwsh -File launch-edge-debug.ps1 -StartUrl https://example.com
#
# Notes:
#   - If the requested port is already busy, Edge silently picks another one.
#     We detect the real port from DevToolsActivePort and echo it as
#     CDP_PORT=<port>, so always parse that line instead of assuming -Port.
#   - UserDataDir is isolated; pass -UserDataDir to reuse a different profile.

param(
  [int]    $Port = 9222,
  [string] $UserDataDir = "D:\download\edge-user-data",
  [string] $EdgeExe = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  [string] $StartUrl = ""
)

$ErrorActionPreference = 'Stop'

# --- locate Edge executable (x86 first, then x64) ---
if (-not (Test-Path $EdgeExe)) {
  $EdgeExe = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
}
if (-not (Test-Path $EdgeExe)) {
  Write-Error "Edge executable not found. Please set -EdgeExe to your msedge.exe path."
  exit 1
}

# --- ensure parent of UserDataDir exists ---
$parent = Split-Path $UserDataDir
if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

Write-Output "[1/3] Launching Edge (debug) ..."
Write-Output "      exe : $EdgeExe"
Write-Output "      dir : $UserDataDir"
Write-Output "      port: $Port"

$edgeArgs = @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$UserDataDir",
  "--no-first-run",
  "--no-default-browser-check"
)
if ($StartUrl -ne "") { $edgeArgs += $StartUrl }

# Start detached so the script can return; Edge keeps running in the background.
Start-Process -FilePath $EdgeExe -ArgumentList $edgeArgs

Write-Output "[2/3] Waiting for CDP on port $Port ..."
$ready = $false
$activePort = $Port
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$activePort/json/version" -TimeoutSec 2
    $ready = $true
    break
  } catch {
    # Edge may have chosen a different port if -Port was occupied.
    $dap = Join-Path $UserDataDir "DevToolsActivePort"
    if (Test-Path $dap) {
      $activePort = (Get-Content $dap | Select-Object -First 1)
    }
  }
}

if (-not $ready) {
  Write-Warning "CDP not ready within 30s. Port $Port may be occupied or Edge failed to start."
  Write-Warning "Fix: choose another -Port, or close the old instance using $Port first."
  exit 1
}

$r = Invoke-RestMethod -Uri "http://127.0.0.1:$activePort/json/version" -TimeoutSec 2
Write-Output "[3/3] CDP READY"
Write-Output "CDP_PORT=$activePort"
Write-Output "      Browser : $($r.Browser)"
Write-Output "      Endpoint: http://127.0.0.1:$activePort/json/version"
Write-Output "      WS      : $($r.webSocketDebuggerUrl)"
Write-Output ""
Write-Output "Next: agent-browser --cdp $activePort open <URL>"
