# Inicia la DEMOSTRACIÓN de facturación individual SIMULADA de NEXA FEL (Windows / PowerShell).
# Todo es simulado: no usa credenciales, no se conecta a SAT ni a ningún certificador y no emite nada.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
$deno = Get-Command deno -ErrorAction SilentlyContinue
if (-not $deno) {
  Write-Host ""
  Write-Host "Falta Deno (un programa gratuito para ejecutar la demostración)." -ForegroundColor Yellow
  Write-Host "Instálalo UNA vez con uno de estos comandos y vuelve a abrir esta ventana:" -ForegroundColor Yellow
  Write-Host "    winget install DenoLand.Deno"
  Write-Host "    irm https://deno.land/install.ps1 | iex"
  exit 1
}
Write-Host "Iniciando la demostración (la primera vez descarga un componente de base de datos y tarda un poco)..."
Write-Host "Cuando aparezca la dirección, ábrela en Chrome. Para salir: Ctrl+C."
deno run -A servidor.ts
