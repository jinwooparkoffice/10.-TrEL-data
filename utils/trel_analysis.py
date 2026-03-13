"""
TrEL 자동 배치 분석
- Rise, Saturation, Decay 파라미터 추출
- 입력: TrEL_processed CSV (Col0: Time(μs), Col1: Shifted Time(μs), Col2: Norm.Luminance, Col3: Current Density)
- Time Definitions:
  - Time (μs): Raw Time. t=0 is Voltage ON (Rise Start).
  - Shifted Time (μs): t=0 is Voltage OFF (Decay Start).
- Analysis:
  - Rise: Uses 'Time (μs)' around t=0.
  - Decay: Uses 'Shifted Time (μs)' for t >= decay_fit_start_us (default 4 us).
"""
import re
import io
from typing import List, Dict, Tuple, Optional
import numpy as np
import pandas as pd
from scipy.optimize import curve_fit

from utils.trel_common import parse_minutes_from_filename, parse_trel_csv_frame


def parse_vil_processed_for_voltage(content: str) -> Tuple[Optional[float], List[Tuple[float, float]]]:
    """
    VIL_processed CSV 파싱: time_shift_s 및 (Time min, Voltage) 목록
    Pandas Optimized
    """
    # 1. 메타데이터 파싱 (time_shift_s)
    time_shift_s = None
    lines = content.splitlines()
    if lines and lines[0].startswith('#'):
        m = re.search(r'time_shift_s:\s*([\d.eE+-]+)', lines[0])
        if m:
            time_shift_s = float(m.group(1))

    # 2. 데이터 파싱
    try:
        # comment='#'로 주석 행 무시
        df = pd.read_csv(io.StringIO(content), comment='#')
        
        # 컬럼명 정규화 (공백 제거)
        df.columns = df.columns.str.strip()
        
        # 필수 컬럼 확인
        time_col = next((c for c in df.columns if 'Time (min)' in c), None)
        volt_col = next((c for c in df.columns if 'Voltage (V)' in c), None)

        if time_col and volt_col:
            # numpy array로 변환 후 list of tuples로 변환
            data = list(zip(df[time_col], df[volt_col]))
            return time_shift_s, data
            
        # Fallback: 컬럼 인덱스로 접근 (0, 1)
        if len(df.columns) >= 2:
             data = list(zip(df.iloc[:, 0], df.iloc[:, 1]))
             return time_shift_s, data

    except Exception:
        pass
        
    return time_shift_s, []


def interpolate_voltage_at_time(t_min: float, vil_data: List[Tuple[float, float]]) -> Optional[float]:
    """VIL 데이터에서 주어진 t_min에 해당하는 voltage 보간"""
    if not vil_data:
        return None
    # list -> numpy array 변환 (한 번만 수행하도록 최적화 가능하지만, 여기선 간단히)
    # 데이터가 이미 정렬되어 있다고 가정할 수 없으므로 정렬 수행
    vil_arr = np.array(vil_data)
    # t 기준으로 정렬
    vil_arr = vil_arr[vil_arr[:, 0].argsort()]
    
    t_arr = vil_arr[:, 0]
    v_arr = vil_arr[:, 1]
    
    if t_min <= t_arr[0]:
        return float(v_arr[0])
    if t_min >= t_arr[-1]:
        return float(v_arr[-1])
    return float(np.interp(t_min, t_arr, v_arr))


