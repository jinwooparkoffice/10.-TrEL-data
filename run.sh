#!/bin/bash
# TrEL Data 프로젝트 실행 스크립트 (Mac/Linux)

set -e

# 가상환경 확인 및 활성화
if [ ! -d ".venv" ]; then
    echo "오류: 가상환경(.venv)이 없습니다."
    echo "먼저 ./setup.sh를 실행하여 환경을 설정하세요."
    exit 1
fi

echo "가상환경을 활성화합니다..."
source .venv/bin/activate

# pnpm 확인
if ! command -v pnpm &> /dev/null; then
    echo "오류: pnpm이 설치되어 있지 않습니다."
    echo "설치: npm install -g pnpm"
    exit 1
fi

# Node.js 의존성 확인
if [ ! -d "node_modules" ]; then
    echo "Node.js 의존성이 없습니다. 설치합니다..."
    pnpm install
fi

echo ""
echo "프론트엔드와 백엔드를 시작합니다..."
echo "프론트엔드: http://localhost:3000"
echo "백엔드: http://localhost:8080"
echo "종료하려면 Ctrl+C를 누르세요."
echo ""

# 프론트엔드와 백엔드를 동시에 실행
pnpm run dev:all:direct
