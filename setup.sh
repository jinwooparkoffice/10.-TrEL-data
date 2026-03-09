#!/bin/bash
# TrEL Data 프로젝트 초기 설정 스크립트 (Mac/Linux)

set -e

echo "TrEL Data 프로젝트 설정을 시작합니다..."

# Python 버전 확인
if ! command -v python3 &> /dev/null; then
    echo "오류: python3가 설치되어 있지 않습니다."
    exit 1
fi

# 가상환경 생성
if [ ! -d ".venv" ]; then
    echo "가상환경(.venv)을 생성합니다..."
    python3 -m venv .venv
else
    echo "가상환경(.venv)이 이미 존재합니다."
fi

# 가상환경 활성화
echo "가상환경을 활성화합니다..."
source .venv/bin/activate

# pip 업그레이드
echo "pip를 업그레이드합니다..."
pip install --upgrade pip

# Python 의존성 설치
echo "Python 의존성을 설치합니다..."
pip install -r requirements.txt

# Node.js 의존성 설치 (pnpm 사용)
if command -v pnpm &> /dev/null; then
    echo "Node.js 의존성을 설치합니다..."
    pnpm install
else
    echo "경고: pnpm이 설치되어 있지 않습니다. Node.js 의존성 설치를 건너뜁니다."
    echo "pnpm 설치: npm install -g pnpm"
fi

echo ""
echo "설정이 완료되었습니다!"
echo ""
echo "프로젝트 실행 방법:"
echo "  ./run.sh"
echo "또는"
echo "  source .venv/bin/activate && python app.py"
echo ""
