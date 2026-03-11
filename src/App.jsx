import React, { useState, useEffect, useMemo, useRef } from 'react'
import './App.css'
import AnalysisTab from './AnalysisTab'

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN || `${window.location.protocol}//${window.location.hostname}:8080`
const apiUrl = (path) => `${API_ORIGIN}${path}`

function PreviewChart({ timeNs, ch1, baselineStart, baselineEnd, normStart, normEnd }) {
  const w = 600
  const h = 200
  const pad = { top: 10, right: 10, bottom: 30, left: 50 }
  const plotW = w - pad.left - pad.right
  const plotH = h - pad.top - pad.bottom

  const { path, xScale, yScale, xMin, xMax } = useMemo(() => {
    if (!timeNs?.length || !ch1?.length) return {}
    
    // 유효한 데이터만 필터링 (null, NaN, Infinity 제외)
    const validPoints = []
    for (let i = 0; i < timeNs.length; i++) {
      const t = timeNs[i]
      const v = ch1[i]
      if (t != null && v != null && Number.isFinite(t) && Number.isFinite(v)) {
        validPoints.push({ t, v })
      }
    }
    
    if (validPoints.length === 0) return {}

    const xMin = Math.min(...validPoints.map(p => p.t))
    const xMax = Math.max(...validPoints.map(p => p.t))
    const yMin = Math.min(...validPoints.map(p => p.v))
    const yMax = Math.max(...validPoints.map(p => p.v))
    
    const yRange = yMax - yMin || 1
    const xScale = v => pad.left + ((v - xMin) / (xMax - xMin || 1)) * plotW
    const yScale = v => pad.top + plotH - ((v - yMin) / yRange) * plotH
    
    // 필터링된 포인트로 경로 생성
    const pts = validPoints.map(p => `${xScale(p.t)},${yScale(p.v)}`).join(' L ')
    const path = pts ? `M ${pts}` : ''
    return { path, xScale, yScale, xMin, xMax }
  }, [timeNs, ch1])

  if (!path) return <div style={{ height: h, background: '#f5f5f5', borderRadius: 4 }} />

  const blX1 = xScale ? xScale(Math.max(xMin, baselineStart)) : 0
  const blX2 = xScale ? xScale(Math.min(xMax, baselineEnd)) : 0
  const normX1 = normStart != null && normEnd != null && xScale ? xScale(Math.max(xMin, normStart)) : 0
  const normX2 = normStart != null && normEnd != null && xScale ? xScale(Math.min(xMax, normEnd)) : 0

  return (
    <svg width={w} height={h} style={{ display: 'block', background: '#fff', borderRadius: 4, border: '1px solid #ddd' }}>
      {baselineStart <= baselineEnd && (
        <rect x={blX1} y={pad.top} width={Math.max(0, blX2 - blX1)} height={plotH} fill="rgba(33,150,243,0.15)" stroke="rgba(33,150,243,0.5)" strokeWidth={1} />
      )}
      {normStart != null && normEnd != null && normStart <= normEnd && (
        <rect x={normX1} y={pad.top} width={Math.max(0, normX2 - normX1)} height={plotH} fill="rgba(76,175,80,0.15)" stroke="rgba(76,175,80,0.5)" strokeWidth={1} />
      )}
      <path d={path} fill="none" stroke="#333" strokeWidth={1.5} strokeLinejoin="round" />
      <text x={pad.left} y={h - 8} fontSize={10} fill="#666">Time (ns)</text>
      <text x={w - 120} y={pad.top + 14} fontSize={9} fill="rgba(33,150,243,0.9)">■ 베이스라인</text>
      <text x={w - 120} y={pad.top + 26} fontSize={9} fill="rgba(76,175,80,0.9)">■ 정규화(1.0)</text>
    </svg>
  )
}

