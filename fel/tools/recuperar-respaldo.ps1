# NEXA FEL · Recuperación verificada de un respaldo desde Cloudflare R2 (Windows 11, PowerShell).
# Solo PREPARA y llama a recuperar-respaldo.py. No toca nexa-demo ni ningún Supabase ni una base local que ya tengas: restaura en un PostgreSQL 17 NUEVO y temporal
# (preferentemente un contenedor Docker «postgres:17» sin puertos publicados; si no hay Docker, un PostgreSQL 17 instalado con un clúster nuevo).
# Tu clave privada de age NO se sube, NO se lee aquí y NO se imprime: solo se pasa su RUTA a age.
# Las credenciales de R2 se piden sin mostrarlas, viven solo en esta sesión de PowerShell y se borran al terminar (un token de SOLO LECTURA basta).
param(
  [string]$Base = "nexa-demo/20261124-120509-b0bd6343",
  [string]$Bucket = "nexa-fel-backups",
  [string]$ShaEsperado = "b0bd634320e97dc9cb4ddcaef17c3e2d2c50a01c24e44faa425bcbf892eec7c8",
  [string]$Clave = "",
  [string]$Carpeta = "",
  [string]$PgBin = "",
  [ValidateSet("auto", "docker", "nativo")][string]$Modo = "auto",
  [string]$Informe = ""
)
$ErrorActionPreference = "Stop"
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$fel = Split-Path -Parent $aqui

function Falta($texto, $comando) { Write-Host "FALTA: $texto" -ForegroundColor Yellow; Write-Host "  Instálalo con:  $comando" -ForegroundColor Yellow; exit 2 }

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { Falta "Python 3" "winget install Python.Python.3.12   (cierra y abre PowerShell después)" }
$age = Get-Command age -ErrorAction SilentlyContinue
if (-not $age) { Falta "age" "winget install FiloSottile.age   (cierra y abre PowerShell después)" }
$dockerListo = $false
if ($Modo -ne "nativo" -and (Get-Command docker -ErrorAction SilentlyContinue)) {
  & docker info *> $null
  if ($LASTEXITCODE -eq 0) { $dockerListo = $true }
}
if ($Modo -eq "docker" -and -not $dockerListo) { Falta "Docker en marcha (abre Docker Desktop y espera a que diga 'running')" "winget install Docker.DockerDesktop   (reinicia si te lo pide)" }
if ($Modo -eq "auto" -and $dockerListo) { $Modo = "docker" }
if ($Modo -ne "docker") {
  if (-not $PgBin) {
    $cand = @("C:\Program Files\PostgreSQL\17\bin", "C:\Program Files (x86)\PostgreSQL\17\bin") | Where-Object { Test-Path (Join-Path $_ "pg_restore.exe") }
    if ($cand) { $PgBin = $cand[0] }
  }
  if (-not $PgBin -or -not (Test-Path (Join-Path $PgBin "pg_restore.exe"))) { Falta "Docker en marcha (recomendado) o PostgreSQL 17" "winget install Docker.DockerDesktop   (o: winget install PostgreSQL.PostgreSQL.17 y -PgBin 'C:\ruta\PostgreSQL\17\bin')" }
  $Modo = "nativo"
}
if (-not $Clave) { $Clave = Read-Host "Ruta del archivo de tu clave PRIVADA de age (por ejemplo C:\Users\tu-usuario\age-clave.txt)" }
$Clave = $Clave.Trim('"')
if (-not (Test-Path -LiteralPath $Clave -PathType Leaf)) { Write-Host "No existe el archivo de clave que indicaste." -ForegroundColor Red; exit 2 }

if (-not $Informe) { $Informe = Join-Path ([Environment]::GetFolderPath("MyDocuments")) ("informe-recuperacion-nexa-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".txt") }
$argumentos = @((Join-Path $aqui "recuperar-respaldo.py"), "--base", $Base, "--bucket", $Bucket, "--clave", $Clave, "--repo", $fel, "--informe", $Informe)
if ($Modo -eq "docker") { $argumentos += "--docker" } else { $argumentos += @("--pgbin", $PgBin) }
Write-Host "Modo: $Modo · informe: $Informe"
if ($ShaEsperado) { $argumentos += @("--sha-esperado", $ShaEsperado) }
$variables = @("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
try {
  if ($Carpeta) {
    $argumentos += @("--carpeta", $Carpeta.Trim('"'))
  } else {
    $argumentos += "--descargar"
    $env:R2_ACCOUNT_ID = (Read-Host "R2 · ID de cuenta (Account ID)").Trim()
    $env:R2_ACCESS_KEY_ID = (Read-Host "R2 · Access Key ID").Trim()
    $seguro = Read-Host "R2 · Secret Access Key (no se muestra)" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
    try { $env:R2_SECRET_ACCESS_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
  & python @argumentos
  $codigo = $LASTEXITCODE
} finally {
  foreach ($v in $variables) { Remove-Item "Env:$v" -ErrorAction SilentlyContinue }
}
if ($codigo -eq 0) { Write-Host "`nRESULTADO: recuperación verificada. El informe quedó en $Informe (no contiene datos ni claves); pégame su contenido." -ForegroundColor Green }
else { Write-Host "`nRESULTADO: la recuperación NO se verificó (código $codigo). Pégame el mensaje de FALLO." -ForegroundColor Red }
exit $codigo
