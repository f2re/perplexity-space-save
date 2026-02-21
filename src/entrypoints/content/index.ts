import { defineContentScript } from 'wxt/sandbox'
import { getSpaces, createSpace, deleteSpace } from '../../utils/api'
import type { MsgType, SpaceInput, BatchResult } from '../../utils/types'

export default defineContentScript({
  matches: ['*://www.perplexity.ai/*'],
  main() {
    console.log('Perplexity Spaces Backup Content Script Loaded');

    // Endpoint Discovery via Fetch Sniffing
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const url = String(args[0] instanceof Request ? args[0].url : args[0]);
      
      // Match spaces or collections endpoints
      if (/\/rest\/(user\/)?spaces|\/rest\/collections|\/list_user_collections/.test(url)) {
        try {
          // Use background script to store discovered endpoint
          await browser.runtime.sendMessage({ 
            type: 'ENDPOINT_DISCOVERED', 
            payload: url 
          });
        } catch (err) {
          console.error('Failed to report discovered endpoint:', err);
        }
      }
      return originalFetch(...args);
    };

    // Listen for direct messages from the popup or background script
    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as { type: MsgType; payload?: any };
      
      const handleMessage = async () => {
        switch (msg.type) {
          case 'EXPORT_SPACES':
            console.log('Content Script received EXPORT_SPACES');
            return await getSpaces();

          case 'GET_EXISTING_SPACES':
            console.log('Content Script received GET_EXISTING_SPACES');
            return await getSpaces();

          case 'CREATE_SINGLE_SPACE':
            console.log('Content Script creating single space:', msg.payload.title);
            return await createSpace(msg.payload);

          case 'DELETE_SPACE':
            console.log('Content Script deleting space:', msg.payload.uuid);
            return await deleteSpace(msg.payload.uuid);

          case 'PROCESS_BATCH': {
            console.log('Content Script received PROCESS_BATCH', msg.payload);
            const spacesToImport: SpaceInput[] = msg.payload;
            
            try {
              // Fetch existing spaces to check for duplicates
              const existingResult = await getSpaces();
              const existingTitles = new Set<string>();
              
              if (existingResult.ok) {
                existingResult.value.forEach(s => existingTitles.add(s.title));
              } else {
                console.warn('Could not fetch existing spaces, skipping duplicate check.');
              }

              let processedCount = 0;
              for (const space of spacesToImport) {
                if (existingTitles.has(space.title)) {
                  console.log(`Skipping existing space: ${space.title}`);
                  processedCount++;
                  continue;
                }

                console.log(`Creating space: ${space.title}`);
                const result = await createSpace(space);
                
                if (!result.ok) {
                  console.error(`Failed to create space ${space.title}:`, result.error);
                  // If rate limit error, stop and report failure to trigger retry/reload
                  if (result.error.message.includes('429') || result.error.message.includes('Rate limit')) {
                     return { ok: false, error: 'Rate limit hit', processedCount };
                  }
                }
                
                processedCount++;
                // Wait between creations to be gentle
                await new Promise(resolve => setTimeout(resolve, 2000));
              }

              return { ok: true, processedCount };
            } catch (err) {
              console.error('Batch processing error:', err);
              return { ok: false, error: String(err), processedCount: 0 };
            }
          }

          default:
            return undefined;
        }
      };

      return handleMessage();
    });
  },
});
