import { SPACES_ENDPOINTS, DEFAULT_FETCH_OPTIONS, IMPORT_DELAY_MS, MAX_RETRIES, RETRY_FALLBACK_MS } from './constants'
import type { PerplexitySpace, SpaceInput, Result } from './types'

export async function getSpaces(): Promise<Result<PerplexitySpace[]>> {
  let discovered: string[] = []
  try {
    const storage = await browser.storage.local.get('discoveredEndpoints')
    if (Array.isArray(storage.discoveredEndpoints)) {
      discovered = storage.discoveredEndpoints
    }
  } catch {
    // Ignore storage errors if running outside extension context
  }

  const candidates = [...new Set([...discovered, ...SPACES_ENDPOINTS.list])]

  for (const url of candidates) {
    try {
      const res = await fetch(url, DEFAULT_FETCH_OPTIONS)
      if (res.ok) {
        const data = await res.json()
        let spaces = data.spaces ?? data.collections ?? data.results
        
        // If the data itself is an array, use it directly (as seen in some endpoints)
        if (!spaces && Array.isArray(data)) {
          spaces = data
        }

        if (Array.isArray(spaces)) {
          return { ok: true, value: spaces }
        }
      }
    } catch (err) {
      console.error(`Failed to fetch from ${url}:`, err)
    }
  }
  return { ok: false, error: { message: 'Spaces API endpoint not found' } }
}

export async function createSpace(space: SpaceInput): Promise<Result<void>> {
  let lastError: Error | null = null
  
  for (const url of SPACES_ENDPOINTS.create) {
    let retries = 0
    while (retries < MAX_RETRIES) {
      try {
        const res = await fetch(url, {
          ...DEFAULT_FETCH_OPTIONS,
          method: 'POST',
          body: JSON.stringify({
            title: space.title,
            emoji: space.emoji || '',
            instructions: space.instructions,
            description: space.description || '',
            access: 1,
          }),
        })

        if (res.ok) {
          return { ok: true, value: undefined }
        }

        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After')
          const delay = retryAfter ? parseInt(retryAfter) * 1000 : RETRY_FALLBACK_MS
          await new Promise(resolve => setTimeout(resolve, delay))
          retries++
          continue
        }

        // If not 429 and not ok, try next endpoint
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        retries++
        await new Promise(resolve => setTimeout(resolve, IMPORT_DELAY_MS))
      }
    }
  }

  return { 
    ok: false, 
    error: { 
      message: lastError?.message || 'Failed to create space' 
    } 
  }
}

export async function deleteSpace(uuid: string): Promise<Result<void>> {
  let lastError: Error | null = null
  
  // Base URL for deletion from constants or derived from user input
  const baseUrl = 'https://www.perplexity.ai/rest/collections/delete_collection'
  const url = `${baseUrl}/${uuid}?version=2.18&source=default`

  try {
    const res = await fetch(url, {
      ...DEFAULT_FETCH_OPTIONS,
      method: 'DELETE',
    })

    if (res.ok) {
      return { ok: true, value: undefined }
    }
    
    const errorData = await res.json().catch(() => ({}))
    lastError = new Error(errorData.message || `Failed to delete (HTTP ${res.status})`)
  } catch (err) {
    lastError = err instanceof Error ? err : new Error(String(err))
  }

  return { 
    ok: false, 
    error: { 
      message: lastError?.message || 'Failed to delete space' 
    } 
  }
}
