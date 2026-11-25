<#
.SYNOPSIS
  Prüft die Emulatoren (Boxedwine, js-dos, v86) auf neue Versionen und aktualisiert sie auf Wunsch.

.DESCRIPTION
  Ruft scripts/update-runtimes.mjs auf (benötigt Node.js 22 oder neuer).
  Ohne -Apply wird nur angezeigt, was sich ändern würde.
  Mit -Apply werden die neuen Versionen in scripts/fetch-runtimes.mjs eingetragen
  und alle Emulatoren und Demos neu heruntergeladen. Danach die Demos testen und committen.

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
  Write-Error 'Node.js wurde nicht gefunden. Bitte Node.js 22 oder neuer installieren (https://nodejs.org).'
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
