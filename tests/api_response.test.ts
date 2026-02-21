import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getSpaces } from '../src/utils/api'

// Mock the global fetch
global.fetch = vi.fn()

describe('API Response Handling', () => {
  beforeEach(() => {
    vi.mocked(global.fetch).mockClear()
  })

  it('should handle root array response', async () => {
    const mockSpaces = [
      {
        uuid: "021c0ea3-6f0f-41e2-82ef-3f73addec7f3",
        title: "покупки",
        description: "",
        instructions: "System prompt...",
        emoji: "1f3bd",
        access: 1,
        user_permission: 1,
        created_at: "2026-02-20T18:20:41.500031",
        updated_at: "2026-02-20T18:20:41.500031",
        is_default: false
      }
    ];

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => mockSpaces,
    })

    const result = await getSpaces()
    
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toHaveLength(1)
      expect(result.value[0].title).toBe('покупки')
    }
  })

  it('should handle response wrapped in { spaces: [...] }', async () => {
     const mockSpaces = [{ uuid: '1', title: 'Test Space' }];
     (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ spaces: mockSpaces }),
    })
    
    const result = await getSpaces()
    expect(result.ok).toBe(true)
    if (result.ok) {
       expect(result.value).toHaveLength(1)
    }
  })

  it('should handle response wrapped in { collections: [...] }', async () => {
     const mockSpaces = [{ uuid: '1', title: 'Collection Space' }];
     (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({ collections: mockSpaces }),
    })
    
    const result = await getSpaces()
    expect(result.ok).toBe(true)
    if (result.ok) {
       expect(result.value).toHaveLength(1)
       expect(result.value[0].title).toBe('Collection Space')
    }
  })
})
