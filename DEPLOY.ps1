# ============================================================
# BePharma CRM — Git push + Vercel deploy
# Ejecutar en PowerShell desde la carpeta bepharma-crm
# ============================================================

$ErrorActionPreference = "Continue"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $dir

Write-Host "=== BePharma CRM Deploy ===" -ForegroundColor Cyan

# ── Git ────────────────────────────────────────────────────────────────────────
Write-Host "`n[1/3] Verificando Git..." -ForegroundColor Yellow
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git no encontrado. Instala desde https://git-scm.com" -ForegroundColor Red
    exit 1
}

# Verificar si el repo git está realmente operativo (no solo si existe .git)
$gitOk = (git rev-parse --git-dir 2>$null)
if (-not $gitOk) {
    Write-Host "  Inicializando repo git..." -ForegroundColor Yellow
    git init
    git remote add origin https://github.com/gustavoamv2/bepharma-crm.git
    Write-Host "  Repo inicializado" -ForegroundColor Green
} else {
    Write-Host "  Repo git OK" -ForegroundColor Green
    # Asegurar que el remote existe
    $remotes = git remote
    if ($remotes -notcontains 'origin') {
        git remote add origin https://github.com/gustavoamv2/bepharma-crm.git
    }
}

Write-Host "`n[2/3] Commit y push..." -ForegroundColor Yellow
git add -A
git status --short
git commit -m "fix: asociacion deal-empresa 415 - agregar Content-Type en PUT"
git branch -M main
git push -u origin main

Write-Host "`n[3/4] Deploy a Vercel..." -ForegroundColor Yellow
vercel --prod --yes

Write-Host "`n=== DEPLOY COMPLETADO ===" -ForegroundColor Green
Write-Host "URL: https://bepharma-crm.vercel.app" -ForegroundColor Cyan
