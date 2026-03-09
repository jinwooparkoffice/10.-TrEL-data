@echo off
REM TrEL Data 프로젝트 초기 설정 스크립트 (Windows)

echo TrEL Data 프로젝트 설정을 시작합니다...

REM Python 확인
python --version >nul 2>&1
if errorlevel 1 (
    echo 오류: Python이 설치되어 있지 않습니다.
    exit /b 1
)

REM 가상환경 생성
if not exist ".venv" (
    echo 가상환경(.venv)을 생성합니다...
    python -m venv .venv
) else (
    echo 가상환경(.venv)이 이미 존재합니다.
)

REM 가상환경 활성화
echo 가상환경을 활성화합니다...
call .venv\Scripts\activate.bat

REM pip 업그레이드
echo pip를 업그레이드합니다...
python -m pip install --upgrade pip

REM Python 의존성 설치
echo Python 의존성을 설치합니다...
pip install -r requirements.txt

REM Node.js 의존성 설치 (pnpm 사용)
where pnpm >nul 2>&1
if errorlevel 1 (
    echo 경고: pnpm이 설치되어 있지 않습니다. Node.js 의존성 설치를 건너뜁니다.
    echo pnpm 설치: npm install -g pnpm
) else (
    echo Node.js 의존성을 설치합니다...
    pnpm install
)

echo.
echo 설정이 완료되었습니다!
echo.
echo 프로젝트 실행 방법:
echo   run.bat
echo 또는
echo   .venv\Scripts\activate.bat
echo   python app.py
echo.

pause
