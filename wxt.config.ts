import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  browser: 'firefox',
  manifestVersion: 3,
  manifest: {
    manifest_version: 3,
    name: 'Perplexity Spaces Backup',
    description: 'Export and Import Perplexity AI Spaces.',
    version: '1.0.0',
    permissions: [
      'downloads',
      'scripting',
      'storage'
    ],
    host_permissions: [
      '*://www.perplexity.ai/*'
    ],
    browser_specific_settings: {
      gecko: {
        id: 'perplexity-spaces-backup@example.com'
      }
    }
  },
});
