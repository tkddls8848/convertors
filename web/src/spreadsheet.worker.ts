import { convertSpreadsheet } from './spreadsheet-formats';
self.onmessage = async (event: MessageEvent<{ bytes: Uint8Array; name: string; format: string }>) => {
  try {
    const result = await convertSpreadsheet(event.data.bytes, event.data.name, event.data.format);
    self.postMessage({ result }, { transfer: result.files.map(f => f.bytes.buffer as ArrayBuffer) });
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
