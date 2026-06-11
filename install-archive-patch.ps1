$ErrorActionPreference = "Stop"
$root = Get-Location
Write-Host "Installing JJU archive patch into $root"
$files = @(
  "components\LibraryClient.tsx",
  "components\AdminClient.tsx",
  "app\archive\page.tsx",
  "app\layout.tsx",
  "app\api\admin\books\route.ts",
  "app\globals.css",
  "package.json"
)
foreach ($file in $files) {
  $src = Join-Path $PSScriptRoot $file
  $dst = Join-Path $root $file
  $dstDir = Split-Path $dst -Parent
  if (!(Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir | Out-Null }
  Copy-Item $src $dst -Force
  Write-Host "Patched $file"
}
if (Test-Path ".next") { Remove-Item ".next" -Recurse -Force }
Write-Host "Done. Run: npm run dev"
