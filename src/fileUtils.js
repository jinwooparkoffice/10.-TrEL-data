const yieldToUi = async (counter) => {
  if (counter.count % 200 === 0) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

const SKIP_DIRECTORIES = new Set([
  '.git',
  '.cursor',
  '.github',
  'node_modules',
  'dist',
  '__pycache__',
  '.venv',
  'venv',
])

const shouldSkipDirectory = (name) => name.startsWith('.') || SKIP_DIRECTORIES.has(name)

export const collectFiles = async (dir, prefix, filter, counter = { count: 0 }) => {
  const list = []
  for await (const [name, handle] of dir.entries()) {
    counter.count += 1
    await yieldToUi(counter)

    const relPath = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'directory') {
      if (shouldSkipDirectory(name)) {
        continue
      }
      list.push(...await collectFiles(handle, relPath, filter, counter))
      continue
    }

    if (filter(name)) {
      list.push({ name, relPath, handle })
    }
  }
  return list
}

export const scanBatchFolder = async (dir) => {
  const vilFiles = []
  const oscFiles = []
  const existingTrel = []
  const counter = { count: 0 }

  const walk = async (currentDir, prefix = '') => {
    for await (const [name, handle] of currentDir.entries()) {
      counter.count += 1
      await yieldToUi(counter)

      const relPath = prefix ? `${prefix}/${name}` : name
      if (handle.kind === 'directory') {
        if (shouldSkipDirectory(name)) {
          continue
        }
        await walk(handle, relPath)
        continue
      }

      if (name.startsWith('._') || !name.endsWith('.csv')) {
        continue
      }

      const upperName = name.toUpperCase()
      if (upperName.includes('VIL')) {
        vilFiles.push({ name, relPath, handle })
        continue
      }

      if (name.endsWith('_TrEL.csv')) {
        existingTrel.push({ name, relPath, handle })
      }

      if (name.includes('Hz')) {
        oscFiles.push({ name, relPath, handle })
      }
    }
  }

  await walk(dir)
  return { vilFiles, oscFiles, existingTrel }
}

export const scanAnalysisFolder = async (dir) => {
  const analysisFiles = []
  const analysisVilFiles = []
  const counter = { count: 0 }

  const walk = async (currentDir, prefix = '') => {
    for await (const [name, handle] of currentDir.entries()) {
      counter.count += 1
      await yieldToUi(counter)

      const relPath = prefix ? `${prefix}/${name}` : name
      if (handle.kind === 'directory') {
        if (shouldSkipDirectory(name)) {
          continue
        }
        await walk(handle, relPath)
        continue
      }

      if (name.startsWith('._')) {
        continue
      }

      const upperName = name.toUpperCase()
      const isCsv = name.endsWith('.csv')
      const isXlsx = name.endsWith('.xlsx')

      if (isCsv && (name.includes('_TrEL') || name.includes('TrEL'))) {
        analysisFiles.push({ name, relPath, handle })
        continue
      }

      if ((isCsv || isXlsx) && upperName.includes('VIL') && name.includes('_processed')) {
        analysisVilFiles.push({ name, relPath, handle })
      }
    }
  }

  await walk(dir)
  return { analysisFiles, analysisVilFiles }
}

export const dedupFilesByPath = (list) => {
  const seen = new Set()
  return list.filter(({ relPath }) => {
    if (seen.has(relPath)) {
      return false
    }
    seen.add(relPath)
    return true
  })
}
