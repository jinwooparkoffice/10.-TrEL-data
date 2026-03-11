# TrEL Data 프로젝트 실행 스크립트 (Windows PowerShell)
# Set UTF-8 encoding for console output
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 가상환경 확인
if (-not (Test-Path ".venv")) {
    Write-Host "Error: Virtual environment (.venv) not found." -ForegroundColor Red
    Write-Host "Please run setup.bat first to set up the environment." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Press Enter to exit..."
    Read-Host
    exit 1
}

Write-Host "Activating virtual environment..." -ForegroundColor Cyan
& ".venv\Scripts\Activate.ps1"

# pnpm 확인
$pnpmExists = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmExists) {
    Write-Host "Error: pnpm is not installed." -ForegroundColor Red
    Write-Host "Install: npm install -g pnpm" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Press Enter to exit..."
    Read-Host
    exit 1
}

# Node.js 의존성 확인
if (-not (Test-Path "node_modules")) {
    Write-Host "Node.js dependencies not found. Installing..." -ForegroundColor Yellow
    pnpm install
}

Write-Host ""
Write-Host "Starting frontend and backend..." -ForegroundColor Green
Write-Host "Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host "Backend: http://localhost:8080" -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

# 프론트엔드와 백엔드를 동시에 실행
pnpm run dev:all:direct
