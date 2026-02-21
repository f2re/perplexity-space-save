import { defineBackground } from 'wxt/sandbox'
import type { MsgType, SpaceInput, BatchResult } from '../utils/types'

export default defineBackground(() => {
  console.log('Perplexity Spaces Backup Background Script Started');

  // Clear any leftover queue on startup to prevent "automatic" unintended restores
  browser.storage.local.remove(['importQueue', 'importDone', 'importTotal', 'importEnabled']);

  // Helper to process the next batch
  async function processNextBatch(tabId: number) {
    const { importQueue, importDone, importTotal, importEnabled } = await browser.storage.local.get(['importQueue', 'importDone', 'importTotal', 'importEnabled']);
    
    if (!importEnabled) {
      console.log('Import is disabled/stopped.');
      return;
    }

    if (!importQueue || !Array.isArray(importQueue) || importQueue.length === 0) {
      console.log('Import finished or queue empty');
      await browser.storage.local.remove(['importQueue', 'importDone', 'importTotal', 'importEnabled']);
      return;
    }

    const batchSize = 1; // Now 1 by 1 as requested
    const batch = importQueue.slice(0, batchSize);

    console.log(`Processing next space (${importDone + 1}/${importTotal}): ${batch[0]?.title}...`);

    try {
      // Send batch to content script
      const result = await browser.tabs.sendMessage(tabId, { type: 'PROCESS_BATCH', payload: batch }) as BatchResult;

      if (result && result.ok) {
        // Success: update queue and progress
        const newQueue = importQueue.slice(batchSize);
        const newDone = (importDone || 0) + batchSize;
        
        await browser.storage.local.set({ importQueue: newQueue, importDone: newDone });
        
        // Notify popup of progress
        try {
          await browser.runtime.sendMessage({ 
            type: 'IMPORT_PROGRESS', 
            payload: { done: Math.min(newDone, importTotal), total: importTotal } 
          });
        } catch (e) { /* Popup might be closed */ }

        if (newQueue.length > 0) {
          console.log('Space created. Waiting 60 seconds before next one (rate limit avoidance)...');
          // Reload page to reset rate limits if needed, or just wait
          // User requested 1 per minute. 
          await new Promise(resolve => setTimeout(resolve, 60000));
          await browser.tabs.reload(tabId);
          // The onUpdated listener will trigger the next batch after reload
        } else {
          console.log('All spaces completed!');
          await browser.storage.local.remove(['importQueue', 'importDone', 'importTotal']);
        }
      } else {
        // Error: likely rate limit. Wait and retry.
        console.warn('Action failed (rate limit?), retrying in 60s...', result?.error);
        await new Promise(resolve => setTimeout(resolve, 60000));
        await browser.tabs.reload(tabId);
      }
    } catch (err) {
      console.error('Failed to communicate with content script:', err);
      // Retry in 10s
      setTimeout(() => processNextBatch(tabId), 10000);
    }
  }

  // Listener for page reloads to resume import
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url?.includes('perplexity.ai')) {
      browser.storage.local.get(['importQueue', 'importEnabled']).then(({ importQueue, importEnabled }) => {
        if (importEnabled && importQueue && Array.isArray(importQueue) && importQueue.length > 0) {
          console.log('Page reloaded. Resuming import in 3s...');
          setTimeout(() => processNextBatch(tabId), 3000);
        }
      });
    }
  });

  browser.runtime.onMessage.addListener((message: unknown, _sender: any) => {
    const msg = message as { type: MsgType; payload?: any }
    
    // We return a promise for asynchronous responses in MV3
    const handleMessage = async () => {
      switch (msg.type) {
        case 'ENDPOINT_DISCOVERED': {
          console.log('Background received endpoint discovery:', msg.payload);
          const storage = await browser.storage.local.get('discoveredEndpoints');
          const endpoints = (storage.discoveredEndpoints as string[]) || [];
          if (!endpoints.includes(msg.payload)) {
            endpoints.push(msg.payload);
            await browser.storage.local.set({ discoveredEndpoints: endpoints });
          }
          break;
        }

        case 'EXPORT_SPACES': {
          const tabsExport = await browser.tabs.query({ url: '*://www.perplexity.ai/*' });
          if (tabsExport.length === 0 || tabsExport[0]?.id === undefined) {
            return { ok: false, error: { message: 'No Perplexity AI tab found.' } };
          }
          
          try {
            const result = await browser.tabs.sendMessage(tabsExport[0].id, { type: 'EXPORT_SPACES' });
            return result;
          } catch (err) {
            console.error('Failed to communicate with content script:', err);
            return { ok: false, error: { message: 'Failed to communicate with the page. Please refresh the page.' } };
          }
        }

        case 'GET_EXISTING_SPACES': {
          const tabs = await browser.tabs.query({ url: '*://www.perplexity.ai/*' });
          if (tabs.length === 0 || tabs[0]?.id === undefined) {
            return { ok: false, error: { message: 'No Perplexity AI tab found.' } };
          }
          try {
            return await browser.tabs.sendMessage(tabs[0].id, { type: 'GET_EXISTING_SPACES' });
          } catch (err) {
            return { ok: false, error: { message: 'Communication failed.' } };
          }
        }

        case 'CREATE_SINGLE_SPACE': {
          const tabs = await browser.tabs.query({ url: '*://www.perplexity.ai/*' });
          if (tabs.length === 0 || tabs[0]?.id === undefined) {
            return { ok: false, error: { message: 'No Perplexity AI tab found.' } };
          }
          try {
            return await browser.tabs.sendMessage(tabs[0].id, { type: 'CREATE_SINGLE_SPACE', payload: msg.payload });
          } catch (err) {
            return { ok: false, error: { message: 'Communication failed.' } };
          }
        }

        case 'DELETE_SPACE': {
          const tabs = await browser.tabs.query({ url: '*://www.perplexity.ai/*' });
          if (tabs.length === 0 || tabs[0]?.id === undefined) {
            return { ok: false, error: { message: 'No Perplexity AI tab found.' } };
          }
          try {
            return await browser.tabs.sendMessage(tabs[0].id, { type: 'DELETE_SPACE', payload: msg.payload });
          } catch (err) {
            return { ok: false, error: { message: 'Communication failed.' } };
          }
        }

        case 'IMPORT_SPACES': {
          const tabsImport = await browser.tabs.query({ url: '*://www.perplexity.ai/*' });
          if (tabsImport.length === 0 || tabsImport[0]?.id === undefined) {
            return { ok: false, error: { message: 'No Perplexity AI tab found. Please open perplexity.ai.' } };
          }
          const tabId = tabsImport[0].id;
          
          // Initialize queue
          const queue = msg.payload as SpaceInput[];
          await browser.storage.local.set({ 
            importQueue: queue, 
            importTotal: queue.length, 
            importDone: 0,
            importEnabled: true
          });

          // Start processing
          processNextBatch(tabId);
          return { ok: true, value: { done: 0, total: queue.length } };
        }

        case 'STOP_IMPORT': {
          console.log('Stopping import...');
          await browser.storage.local.set({ importEnabled: false });
          await browser.storage.local.remove(['importQueue', 'importDone', 'importTotal']);
          return { ok: true };
        }

        case 'IMPORT_PROGRESS':
          // Forward progress message to popup if it's listening
          // Note: browser.runtime.sendMessage will reach the popup
          break;

        default:
          console.warn('Unknown message type:', msg.type);
      }
    };

    return handleMessage();
  });
});