def parse_trel_csv(content: str) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    TrEL CSV 파싱
    Col0: Time (μs) -> time_raw
    Col1: Shifted Time (μs) -> time_shifted
    Col2: Norm. Intensity -> el_signal
    Col3: Current Density -> current_density
    """
    df = parse_trel_csv_frame(content)
    if df.empty:
        return np.array([]), np.array([]), np.array([]), np.array([])

    time_raw = df.iloc[:, 0].to_numpy()
    time_shifted = df.iloc[:, 1].to_numpy()
    el_signal = df.iloc[:, 2].to_numpy()
    current_density = df.iloc[:, 3].fillna(0.0).to_numpy()
    return time_raw, time_shifted, el_signal, current_density


def extract_normalized_intensity(content: str) -> List[float]:
    """Normalized intensity 열만 추출"""
    try:
        # Auto-detect header/start of data
        lines = content.splitlines()
        start_idx = 3 # Default fallback
        for i, line in enumerate(lines[:20]):
            if re.match(r'^\s*-?\d', line):
                start_idx = i
                break
        
        # usecols=[2]로 3번째 컬럼만 읽기 (속도 최적화)
        df = pd.read_csv(io.StringIO(content), skiprows=start_idx, header=None, usecols=[2])
        if not df.empty:
            return df.iloc[:, 0].tolist()
    except Exception:
        pass
    return []


def analyze_rise(
    time_raw: np.ndarray,
    time_shifted: np.ndarray,
    el_signal: np.ndarray,
    low_pct: float,
    high_pct: float,
) -> Dict:
    """
    Rise 파라미터 분석 (t_delay, t_rise, t_saturation)
    - 분석 대상: time_shifted <= 0 구간 (Pulse ON 전체)
    - 알고리즘: Center-Out Search (t_50 기준 양방향 탐색)
      1. t_50 (50%) 지점 찾기 (가장 가파르고 안정적인 구간)
      2. t_delay: t_50에서 왼쪽(과거)으로 역추적하여 Low% 찾기
      3. t_saturation: t_50에서 오른쪽(미래)으로 탐색하여 High% 찾기
    """
    low_val = low_pct / 100.0
    high_val = high_pct / 100.0
    mid_val = 0.5  # 50% 기준점

    # 1. Rise 구간 필터링: Pulse ON 구간 전체
    mask = time_shifted <= 0
    
    if not np.any(mask):
        return {'t_delay': None, 't_rise': None, 't_saturation': None, 'error': 'Rise 구간 없음'}

    t_r = time_raw[mask]
    y_r = el_signal[mask]

    if len(t_r) < 5:
        return {'t_delay': None, 't_rise': None, 't_saturation': None, 'error': '데이터 부족'}

    # 2. t_50 (50%) 찾기 - Forward Search
    # User Request: t_50은 t > 0 구간에서 먼저 찾기 (Trigger 이후의 Rise만 유효하다고 가정)
    
    # t > 0 인 인덱스 찾기
    start_idx = 0
    for i, t_val in enumerate(t_r):
        if t_val > 0:
            start_idx = i
            break
            
    idx_50 = -1
    
    # 1차 시도: t > 0 구간에서 탐색
    for i in range(start_idx, len(t_r) - 1):
        if (y_r[i] <= mid_val <= y_r[i+1]) or (y_r[i] >= mid_val >= y_r[i+1]):
            idx_50 = i
            break
            
    # 2차 시도: 만약 못 찾았다면 전체 구간에서 탐색 (Fallback)
    # (예: Pre-trigger 구간에 Rise가 있는 경우 등)
    if idx_50 == -1 and start_idx > 0:
        for i in range(len(t_r) - 1):
             if (y_r[i] <= mid_val <= y_r[i+1]) or (y_r[i] >= mid_val >= y_r[i+1]):
                idx_50 = i
                break
            
    if idx_50 == -1:
        return {'t_delay': None, 't_rise': None, 't_saturation': None, 'error': '50% 도달 실패'}

    # 3. 양방향 탐색 (Center-Out)
    
    def interpolate_crossing(t_arr, y_arr, target, direction='forward'):
        """
        주어진 방향으로 target을 교차하는 지점을 찾아 선형 보간.
        direction='forward': 인덱스 증가 방향 (t_50 -> t_sat)
        direction='backward': 인덱스 감소 방향 (t_50 -> t_delay)
        """
        if direction == 'forward':
            # t_50부터 끝까지 검색
            for i in range(len(t_arr) - 1):
                val_a, val_b = y_arr[i], y_arr[i+1]
                if (val_a <= target <= val_b) or (val_a >= target >= val_b):
                    if abs(val_b - val_a) < 1e-12: return t_arr[i+1]
                    frac = (target - val_a) / (val_b - val_a)
                    return t_arr[i] + frac * (t_arr[i+1] - t_arr[i])
        else: # backward
            # t_50부터 시작점(0)까지 역순 검색
            for i in range(len(t_arr) - 2, -1, -1):
                val_a, val_b = y_arr[i], y_arr[i+1]
                if (val_a <= target <= val_b) or (val_a >= target >= val_b):
                    if abs(val_b - val_a) < 1e-12: return t_arr[i+1]
                    frac = (target - val_a) / (val_b - val_a)
                    return t_arr[i] + frac * (t_arr[i+1] - t_arr[i])
        return None

    try:
        # t_delay: t_50 이전 데이터(idx_50 포함)에서 Backward Search
        t_sub_del = t_r[:idx_50+2] # +2 to include idx_50 and idx_50+1 for interpolation context
        y_sub_del = y_r[:idx_50+2]
        t_del = interpolate_crossing(t_sub_del, y_sub_del, low_val, direction='backward')
        
        # t_saturation: t_50 이후 데이터(idx_50 포함)에서 Forward Search
        t_sub_sat = t_r[idx_50:]
        y_sub_sat = y_r[idx_50:]
        t_sat = interpolate_crossing(t_sub_sat, y_sub_sat, high_val, direction='forward')

        if t_del is None or t_sat is None:
            return {'t_delay': None, 't_rise': None, 't_saturation': None, 'error': '임계값 도달 실패'}

        if t_sat < t_del:
             t_del, t_sat = t_sat, t_del
             
        t_rise = t_sat - t_del
        return {'t_delay': t_del, 't_rise': t_rise, 't_saturation': t_sat}

    except Exception:
        return {'t_delay': None, 't_rise': None, 't_saturation': None, 'error': '분석 중 오류'}


def multi_exponential_shifted(x, *args):
    """y = y0 + Σ A_i * exp(-x/tau_i), where x = t - fit_start (x>=0)"""
    n = (len(args) - 1) // 2
    y0 = args[-1]
    res = y0
    for i in range(n):
        res += args[2 * i] * np.exp(-x / args[2 * i + 1])
    return res


def fit_decay(
    time_shifted: np.ndarray,
    el_signal: np.ndarray,
    n_params: int = 2,
    decay_fit_start_us: float = 4.0,
    initial_params: Optional[List[float]] = None,
) -> Tuple[Optional[np.ndarray], Optional[float], Optional[np.ndarray]]:
    """
    Decay Fitting
    - 대상: time_shifted >= decay_fit_start_us
    - x = time_shifted - decay_fit_start_us 로 원점을 이동한 뒤
      y = y0 + Σ A_i * exp(-x/tau_i) 를 직접 피팅
    """
    fit_start = max(float(decay_fit_start_us), 0.0)
    mask = time_shifted >= fit_start
    t_fit = time_shifted[mask]
    y_fit = el_signal[mask]
    x_fit = t_fit - fit_start
    
    if len(t_fit) < n_params * 2 + 2:
        return None, None, None

    # Initial Guesses
    max_y = np.max(y_fit) if len(y_fit) > 0 else 1.0
    min_y = np.min(y_fit) if len(y_fit) > 0 else 0.0
    
    p0_default = []
    for i in range(n_params):
        p0_default.extend([max_y / n_params, 1.0 * (i + 1)]) # A_i, tau_i
    p0_default.append(min_y) # y0

    # Bounds: Tau > 0, Amplitude > 0
    lower = [0.0, 1e-10] * n_params + [-np.inf]
    upper = [np.inf, np.inf] * n_params + [np.inf]

    p0 = p0_default
    if initial_params is not None and len(initial_params) == len(p0_default):
        try:
            p0_arr = np.array(initial_params, dtype=float)
            if np.all(np.isfinite(p0_arr)):
                # Respect bounds for stable warm-start.
                for i in range(n_params):
                    amp_idx = 2 * i
                    tau_idx = 2 * i + 1
                    p0_arr[amp_idx] = max(p0_arr[amp_idx], 0.0)
                    p0_arr[tau_idx] = max(p0_arr[tau_idx], 1e-10)
                p0 = p0_arr.tolist()
        except Exception:
            p0 = p0_default

    try:
        popt, _ = curve_fit(multi_exponential_shifted, x_fit, y_fit, p0=p0, maxfev=10000, bounds=(lower, upper))
        
        # Sort by tau (ascending)
        n_exps = (len(popt) - 1) // 2
        y0 = popt[-1]
        
        # Extract pairs (A, tau)
        pairs = []
        for i in range(n_exps):
            pairs.append((popt[2 * i], popt[2 * i + 1])) # (A_i, tau_i)
            
        # Sort pairs by tau
        pairs.sort(key=lambda x: x[1])
        
        # Reconstruct popt
        sorted_popt = []
        for a, t_val in pairs:
            sorted_popt.extend([a, t_val])
        sorted_popt.append(y0)
        popt = np.array(sorted_popt)
        
        # Calculate Weighted Avg Tau
        # Intensity Avg Tau = Σ(A_i * tau_i^2) / Σ(A_i * tau_i) is commonly used in lifetime analysis
        amplitudes = popt[0:-1:2]
        taus = popt[1:-1:2]
        
        numerator = np.sum(amplitudes * (taus ** 2))
        denominator = np.sum(amplitudes * taus)
        tau_avg = numerator / (denominator + 1e-20)
        
        y_pred = multi_exponential_shifted(x_fit, *popt)
        return popt, tau_avg, y_pred
    except Exception:
        # Warm-start failed: retry once with generic initialization.
        if p0 is not p0_default:
            try:
                popt, _ = curve_fit(
                    multi_exponential_shifted, x_fit, y_fit, p0=p0_default, maxfev=10000, bounds=(lower, upper)
                )
                
                # Sort by tau (ascending)
                n_exps = (len(popt) - 1) // 2
                y0 = popt[-1]
                pairs = []
                for i in range(n_exps):
                    pairs.append((popt[2 * i], popt[2 * i + 1]))
                pairs.sort(key=lambda x: x[1])
                sorted_popt = []
                for a, t_val in pairs:
                    sorted_popt.extend([a, t_val])
                sorted_popt.append(y0)
                popt = np.array(sorted_popt)
                
                amplitudes = popt[0:-1:2]
                taus = popt[1:-1:2]
                numerator = np.sum(amplitudes * (taus ** 2))
                denominator = np.sum(amplitudes * taus)
                tau_avg = numerator / (denominator + 1e-20)
                y_pred = multi_exponential_shifted(x_fit, *popt)
                return popt, tau_avg, y_pred
            except Exception:
                return None, None, None
        return None, None, None


def calculate_relative_capacitance(
    time_shifted: np.ndarray,
    current_density: np.ndarray,
    integration_limit_us: float = 5.0,
    baseline_start_us: float = 20.0,
) -> Optional[float]:
    """
    Relative Capacitance: Q = ∫ J dt
    - 적분 구간: t_shifted = 0 ~ integration_limit_us
    - Baseline Correction: t > baseline_start_us 구간의 평균 전류를 0으로 맞춤
    """
    if len(time_shifted) < 5:
        return None
        
    # Baseline Calculation (Steady state after discharge)
    base_mask = time_shifted > baseline_start_us
    baseline = np.mean(current_density[base_mask]) if np.any(base_mask) else 0.0
    
    # Integration
    mask_int = (time_shifted >= 0) & (time_shifted <= integration_limit_us)
    if not np.any(mask_int):
        return None
        
    t_int = time_shifted[mask_int]
    j_int = current_density[mask_int]
    j_corrected = j_int - baseline
    
    # Trapezoidal integration
    # Unit: mA/cm² * μs = nC/cm²
    q_total = np.trapz(j_corrected, t_int)
    
    # Taking absolute value for charge amount
    return float(np.abs(q_total))


def parse_after_duty_from_filename(filename: str) -> Optional[str]:
    """파일명에서 duty 뒤에 오는 부분 그대로 추출 (예: duty25%_1h0min -> 25%_1h0min)"""
    m = re.search(r'duty\s*(.+)', filename, re.IGNORECASE)
    if not m:
        return None
    s = m.group(1).strip()
    if s.endswith('.csv'):
        s = s[:-4]
    if s.endswith('_TrEL'):
        s = s[:-5]
    return s if s else None


def analyze_single_file(
    content: str,
    filename: str,
    low_pct: float,
    high_pct: float,
    n_decay: int,
    vil_time_voltage: Optional[List[Tuple[float, float]]] = None,
    decay_fit_start_us: float = 4.0,
    decay_initial_params: Optional[List[float]] = None,
    integration_limit_us: float = 5.0,
    baseline_start_us: float = 20.0,
) -> Dict:
    """
    단일 파일 분석 메인 함수
    """
    time_raw, time_shifted, el_signal, current_density = parse_trel_csv(content)
    
    if len(time_raw) < 10:
        return {'filename': filename, 'error': '데이터 부족', 'time_min': parse_minutes_from_filename(filename)}

    # 1. Rise Analysis (Using time_raw)
    rise_res = analyze_rise(time_raw, time_shifted, el_signal, low_pct, high_pct)
    
    # 2. Decay Analysis (Using time_shifted)
    popt, tau_avg, _ = fit_decay(
        time_shifted,
        el_signal,
        n_decay,
        decay_fit_start_us,
        initial_params=decay_initial_params,
    )
    
    # 3. Capacitance (Using time_shifted)
    rel_cap = calculate_relative_capacitance(time_shifted, current_density, integration_limit_us, baseline_start_us)

    # Result Assembly
    time_min = parse_minutes_from_filename(filename)
    after_duty = parse_after_duty_from_filename(filename)

    result = {
        'filename': filename,
        'time_min': time_min,
        'after_duty': after_duty,
        't_delay': rise_res.get('t_delay'),
        't_rise': rise_res.get('t_rise'),
        't_saturation': rise_res.get('t_saturation'),
        'rise_error': rise_res.get('error')
    }
    
    if vil_time_voltage and time_min is not None:
        v = interpolate_voltage_at_time(time_min, vil_time_voltage)
        if v is not None: result['voltage'] = v
            
    if rel_cap is not None:
        result['relative_capacitance'] = rel_cap
        
    if popt is not None:
        # popt format: [A1, tau1, A2, tau2, ..., y0]
        n_exps = (len(popt) - 1) // 2
        amplitudes = np.array([popt[2 * i] for i in range(n_exps)], dtype=float)
        amp_sum = float(np.sum(amplitudes))
        for i in range(n_exps):
            result[f'tau_{i + 1}'] = popt[2 * i + 1]
            if amp_sum > 0:
                result[f'f_{i + 1}'] = float(amplitudes[i] / amp_sum)
            else:
                result[f'f_{i + 1}'] = None
        result['tau_avg'] = tau_avg
        result['popt'] = popt.tolist()

    return result


def get_preview_data(
    content: str,
    low_pct: float,
    high_pct: float,
    n_decay: int,
    decay_fit_start_us: float = 4.0,
) -> Dict:
    """
    미리보기용 데이터 생성
    """
    time_raw, time_shifted, el_signal, _ = parse_trel_csv(content)
    if len(time_raw) < 10:
        return {'error': '데이터 부족'}

    rise_res = analyze_rise(time_raw, time_shifted, el_signal, low_pct, high_pct)
    fit_start = max(float(decay_fit_start_us), 0.0)
    popt, tau_avg, y_fit = fit_decay(time_shifted, el_signal, n_decay, fit_start)

    # Preview Data Construction
    # 1. Rise Preview: time_raw 0 ~ 100us (Log Scale on Frontend)
    # rise_res already returns t_delay/saturation in time_raw scale.
    
    mask_rise = (time_raw > 0) & (time_raw <= 100.0)
    t_rise_preview = time_raw[mask_rise]
    y_rise_preview = el_signal[mask_rise]
    
    # Downsample
    if len(t_rise_preview) > 1500:
        step = len(t_rise_preview) // 1500
        t_rise_preview = t_rise_preview[::step]
        y_rise_preview = y_rise_preview[::step]

    # Convert to list and replace NaN/Inf with None
    def safe_list(arr):
        return [float(x) if np.isfinite(x) else None for x in arr]

    rise_data = {
        'time_raw': safe_list(t_rise_preview),
        'el_signal_rise': safe_list(y_rise_preview),
        't_delay': float(rise_res.get('t_delay')) if rise_res.get('t_delay') is not None else None,
        't_saturation': float(rise_res.get('t_saturation')) if rise_res.get('t_saturation') is not None else None,
        't_rise': float(rise_res.get('t_rise')) if rise_res.get('t_rise') is not None else None,
    }

    # 2. Decay Preview: time_shifted 0 ~ 50us (Log Y Scale on Frontend)
    # Only send points > 0 for log scale
    mask_decay = (time_shifted >= fit_start) & (time_shifted <= 50.0)
    t_decay_preview = time_shifted[mask_decay]
    y_decay_preview = el_signal[mask_decay]
    
    # Avoid log(0) or negative (just in case)
    y_decay_log = []
    if len(y_decay_preview) > 0:
         # Use np.maximum to avoid log(<=0)
         y_decay_log = np.log10(np.maximum(y_decay_preview, 1e-10))
    
    # Downsample
    if len(t_decay_preview) > 1500:
        step = len(t_decay_preview) // 1500
        t_decay_preview = t_decay_preview[::step]
        if len(y_decay_log) > 0:
            y_decay_log = y_decay_log[::step]
        
    decay_data = {
        'time_decay': safe_list(t_decay_preview), # Actually time_shifted
        'el_signal_decay_log': safe_list(y_decay_log),
    }

    if popt is not None and y_fit is not None:
        # Re-calculate fit points for the preview range
        fit_mask = (time_shifted >= fit_start) & (time_shifted <= 50.0)
        t_fit_preview = time_shifted[fit_mask]
        x_fit_preview = t_fit_preview - fit_start
        y_fit_preview = multi_exponential_shifted(x_fit_preview, *popt)
        y_fit_log = np.log10(np.maximum(y_fit_preview, 1e-10))
        
        # Downsample fit as well
        if len(t_fit_preview) > 1500:
            step = len(t_fit_preview) // 1500
            t_fit_preview = t_fit_preview[::step]
            y_fit_log = y_fit_log[::step]
            
        decay_data['t_decay_fit'] = safe_list(t_fit_preview)
        decay_data['y_fit_log'] = safe_list(y_fit_log)
        
    return {
        'rise': rise_data,
        'decay': decay_data,
        'tau_avg': float(tau_avg) if tau_avg is not None else None,
        'tau_list': [float(popt[2 * i + 1]) for i in range((len(popt) - 1) // 2)] if popt is not None else [],
    }