function App() {
  const [logoError, setLogoError] = useState(false)
  const [backendStatus, setBackendStatus] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState(null)
  const [results, setResults] = useState({ vil: [], osc: [], master: false, masterMetadata: null })
  const [folderReady, setFolderReady] = useState(false)
  const [folderData, setFolderData] = useState(null) // { dirHandle, vilFiles, oscFiles, existingTrel, previewData }
  const [baselineStart, setBaselineStart] = useState(-500)
  const [baselineEnd, setBaselineEnd] = useState(-100)
  const [normStart, setNormStart] = useState('')
  const [normEnd, setNormEnd] = useState('')
  const [masterPercents, setMasterPercents] = useState('100, 90, 80, 70, 60, 50')
  const [trelConfigOpen, setTrelConfigOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('batch')  // 'batch' | 'analysis'
  const batchAbortRef = useRef(null)

  const getReadableError = (err) => {
    if (!err) return '알 수 없는 오류'
    if (err.name === 'AbortError') return '요청이 중단되었습니다.'
    if (err.message === 'Failed to fetch') {
      return '요청 중 연결이 끊겼습니다. 백엔드는 실행 중일 수 있으니 터미널 로그(포트/예외)를 확인해주세요.'
    }
    return err.message || String(err)
  }

  useEffect(() => {
    fetch(apiUrl('/api/health'))
      .then(res => res.json())
      .then(data => setBackendStatus(data))
      .catch(() => setBackendStatus({ status: 'error' }))
  }, [])

  const collectFiles = async (dir, prefix, filter) => {
    const list = []
    for await (const [name, handle] of dir.entries()) {
      const relPath = prefix ? `${prefix}/${name}` : name
      if (handle.kind === 'file' && filter(name)) {
        list.push({ name, relPath, file: await handle.getFile() })
      } else if (handle.kind === 'directory') {
        list.push(...await collectFiles(handle, relPath, filter))
      }
    }
    return list
  }
  const dedup = (list) => {
    const s = new Set()
    return list.filter(({ relPath }) => (s.has(relPath) ? false : (s.add(relPath), true)))
  }
  const getDirForPath = async (dh, relPath) => {
    const parts = relPath.split('/')
    if (parts.length <= 1) return dh
    let d = dh
    for (let i = 0; i < parts.length - 1; i++) {
      d = await d.getDirectoryHandle(parts[i], { create: true })
    }
    return d
  }

  const base64ToUint8Array = (b64) => {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  const handleFolderSelect = async () => {
    if (!('showDirectoryPicker' in window)) {
      setError('이 브라우저는 폴더 선택을 지원하지 않습니다. Chrome 또는 Edge를 사용해주세요.')
      return
    }
    setError(null)
    setResults({ vil: [], osc: [], master: false, masterMetadata: null })
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
      let vilFiles = dedup(await collectFiles(dirHandle, '', n =>
        !n.startsWith('._') && n.toUpperCase().includes('VIL') && n.endsWith('.csv')
      ))
      let oscFiles = dedup(await collectFiles(dirHandle, '', n =>
        !n.startsWith('._') && n.endsWith('.csv') && !n.toUpperCase().includes('VIL') && n.includes('Hz')
      ))
      const existingTrel = await collectFiles(dirHandle, '', n => n.endsWith('_TrEL.csv') && !n.startsWith('._'))
      if (vilFiles.length === 0 && oscFiles.length === 0 && existingTrel.length === 0) {
        setError('처리할 CSV 파일이 없습니다. (VIL, 오실로스코프 Hz, 또는 _TrEL.csv)')
        setFolderReady(false)
        return
      }
      let previewData = null
      if (oscFiles.length > 0) {
        const fd = new FormData()
        fd.append('file', oscFiles[0].file)
        const res = await fetch(apiUrl('/api/preview-osc'), { method: 'POST', body: fd })
        const data = await res.json()
        if (data.success) previewData = data
      }
      setFolderData({ dirHandle, vilFiles, oscFiles, existingTrel, previewData })
      setFolderReady(true)
      if (oscFiles.length > 0) setTrelConfigOpen(true)
    } catch (err) {
      if (err.name === 'AbortError') return
      setError(getReadableError(err))
      setFolderReady(false)
    }
  }

  const handleProcess = async () => {
    if (!folderData) return
    setError(null)
    setProcessing(true)
    const controller = new AbortController()
    batchAbortRef.current = controller
    const { dirHandle, vilFiles, oscFiles, existingTrel } = folderData
    const signal = controller.signal
    try {
      let vilResults = []
      if (vilFiles.length > 0) {
        const fd = new FormData()
        vilFiles.forEach(({ file, relPath }) => { fd.append('files', file); fd.append('paths', relPath) })
        const res = await fetch(apiUrl('/api/process-vil'), { method: 'POST', body: fd, signal })
        const data = await res.json()
        if (!data.success) throw new Error(data.error || 'VIL 처리 실패')
        vilResults = data.results || []
        const vilOutDir = await dirHandle.getDirectoryHandle('TrEL_processed', { create: true })
        for (const r of vilResults) {
          if (r.success && (r.xlsx_b64 || r.csv)) {
            const pathParts = (r.relPath || r.filename).split('/').slice(0, -1)
            let targetDir = vilOutDir
            for (const p of pathParts) {
              targetDir = await targetDir.getDirectoryHandle(p, { create: true })
            }
            const outName = r.output_filename || r.filename.replace('.csv', '_processed.xlsx')
            const fh = await targetDir.getFileHandle(outName, { create: true })
            const w = await fh.createWritable()
            if (r.xlsx_b64) {
              await w.write(base64ToUint8Array(r.xlsx_b64))
            } else {
              await w.write(r.csv)
            }
            await w.close()
          }
        }
      }

      let oscResults = []
      if (oscFiles.length > 0) {
        const fd = new FormData()
        oscFiles.forEach(({ file, relPath }) => { fd.append('files', file); fd.append('paths', relPath) })
        fd.append('baseline_start_ns', baselineStart)
        fd.append('baseline_end_ns', baselineEnd)
        if (normStart.trim()) fd.append('norm_start_ns', normStart.trim())
        if (normEnd.trim()) fd.append('norm_end_ns', normEnd.trim())
        const res = await fetch(apiUrl('/api/process-osc'), { method: 'POST', body: fd, signal })
        const data = await res.json().catch(() => ({}))
        if (!data.success) throw new Error(data.error || 'TrEL 처리 실패')
        oscResults = data.results || []
        const outDir = await dirHandle.getDirectoryHandle('TrEL_processed', { create: true })
        for (const r of oscResults) {
          if (r.success && r.csv) {
            const pathParts = (r.relPath || r.filename).split('/').slice(0, -1)
            let targetDir = outDir
            for (const p of pathParts) {
              targetDir = await targetDir.getDirectoryHandle(p, { create: true })
            }
            const fh = await targetDir.getFileHandle(r.output_filename, { create: true })
            const w = await fh.createWritable()
            await w.write(r.csv)
            await w.close()
          }
        }
      }

      let trelFiles = oscResults.filter(r => r.success && r.csv)
        .map(r => new File([r.csv], r.output_filename))
      if (trelFiles.length === 0) {
        const existing = await collectFiles(dirHandle, '', n => n.endsWith('_TrEL.csv') && !n.startsWith('._'))
        trelFiles = existing.map(({ file }) => file)
      }
      let masterOk = false
      let masterMetadata = null
      const vilForMaster = vilResults.find(r => r.success && r.csv)
      if (trelFiles.length > 0 && vilForMaster) {
        // 마스터 파일 생성 전 백엔드 연결 확인 및 재시도
        let retryCount = 0
        const maxRetries = 3
        let lastError = null
        
        while (retryCount < maxRetries) {
          try {
            // 백엔드 연결 상태 확인
            const healthCheck = await fetch(apiUrl('/api/health'), { signal, cache: 'no-cache' })
            if (!healthCheck.ok) {
              throw new Error(`백엔드 헬스체크 실패 (HTTP ${healthCheck.status})`)
            }
            
            const fd = new FormData()
            fd.append('vil_csv', vilForMaster.csv)
            fd.append('vil_time_shift_min', String(vilForMaster.time_shift_min ?? 0))
            fd.append('master_percents', masterPercents.replace(/\s/g, ''))
            trelFiles.forEach(f => fd.append('files', f))
            
            const res = await fetch(apiUrl('/api/create-master'), { 
              method: 'POST', 
              body: fd, 
              signal
            })
            
            if (!res.ok) {
              // 413 에러 처리
              if (res.status === 413) {
                const data = await res.json().catch(() => ({}))
                throw new Error(data.error || '요청 크기가 너무 큽니다. 전송하려는 파일이 너무 많거나 크기 때문일 수 있습니다.')
              }
              const data = await res.json().catch(() => ({}))
              throw new Error(data.error || `HTTP ${res.status}: 백엔드 응답 오류`)
            }
            
            const ct = res.headers.get('content-type') || ''
            if (ct.includes('json')) {
              const data = await res.json()
              throw new Error(data.error || '마스터 생성 실패')
            }
            
            const metaHeader = res.headers.get('X-Master-Metadata')
            if (metaHeader) {
              try { masterMetadata = JSON.parse(metaHeader) } catch (_) {}
            }
            const blob = await res.blob()
            const masterDir = await dirHandle.getDirectoryHandle('TrEL_processed', { create: true })
            const fh = await masterDir.getFileHandle('TrEL_Master.xlsx', { create: true })
            const w = await fh.createWritable()
            await w.write(blob)
            await w.close()
            masterOk = true
            break // 성공하면 루프 종료
          } catch (err) {
            lastError = err
            if (err.name === 'AbortError') {
              throw err // 사용자가 중단한 경우 즉시 종료
            }
            retryCount++
            if (retryCount < maxRetries) {
              // 재시도 전 대기 (지수 백오프)
              await new Promise(resolve => setTimeout(resolve, 1000 * retryCount))
              continue
            } else {
              // 모든 재시도 실패
              throw new Error(`마스터 파일 생성 실패 (${maxRetries}회 시도): ${getReadableError(err)}`)
            }
          }
        }
      }
      setResults({ vil: vilResults, osc: oscResults, master: masterOk, masterMetadata })
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('사용자가 중단했습니다.')
        return
      }
      setError(getReadableError(err))
    } finally {
      setProcessing(false)
      batchAbortRef.current = null
    }
  }

  return (
    <div className="app">
      <div className="container">
        <div className="title-section">
          <div className="title-content">
            <h1>TrEL Signal Processing & Analysis Automator</h1>
            <p className="subtitle">Batch Processing & Data Export</p>
          </div>
          <img
            src="/PNEL_logo.png"
            alt="PNEL Logo"
            className="title-logo"
            onError={() => setLogoError(true)}
            style={{ display: logoError ? 'none' : 'block' }}
          />
        </div>

        <div className="tabs" style={{ display: 'flex', gap: '4px', marginTop: '24px', borderBottom: '1px solid #ddd' }}>
          <button
            type="button"
            onClick={() => setActiveTab('batch')}
            style={{
              padding: '10px 20px',
              border: 'none',
              background: activeTab === 'batch' ? '#fff' : 'transparent',
              borderBottom: activeTab === 'batch' ? '2px solid #333' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.95em',
              fontWeight: activeTab === 'batch' ? 600 : 400,
              color: activeTab === 'batch' ? '#333' : '#666',
            }}
          >
            배치 처리
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('analysis')}
            style={{
              padding: '10px 20px',
              border: 'none',
              background: activeTab === 'analysis' ? '#fff' : 'transparent',
              borderBottom: activeTab === 'analysis' ? '2px solid #333' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: '0.95em',
              fontWeight: activeTab === 'analysis' ? 600 : 400,
              color: activeTab === 'analysis' ? '#333' : '#666',
            }}
          >
            TrEL 배치 분석
          </button>
        </div>

        {activeTab === 'batch' && (
        <div style={{ marginTop: '30px' }}>
          <h2>전체 처리</h2>
          <p style={{ color: '#666', marginBottom: '20px' }}>
            폴더를 선택하면 <strong>VIL 처리</strong> → <strong>TrEL 오실로스코프 처리</strong> → <strong>마스터 파일 생성</strong>이 순서대로 자동 실행됩니다.
          </p>

          {backendStatus?.status !== 'ok' && (
            <p style={{ color: '#d32f2f', marginBottom: '16px' }}>
              백엔드 연결 필요. pnpm dev:all로 실행해주세요.
            </p>
          )}

          <button
            className="simulate-button"
            onClick={handleFolderSelect}
            disabled={processing || backendStatus?.status !== 'ok'}
          >
            폴더 선택
          </button>

          {folderReady && folderData && (
            <div style={{ marginTop: '20px', padding: '16px', background: '#fafafa', borderRadius: '6px', border: '1px solid #e0e0e0' }}>
              <h3 style={{ marginBottom: '12px', fontSize: '1.1em' }}>TrEL 처리 설정</h3>
              {folderData.vilFiles?.length > 0 && (
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '4px' }}>마스터 파일 퍼센트 (%)</label>
                  <input
                    type="text"
                    value={masterPercents}
                    onChange={e => setMasterPercents(e.target.value)}
                    placeholder="100, 90, 80, 70, 60, 50"
                    style={{ width: '200px', padding: '6px 8px' }}
                  />
                  <span style={{ fontSize: '0.8em', color: '#666', marginLeft: '8px' }}>쉼표로 구분 (예: 100, 90, 80, 70, 60, 50)</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => setTrelConfigOpen(!trelConfigOpen)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.95em', color: '#333', marginBottom: '12px' }}
              >
                {trelConfigOpen ? '▼' : '▶'} 베이스라인 / 정규화 구간 설정
              </button>
              {trelConfigOpen && (
                <div style={{ marginTop: '8px' }}>
                  {folderData.previewData && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontSize: '0.85em', color: '#666', marginBottom: '8px' }}>
                        미리보기: {folderData.previewData.filename} (CH1 Luminance)
                      </div>
                      <PreviewChart
                        timeNs={folderData.previewData.time_ns}
                        ch1={folderData.previewData.ch1}
                        baselineStart={baselineStart}
                        baselineEnd={baselineEnd}
                        normStart={normStart ? parseFloat(normStart) : null}
                        normEnd={normEnd ? parseFloat(normEnd) : null}
                      />
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginBottom: '16px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '4px' }}>베이스라인 구간 (ns)</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="number"
                          value={baselineStart}
                          onChange={e => setBaselineStart(Number(e.target.value))}
                          style={{ width: '90px', padding: '6px 8px' }}
                        />
                        <span>~</span>
                        <input
                          type="number"
                          value={baselineEnd}
                          onChange={e => setBaselineEnd(Number(e.target.value))}
                          style={{ width: '90px', padding: '6px 8px' }}
                        />
                      </div>
                      <span style={{ fontSize: '0.8em', color: '#666' }}>오프셋 0 기준 구간</span>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.9em', marginBottom: '4px' }}>정규화(1.0) 기준 구간 (ns)</label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                          type="number"
                          placeholder="비워두면 전체 max"
                          value={normStart}
                          onChange={e => setNormStart(e.target.value)}
                          style={{ width: '90px', padding: '6px 8px' }}
                        />
                        <span>~</span>
                        <input
                          type="number"
                          placeholder="비워두면 전체 max"
                          value={normEnd}
                          onChange={e => setNormEnd(e.target.value)}
                          style={{ width: '90px', padding: '6px 8px' }}
                        />
                      </div>
                      <span style={{ fontSize: '0.8em', color: '#666' }}>해당 구간 max를 1로 정규화</span>
                    </div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button
                  className="simulate-button"
                  onClick={handleProcess}
                  disabled={processing || backendStatus?.status !== 'ok'}
                >
                  {processing ? '처리 중...' : '처리 시작'}
                </button>
                {processing && (
                  <button
                    type="button"
                    onClick={() => batchAbortRef.current?.abort()}
                    style={{
                      padding: '10px 20px',
                      background: '#d32f2f',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    중단
                  </button>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="error-message" style={{ marginTop: '16px' }}>{error}</div>
          )}

          {(results.vil?.length > 0 || results.osc?.length > 0 || results.master) && (
            <div className="results-section" style={{ marginTop: '24px' }}>
              <h3>처리 결과</h3>
              <p style={{ color: '#666', marginBottom: '16px', fontSize: '0.95em' }}>
                {results.vil?.length > 0 && <>✓ VIL {results.vil.filter(r => r.success).length}개 저장</>}
                {results.osc?.length > 0 && <span style={{ marginLeft: '8px' }}>✓ TrEL {results.osc.filter(r => r.success).length}개 → TrEL_processed</span>}
                {results.master && <span style={{ marginLeft: '8px' }}>✓ TrEL_processed/TrEL_Master.xlsx</span>}
              </p>
              {results.master && results.masterMetadata?.files_used?.length > 0 && (
                <div style={{ marginBottom: '12px', padding: '12px', background: '#e3f2fd', borderRadius: '6px' }}>
                  <strong>마스터 파일에 사용된 TrEL 데이터 (VIL 보간 기반 선택):</strong>
                  <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
                    {results.masterMetadata.files_used.map((f, i) => (
                      <li key={i}>
                        <span style={{ fontWeight: 600, color: '#1565c0' }}>{f.percent}</span>
                        {' → '}
                        {f.filename}
                        {f.minutes != null && <span style={{ color: '#666', marginLeft: '4px' }}>({f.minutes})</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {results.vil?.length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <strong>VIL:</strong>
                  {results.vil.map((r, i) => (
                    <div key={i} style={{ padding: '8px', background: r.success ? '#e8f5e9' : '#ffebee', borderRadius: '4px', marginTop: '4px' }}>
                      {r.relPath || r.filename} {r.success ? `(shift: ${r.time_shift_s != null ? r.time_shift_s.toFixed(2) : '?'}s, ${r.filtered_points} pts)` : `- ${r.error}`}
                    </div>
                  ))}
                </div>
              )}
              {results.osc?.length > 0 && (
                <div style={{ marginBottom: '12px' }}>
                  <strong>TrEL 오실로스코프:</strong>
                  {results.osc.map((r, i) => (
                    <div key={i} style={{ padding: '8px', background: r.success ? '#e8f5e9' : '#ffebee', borderRadius: '4px', marginTop: '4px' }}>
                      {r.relPath || r.filename} {r.success ? `(${r.original_points} pts)` : `- ${r.error}`}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        )}

        {activeTab === 'analysis' && <AnalysisTab backendStatus={backendStatus} />}
      </div>
    </div>
  )
}

export default App
