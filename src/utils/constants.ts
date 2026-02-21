export const SPACES_ENDPOINTS = {
  list: [
    'https://www.perplexity.ai/rest/collections/list_user_collections?limit=100&offset=0&version=2.18&source=default',
  ],
  create: [
    'https://www.perplexity.ai/rest/collections/create_collection?version=2.18&source=default',
    'https://www.perplexity.ai/rest/collections/create',
    'https://www.perplexity.ai/rest/spaces/create',
  ],
} as const;

export const DEFAULT_FETCH_OPTIONS: RequestInit = {
  credentials: 'include',   // sends session cookies — CRITICAL
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
};

export const IMPORT_DELAY_MS = 500;
export const MAX_RETRIES = 3;
export const RETRY_FALLBACK_MS = 5000;
