import io
import re
from typing import Optional

import numpy as np
import pandas as pd


def parse_minutes_from_filename(filename: str) -> Optional[float]:
    """파일명에서 측정 시간(분) 추출. 2.5min, 2.75min 등 소수 분 지원."""
    base_name = re.sub(r'\.[^.]+$', '', filename)
    # \d+(?:\.\d+)? = 정수 또는 소수 (2.5, 2.75 등)
    patterns = [
        r'(?:^|[_\-\s])(?:(\d+)\s*h)?\s*(\d+(?:\.\d+)?)\s*min(?=$|[_\-\s])',
        r'(?:^|[_\-\s])(?:(\d+)\s*h)?\s*(\d+(?:\.\d+)?)\s*m(?=$|[_\-\s])',
        r'(?:^|[_\-\s])(\d+(?:\.\d+)?)\s*h(?=$|[_\-\s])',
    ]

    for pattern in patterns:
        matches = list(re.finditer(pattern, base_name, re.IGNORECASE))
        if not matches:
            continue

        match = matches[-1]
        groups = match.groups()
        if len(groups) == 2:
            hours = int(groups[0]) if groups[0] else 0
            minutes = float(groups[1])
            return float(hours * 60 + minutes)

        if len(groups) == 1 and groups[0]:
            return float(groups[0]) * 60

    return None


def find_numeric_data_start(content: str, fallback: int = 3) -> int:
    """CSV 본문에서 첫 숫자 데이터 행 인덱스를 찾는다."""
    for index, line in enumerate(content.splitlines()[:20]):
        if re.match(r'^\s*-?\d', line):
            return index
    return fallback


def parse_trel_csv_frame(content: str) -> pd.DataFrame:
    """
    TrEL 처리 CSV를 공통 형식 DataFrame으로 파싱한다.

    반환 컬럼:
    - Time (μs)
    - Shifted Time (μs)
    - Normalized intensity (a.u.)
    - Current density (mA cm⁻²)
    - Corrected current density (mA cm⁻²)
    """
    try:
        df = pd.read_csv(
            io.StringIO(content),
            skiprows=find_numeric_data_start(content),
            header=None,
        )
        df = df.apply(pd.to_numeric, errors='coerce')
        df.replace([np.inf, -np.inf], np.nan, inplace=True)
        df = df.dropna(subset=[0, 1, 2], how='any')

        if df.shape[1] < 3:
            return pd.DataFrame()

        while df.shape[1] < 5:
            df[df.shape[1]] = np.nan

        df = df.iloc[:, :5].copy()
        df.columns = [
            'Time (μs)',
            'Shifted Time (μs)',
            'Normalized intensity (a.u.)',
            'Current density (mA cm⁻²)',
            'Corrected current density (mA cm⁻²)',
        ]
        return df
    except Exception:
        return pd.DataFrame()
