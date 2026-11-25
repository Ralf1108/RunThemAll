<#
.SYNOPSIS
  Checks the emulators (Boxedwine, js-dos, v86) for new versions and updates them if wanted.

.DESCRIPTION
  Runs scripts/update-runtimes.mjs (needs Node.js 22 or newer).
  Without -Apply it only shows what would change.
  With -Apply the new versions are written to scripts/fetch-runtimes.mjs and all emulators
  and demos are downloaded again. Then test the demos and commit.
  See docs/development.md.

.EXAMPLE
  .\scripts\update.ps1
  .\scripts\update.ps1 -Apply
#>
param(
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js not found. Please install Node.js 22 or newer (https://nodejs.org).'
}

$arguments = @(Join-Path $root 'scripts\update-runtimes.mjs')
if ($Apply) { $arguments += '--apply' }

Push-Location $root
try {
  & node @arguments
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
