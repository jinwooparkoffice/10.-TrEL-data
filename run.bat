@echo off
REM TrEL Data 프로젝트 실행 스크립트 (Windows)

REM 가상환경 확인
if not exist ".venv" (
    echo 오류: 가상환경(.venv)이 없습니다.
    echo 먼저 setup.bat를 실행하여 환경을 설정하세요.
    pause
    exit /b 1
)

echo 가상환경을 활성화합니다...
call .venv\Scripts\activate.bat

REM pnpm 확인
where pnpm >nul 2>&1
if errorlevel 1 (
    echo 오류: pnpm이 설치되어 있지 않습니다.
    echo 설치: npm install -g pnpm
    pause
    exit /b 1
)

REM Node.js 의존성 확인
if not exist "node_modules" (
    echo Node.js 의존성이 없습니다. 설치합니다...
    pnpm install
)

echo.
echo 프론트엔드와 백엔드를 시작합니다...
echo 프론트엔드: http://localhost:3000
echo 백엔드: http://localhost:8080
echo 종료하려면 Ctrl+C를 누르세요.
echo.

REM 프론트엔드와 백엔드를 동시에 실행
pnpm run dev:all:direct
