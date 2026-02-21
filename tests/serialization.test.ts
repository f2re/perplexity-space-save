import { describe, it, expect } from 'vitest'
import { serialize, parse } from '../src/utils/serialization'
import type { PerplexitySpace } from '../src/utils/types'

describe('JSON Serialization Utilities', () => {
  const mockSpaces: PerplexitySpace[] = [
    {
      uuid: '1',
      title: 'Research Assistant',
      emoji: '🔬',
      instructions: 'You are a researcher.',
      description: 'Scientific search assistant',
      is_default: false,
      created_at: '2026-02-21T08:38:00Z',
      updated_at: '2026-02-21T08:38:00Z'
    },
    {
      uuid: '2',
      title: 'Code Helper',
      emoji: null,
      instructions: 'You are an expert engineer.\nUse ```typescript\ncode blocks\n```.',
      description: '',
      is_default: false,
      created_at: '2026-02-21T08:38:00Z',
      updated_at: '2026-02-21T08:38:00Z'
    }
  ]

  it('should serialize to valid JSON', () => {
    const json = serialize(mockSpaces)
    const data = JSON.parse(json)
    
    expect(data.version).toBe(1)
    expect(data.spaces_count).toBe(2)
    expect(data.spaces).toHaveLength(2)
  })

  it('should round-trip correctly', () => {
    const json = serialize(mockSpaces)
    const parsed = parse(json)
    
    expect(parsed).toHaveLength(2)
    expect(parsed[0].title).toBe('Research Assistant')
    expect(parsed[1].instructions).toContain('```typescript')
  })

  it('should handle null emojis and descriptions', () => {
    const json = serialize(mockSpaces)
    const parsed = parse(json)
    
    expect(parsed[1].emoji).toBeNull()
    expect(parsed[1].description).toBeNull()
  })

  it('should handle special characters in JSON', () => {
    const spaceWithSpecialChars: PerplexitySpace = {
      ...mockSpaces[0],
      title: 'Special "Quotes" & Backslashes \\',
      instructions: '{"json": "inside"}'
    }
    const json = serialize([spaceWithSpecialChars])
    const parsed = parse(json)
    
    expect(parsed[0].title).toBe('Special "Quotes" & Backslashes \\')
    expect(parsed[0].instructions).toBe('{"json": "inside"}')
  })
})
