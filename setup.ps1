# TrEL Data 프로젝트 초기 설정 스크립트 (Windows PowerShell)
# Set UTF-8 encoding for console output
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "Starting TrEL Data project setup..." -ForegroundColor Green

# Python 확인
try {
    $pythonVersion = python --version 2>&1
    Write-Host "Found: $pythonVersion" -ForegroundColor Cyan
} catch {
    Write-Host "Error: Python is not installed." -ForegroundColor Red
    Write-Host "Please install Python 3.8 or higher." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# 가상환경 생성
if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment (.venv)..." -ForegroundColor Cyan
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to create virtual environment." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
} else {
    Write-Host "Virtual environment (.venv) already exists." -ForegroundColor Yellow
}

# 가상환경 활성화
Write-Host "Activating virtual environment..." -ForegroundColor Cyan
& ".venv\Scripts\Activate.ps1"

# pip 업그레이드
Write-Host "Upgrading pip..." -ForegroundColor Cyan
python -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    Write-Host "Warning: Failed to upgrade pip. Continuing..." -ForegroundColor Yellow
}

# Python 의존성 설치
Write-Host "Installing Python dependencies..." -ForegroundColor Cyan
if (Test-Path "requirements.txt") {
    pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to install Python dependencies." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
} else {
    Write-Host "Warning: requirements.txt not found. Skipping Python dependencies." -ForegroundColor Yellow
}

# Node.js 의존성 설치 (pnpm 사용)
$pnpmExists = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmExists) {
    Write-Host "Warning: pnpm is not installed. Skipping Node.js dependencies." -ForegroundColor Yellow
    Write-Host "Install pnpm: npm install -g pnpm" -ForegroundColor Cyan
} else {
    Write-Host "Installing Node.js dependencies..." -ForegroundColor Cyan
    pnpm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Warning: Failed to install Node.js dependencies." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Setup completed!" -ForegroundColor Green
Write-Host ""
Write-Host "To run the project:" -ForegroundColor Cyan
Write-Host "  .\run.ps1" -ForegroundColor White
Write-Host "or" -ForegroundColor Gray
Write-Host "  .\run.bat" -ForegroundColor White
Write-Host "or" -ForegroundColor Gray
Write-Host "  .venv\Scripts\Activate.ps1" -ForegroundColor White
Write-Host "  python app.py" -ForegroundColor White
Write-Host ""

Read-Host "Press Enter to exit"
