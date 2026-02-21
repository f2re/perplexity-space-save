import { h, render, Fragment } from 'preact'
import { useState, useEffect } from 'preact/hooks'
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

      const jsonData = serialize(response.value)
      const date = new Date().toISOString().split('T')[0]
      const filename = `perplexity-spaces-${date}.json`
      
      const blob = new Blob([jsonData], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 100)

      showStatus('success', `✅ Successfully exported ${response.value.length} spaces!`)
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
      
      if (parsedSpaces.length === 0) return

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
      showStatus('success', `✨ Loaded ${listItems.length} spaces.`)
    } catch (err) {
      showStatus('error', '❌ Failed to load file.')
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
      const res = await browser.runtime.sendMessage({ type: 'CREATE_SINGLE_SPACE', payload: item.space }) as Result<void>
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

  const handleStop = async () => {
    try {
      await browser.runtime.sendMessage({ type: 'STOP_IMPORT' })
      setLoading(false)
      setProgress(null)
      showStatus('info', '🛑 Import stopped.')
    } catch (err) {
      showStatus('error', '❌ Failed to stop.')
    }
  }

  const handleImportSelected = async () => {
    const selected = spacesFromFile.filter(i => i.selected && i.status !== 'done').map(i => i.space)
    if (selected.length === 0) return

    setLoading(true)
    showStatus('info', '⏳ Import started (1/min)...')
    
    try {
      await browser.runtime.sendMessage({ type: 'IMPORT_SPACES', payload: selected })
    } catch (err) {
      showStatus('error', '❌ Failed to start.')
      setLoading(false)
    }
  }

  const handleDelete = async (uuid: string, title: string) => {
    if (!confirm(`Delete "${title}"?`)) return
    setLoading(true)
    try {
      const response = await browser.runtime.sendMessage({ type: 'DELETE_SPACE', payload: { uuid } }) as Result<void>
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

  const getEmoji = (hex: string | null) => {
    if (!hex) return '💬'
    if (hex.length > 2 && /^[0-9a-fA-F]+$/.test(hex)) {
      try { return String.fromCodePoint(parseInt(hex, 16)) } catch { return '💬' }
    }
    return hex
  }

  // --- RENDERING USING h() TO AVOID innerHTML ---

  return h('div', { class: 'app-container' }, [
    h('header', { class: 'header' }, [
      h('h1', null, [h('span', null, '🛡️'), ' Perplexity Backup']),
      h('p', null, 'Save and restore your AI Spaces with ease')
    ]),

    // Backup Card
    h('main', { class: 'card' }, [
      h('div', { class: 'section-title' }, '📦 Backup your Data'),
      h('p', { class: 'instruction-text' }, 'Download all your spaces into a JSON file.'),
      h('button', { onClick: handleExport, disabled: loading }, loading ? 'Working...' : 'Export to .json')
    ]),

    // Restore Card
    h('main', { class: 'card' }, [
      h('div', { class: 'section-title' }, '🔄 Restore Spaces'),
      h('p', { class: 'instruction-text' }, 'Import your spaces back. Duplicates will be skipped.'),
      
      isPopup 
        ? h(Fragment, null, [
            h('button', { class: 'secondary', onClick: openFullPage }, '🚀 Open Full Page Importer'),
            h('p', { style: 'font-size: 0.75rem; color: #6e6e80; margin-top: 8px; text-align: center;' }, 'Recommended for large imports.')
          ])
        : h('label', { class: `button-label ${loading ? 'disabled' : ''}` }, [
            h('div', { class: 'secondary', style: 'display:flex; align-items:center; justify-content:center; gap:8px; padding:12px; border:1px solid #d9d9e3; border-radius:8px; cursor:pointer; font-weight:600;' }, '📂 Select .json Backup'),
            h('input', { type: 'file', accept: '.json', onchange: handleFileSelect, disabled: loading })
          ]),

      spacesFromFile.length > 0 && h('div', { class: 'space-list-container' }, [
        h('div', { class: 'list-header' }, [
          h('span', { style: 'font-weight:600; font-size:0.85rem' }, `Found ${spacesFromFile.length} Spaces`),
          h('div', { style: 'display:flex; gap:10px' }, [
            h('a', { href: '#', style: 'font-size:0.75rem; color:#10a37f', onClick: (e: any) => { e.preventDefault(); setSpacesFromFile(spacesFromFile.map(i => ({...i, selected: i.status === 'done' ? false : true}))) } }, 'Select All'),
            h('a', { href: '#', style: 'font-size:0.75rem; color:#6e6e80', onClick: (e: any) => { e.preventDefault(); setSpacesFromFile(spacesFromFile.map(i => ({...i, selected: false}))) } }, 'None')
          ])
        ]),
        h('div', { class: 'space-list' }, spacesFromFile.map((item, index) => 
          h('div', { class: `space-item ${item.exists ? 'is-exists' : ''}` }, [
            h('input', { 
              type: 'checkbox', 
              class: 'custom-checkbox', 
              checked: item.selected, 
              disabled: item.status === 'done',
              onInput: () => {
                const newList = [...spacesFromFile];
                newList[index]!.selected = !newList[index]!.selected;
                setSpacesFromFile(newList);
              }
            }),
            h('div', { class: 'space-info' }, [
              h('div', { class: 'space-title-row' }, [
                h('span', { style: 'font-size:1.1rem' }, getEmoji(item.space.emoji)),
                h('span', { class: 'space-title' }, item.space.title)
              ]),
              h('div', { class: 'space-meta' }, [
                item.exists ? h('span', { class: 'badge badge-exists' }, 'Already Exists') : h('span', { class: 'badge badge-new' }, 'New'),
                item.status === 'done' && h('span', { class: 'badge badge-done', style: 'margin-left:4px' }, '✓ Restored'),
                item.status === 'error' && h('span', { class: 'badge badge-error', style: 'margin-left:4px' }, 'Failed')
              ])
            ]),
            h('button', { class: 'secondary create-btn-small', disabled: item.status === 'pending' || item.status === 'done', onClick: () => handleCreateSingle(index) }, 
              item.status === 'pending' ? '...' : 'Create'
            )
          ])
        )),
        h('div', { style: 'margin-top: 16px;' }, [
          h('button', { onClick: handleImportSelected, disabled: loading || !spacesFromFile.some(i => i.selected && i.status !== 'done') }, '🚀 Restore Selected (1/min)'),
          h('p', { style: 'font-size: 0.75rem; color: #6e6e80; margin-top: 8px; text-align: center;' }, 'Safest mode: page reloads after every space.')
        ])
      ])
    ]),

    // Manager Card
    h('main', { class: 'card' }, [
      h('div', { class: 'section-title' }, [
        h('span', null, '🛠️'), 
        ' Manage Existing Spaces',
        h('button', { class: 'secondary create-btn-small', style: 'margin-left: auto;', onClick: fetchExisting, disabled: loading }, '🔄 Refresh')
      ]),
      h('div', { class: 'space-list' }, existingSpacesList.length === 0 
        ? h('div', { style: 'text-align: center; padding: 20px; color: #6e6e80; font-size: 0.85rem;' }, 'No spaces found.')
        : existingSpacesList.map((space) => h('div', { class: 'space-item' }, [
            h('div', { class: 'space-info' }, [
              h('div', { class: 'space-title-row' }, [
                h('span', { style: 'font-size:1.1rem' }, getEmoji(space.emoji)),
                h('span', { class: 'space-title' }, space.title)
              ])
            ]),
            h('button', { class: 'secondary create-btn-small', style: 'color: #ef4444; border-color: #fee2e2;', onClick: () => handleDelete(space.uuid, space.title), disabled: loading }, '🗑️ Delete')
          ]))
      )
    ]),

    // Progress Card
    progress && h('div', { class: 'card', style: 'padding: 15px;' }, [
      h('div', { style: 'display:flex; justify-content:space-between; font-size:0.85rem; margin-bottom:8px' }, [
        h('span', { style: 'font-weight:600' }, 'Restoration Progress'),
        h('span', null, `${progress.done} / ${progress.total}`)
      ]),
      h('div', { class: 'progress-container' }, h('div', { class: 'progress-fill', style: `width: ${(progress.done / progress.total) * 100}%` })),
      h('button', { class: 'secondary create-btn-small', style: 'margin-top: 12px; color: #ef4444; width: 100%;', onClick: handleStop }, '🛑 Stop Restoration')
    ]),

    // Status Message
    status && h('div', { class: `status-msg status-${status.type}` }, [
      h('span', null, status.type === 'success' ? '✅' : status.type === 'error' ? '⚠️' : 'ℹ️'),
      h('span', null, status.msg)
    ]),

    h('footer', { style: 'text-align: center; font-size: 0.75rem; color: #6e6e80; margin-top: -10px;' }, [
      'Make sure you have ', h('b', null, 'perplexity.ai'), ' open in another tab.'
    ])
  ])
}

render(h(App, {}), document.getElementById('app')!)
