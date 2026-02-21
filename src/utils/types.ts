// Message Types
export type MsgType =
  | 'EXPORT_SPACES'       // Popup → Background
  | 'IMPORT_SPACES'       // Popup → Background (payload: SpaceInput[])
  | 'EXPORT_RESULT'       // Background → Popup (payload: Space[] | Error)
  | 'IMPORT_PROGRESS'     // Background → Popup (payload: { done: number, total: number })
  | 'ENDPOINT_DISCOVERED' // Content → Background (payload: string)
  | 'DOWNLOAD_FILE'       // Popup → Background (payload: { content: string, filename: string })
  | 'RESUME_IMPORT'       // Background → Content (payload: SpaceInput[])
  | 'PROCESS_BATCH'       // Background → Content (payload: SpaceInput[])
  | 'GET_EXISTING_SPACES' // Popup → Background
  | 'CREATE_SINGLE_SPACE' // Popup → Background (payload: SpaceInput)
  | 'DELETE_SPACE'        // Popup → Background (payload: { uuid: string })
  | 'STOP_IMPORT'         // Popup → Background

export interface BatchResult {
  ok: boolean
  processedCount: number
  error?: string
}

// Perplexity Space Object
export interface PerplexitySpace {
  uuid: string
  title: string
  emoji: string | null           // may be null if not set
  instructions: string           // system prompt
  description: string | null
  is_default: boolean
  created_at: string             // ISO 8601
  updated_at: string
}

export type SpaceInput = Omit<PerplexitySpace, 'uuid' | 'created_at' | 'updated_at' | 'is_default'>

export interface AppError {
  message: string
  code?: string
}

export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E }
