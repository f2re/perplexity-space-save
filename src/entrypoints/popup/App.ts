import { h, render } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { html } from 'htm/preact'
import { serialize, parse } from '../../utils/serialization'
import type { MsgType, PerplexitySpace, Result, SpaceInput } from '../../utils/types'

interface SpaceListItem {
  space: SpaceInput
  exists: boolean
  selected: boolean
  status: 'idle' | 'pending' | 'done' | 'error'
  error?: string
}

function App() {
  const [status, setStatus] = useState<{ type: 'info' | 'success' | 'error', msg: string } | null>(null)
  const [progress, setProgress] = useState<{ done: number, total: number } | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [isPopup, setIsPopup] = useState<boolean>(window.innerWidth < 600)
  const [spacesFromFile, setSpacesFromFile] = useState<SpaceListItem[]>([])
  const [existingSpacesList, setExistingSpacesList] = useState<PerplexitySpace[]>([])
  const [isManaging, setIsManaging] = useState<boolean>(false)

  const openFullPage = () => {
    browser.tabs.create({ url: browser.runtime.getURL('/popup.html') })
  }

  const fetchExisting = async () => {
    setLoading(true)
    try {
      const response = await browser.runtime.sendMessage({ type: 'GET_EXISTING_SPACES' }) as Result<PerplexitySpace[]>
      if (response.ok) {
        setExistingSpacesList(response.value)
      } else {
        showStatus('error', `❌ Failed to fetch: ${response.error.message}`)
      }
    } catch (err) {
      showStatus('error', '❌ Failed to connect to Perplexity.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Check if an import is already running in background
    browser.storage.local.get(['importQueue', 'importEnabled', 'importDone', 'importTotal']).then((data) => {
      if (data.importEnabled && data.importQueue && data.importQueue.length > 0) {
        setProgress({ done: data.importDone || 0, total: data.importTotal || 0 });
        setLoading(true);
      }
    });

    fetchExisting()
    const listener = (message: unknown) => {
      const msg = message as { type: MsgType; payload: any }
      if (msg.type === 'IMPORT_PROGRESS') {
        setProgress(msg.payload)
        setLoading(true)
        if (msg.payload.done >= msg.payload.total) {
          setLoading(false);
          // Wait a bit before clearing progress
          setTimeout(() => setProgress(null), 3000);
        }
      }
    }
    browser.runtime.onMessage.addListener(listener)
    return () => browser.runtime.onMessage.removeListener(listener)
  }, [])

  const showStatus = (type: 'info' | 'success' | 'error', msg: string) => {
    setStatus({ type, msg })
    if (type === 'success') {
      setTimeout(() => setStatus(null), 5000)
    }
  }

  const handleExport = async () => {
    setLoading(true)
    setStatus(null)
    showStatus('info', '📡 Fetching your spaces from Perplexity...')
    
    try {
      const response = await browser.runtime.sendMessage({ type: 'EXPORT_SPACES' }) as Result<PerplexitySpace[]>
      if (!response.ok) {
        showStatus('error', `❌ ${response.error.message}`)
        return
      }

      const spaces = response.value
      if (spaces.length === 0) {
        showStatus('error', '⚠️ No spaces found to export.')
        return
      }

      const jsonData = serialize(spaces)
      const date = new Date().toISOString().split('T')[0]
      const filename = `perplexity-spaces-${date}.json`
      
      const blob = new Blob([jsonData], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 100)

      showStatus('success', `✅ Successfully exported ${spaces.length} spaces!`)
    } catch (err) {
      showStatus('error', '❌ Export failed. Please refresh Perplexity.')
    } finally {
      setLoading(false)
    }
  }

  const handleFileSelect = async (e: Event) => {
    const target = e.target as HTMLInputElement
    const file = target.files?.[0]
    if (!file) return

    setLoading(true)
    setStatus(null)
    showStatus('info', '📂 Parsing backup file...')

    try {
      const text = await file.text()
      const parsedSpaces = parse(text)
      
      if (parsedSpaces.length === 0) {
        // Error already logged by parser
        return
      }

      showStatus('info', '🔍 Checking for existing spaces on Perplexity...')
      const existingResponse = await browser.runtime.sendMessage({ type: 'GET_EXISTING_SPACES' }) as Result<PerplexitySpace[]>
      const existingTitles = new Set<string>()
      if (existingResponse.ok) {
        existingResponse.value.forEach(s => existingTitles.add(s.title))
      }

      const listItems: SpaceListItem[] = parsedSpaces.map(space => {
        const exists = existingTitles.has(space.title)
        return {
          space,
          exists,
          selected: !exists,
          status: 'idle'
        }
      })

      setSpacesFromFile(listItems)
      showStatus('success', `✨ Loaded ${listItems.length} spaces. Choose what to restore below.`)
    } catch (err) {
      showStatus('error', '❌ Failed to load file. Is it a valid JSON backup?')
    } finally {
      setLoading(false)
      target.value = ''
    }
  }

  const handleCreateSingle = async (index: number) => {
    const item = spacesFromFile[index]
    if (!item) return

    const newList = [...spacesFromFile]
    newList[index] = { ...item, status: 'pending' }
    setSpacesFromFile(newList)

    try {
      const res = await browser.runtime.sendMessage({ 
        type: 'CREATE_SINGLE_SPACE', 
        payload: item.space 
      }) as Result<void>

      if (res.ok) {
        newList[index] = { ...item, status: 'done', exists: true, selected: false }
      } else {
        newList[index] = { ...item, status: 'error', error: res.error.message }
      }
    } catch (err) {
      newList[index] = { ...item, status: 'error', error: 'Failed' }
    }
    setSpacesFromFile([...newList])
  }

  const handleDelete = async (uuid: string, title: string) => {
    if (!confirm(`Are you sure you want to delete "${title}"? This cannot be undone.`)) return
    
    setLoading(true)
    showStatus('info', `🗑️ Deleting "${title}"...`)
    
    try {
      const response = await browser.runtime.sendMessage({ 
        type: 'DELETE_SPACE', 
        payload: { uuid } 
      }) as Result<void>

      if (response.ok) {
        showStatus('success', `✅ Deleted "${title}"`)
        await fetchExisting()
      } else {
        showStatus('error', `❌ ${response.error.message}`)
      }
    } catch (err) {
      showStatus('error', '❌ Deletion failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleImportSelected = async () => {
    const selected = spacesFromFile.filter(i => i.selected && i.status !== 'done').map(i => i.space)
    if (selected.length === 0) return

    setLoading(true)
    showStatus('info', '⏳ Import started! One space will be created every 60s to avoid limits.')
    
    try {
      await browser.runtime.sendMessage({ 
        type: 'IMPORT_SPACES', 
        payload: selected 
      })
      // We don't set loading to false here because the process is running in background
    } catch (err) {
      showStatus('error', '❌ Failed to start background import.')
      setLoading(false)
    }
  }

  const handleStop = async () => {
    try {
      await browser.runtime.sendMessage({ type: 'STOP_IMPORT' })
      setLoading(false)
      setProgress(null)
      showStatus('info', '🛑 Import stopped by user.')
    } catch (err) {
      showStatus('error', '❌ Failed to stop import.')
    }
  }

  const toggleAll = (select: boolean) => {
    setSpacesFromFile(spacesFromFile.map(i => ({
      ...i,
      selected: i.status === 'done' ? false : select
    })))
  }

  // Helper to convert hex to emoji
  const getEmoji = (hex: string | null) => {
    if (!hex) return '💬'
    if (hex.length > 2 && /^[0-9a-fA-F]+$/.test(hex)) {
      try {
        return String.fromCodePoint(parseInt(hex, 16))
      } catch { return '💬' }
    }
    return hex
  }

  return html`
    <div class="app-container">
      <header class="header">
        <h1><span>🛡️</span> Perplexity Backup</h1>
        <p>Save and restore your AI Spaces with ease</p>
      </header>

      <main class="card">
        <div class="section-title">📦 Backup your Data</div>
        <p class="instruction-text">Download all your spaces, instructions, and settings into a single JSON file.</p>
        <button onClick=${handleExport} disabled=${loading}>
          ${loading ? 'Working...' : 'Export to .json'}
        </button>
      </main>

      <main class="card">
        <div class="section-title">🔄 Restore Spaces</div>
        <p class="instruction-text">Import your spaces back. We'll automatically skip duplicates!</p>
        
        ${isPopup ? html`
          <button class="secondary" onClick=${openFullPage}>
            🚀 Open Full Page Importer
          </button>
          <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 8px; text-align: center;">
            Recommended for large imports to prevent timeout.
          </p>
        ` : html`
          <label class="button-label ${loading ? 'disabled' : ''}">
            <div class="secondary" style="display:flex; align-items:center; justify-content:center; gap:8px; padding:12px; border:1px solid var(--border); border-radius:8px; cursor:pointer; font-weight:600;">
              📂 Select .json Backup
            </div>
            <input type="file" accept=".json" onchange=${handleFileSelect} disabled=${loading} />
          </label>
        `}

        ${spacesFromFile.length > 0 && html`
          <div class="space-list-container">
            <div class="list-header">
              <span style="font-weight:600; font-size:0.85rem">Found ${spacesFromFile.length} Spaces</span>
              <div style="display:flex; gap:10px">
                <a href="#" style="font-size:0.75rem; color:var(--primary)" onClick=${(e: Event) => { e.preventDefault(); toggleAll(true); }}>Select All</a>
                <a href="#" style="font-size:0.75rem; color:var(--text-muted)" onClick=${(e: Event) => { e.preventDefault(); toggleAll(false); }}>None</a>
              </div>
            </div>

            <div class="space-list">
              ${spacesFromFile.map((item, index) => html`
                <div class="space-item ${item.exists ? 'is-exists' : ''}">
                  <input 
                    type="checkbox" 
                    class="custom-checkbox"
                    checked=${item.selected} 
                    disabled=${item.status === 'done'}
                    onChange=${() => {
                      const newList = [...spacesFromFile];
                      newList[index]!.selected = !newList[index]!.selected;
                      setSpacesFromFile(newList);
                    }} 
                  />
                  <div class="space-info">
                    <div class="space-title-row">
                      <span style="font-size:1.1rem">${getEmoji(item.space.emoji)}</span>
                      <span class="space-title">${item.space.title}</span>
                    </div>
                    <div class="space-meta">
                      ${item.exists ? 
                        html`<span class="badge badge-exists">Already Exists</span>` : 
                        html`<span class="badge badge-new">New</span>`
                      }
                      ${item.status === 'done' && html`<span class="badge badge-done" style="margin-left:4px">✓ Restored</span>`}
                      ${item.status === 'error' && html`<span class="badge badge-error" style="margin-left:4px">Failed</span>`}
                    </div>
                  </div>
                  <button 
                    class="secondary create-btn-small" 
                    disabled=${item.status === 'pending' || item.status === 'done'}
                    onClick=${() => handleCreateSingle(index)}
                  >
                    ${item.status === 'pending' ? '...' : 'Create'}
                  </button>
                </div>
              `)}
            </div>
            
            <div style="margin-top: 16px;">
              <button onClick=${handleImportSelected} disabled=${loading || !spacesFromFile.some(i => i.selected && i.status !== 'done')}>
                🚀 Restore Selected (1/min)
              </button>
              <p style="font-size: 0.75rem; color: var(--text-muted); margin-top: 8px; text-align: center;">
                Safest mode: page reloads after every space.
              </p>
            </div>
          </div>
        `}
      </main>

      <main class="card">
        <div class="section-title">
          <span>🛠️</span> Manage Existing Spaces
          <button 
            class="secondary create-btn-small" 
            style="margin-left: auto;" 
            onClick=${fetchExisting}
            disabled=${loading}
          >
            🔄 Refresh
          </button>
        </div>
        <p class="instruction-text">View and delete spaces currently in your Perplexity account.</p>
        
        <div class="space-list">
          ${existingSpacesList.length === 0 ? html`
            <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.85rem;">
              No spaces found. Click Refresh to check.
            </div>
          ` : existingSpacesList.map((space) => html`
            <div class="space-item">
              <div class="space-info">
                <div class="space-title-row">
                  <span style="font-size:1.1rem">${getEmoji(space.emoji)}</span>
                  <span class="space-title">${space.title}</span>
                </div>
                <div class="space-meta">
                  UUID: ${space.uuid.substring(0, 8)}...
                </div>
              </div>
              <button 
                class="secondary create-btn-small" 
                style="color: var(--accent-red); border-color: #fee2e2;"
                onClick=${() => handleDelete(space.uuid, space.title)}
                disabled=${loading}
              >
                🗑️ Delete
              </button>
            </div>
          `)}
        </div>
      </main>

      ${progress && html`
        <div class="card" style="padding: 15px;">
          <div style="display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:8px">
            <span style="font-weight:600">Restoration Progress</span>
            <span>${progress.done} / ${progress.total}</span>
          </div>
          <div class="progress-container">
            <div class="progress-fill" style=${{ width: `${(progress.done / progress.total) * 100}%` }}></div>
          </div>
          <button class="secondary create-btn-small" style="margin-top: 12px; color: var(--accent-red); width: 100%;" onClick=${handleStop}>
            🛑 Stop Restoration
          </button>
        </div>
      `}

      ${status && html`
        <div class="status-msg status-${status.type}">
          ${status.type === 'success' ? '✅' : status.type === 'error' ? '⚠️' : 'ℹ️'}
          <span>${status.msg}</span>
        </div>
      `}

      <footer style="text-align: center; font-size: 0.75rem; color: var(--text-muted); margin-top: -10px;">
        Make sure you have <b>perplexity.ai</b> open in another tab.
      </footer>
    </div>
  `
}

render(h(App, {}), document.getElementById('app')!)
