/**
 * 표 합치기·나누기 일꾼. SheetJS 는 여기에만 든다 — 화면 묶음을 무겁게 하지 않고,
 * 오래 걸려도 화면이 멈추지 않으며, 60초가 넘거나 취소하면 일꾼째 끝낼 수 있다.
 */
import { inspectSheets, mergeSheets, splitSheet, type MergeOptions, type Source, type SplitOptions, type ToolResult } from './sheet-tools';

export type SheetToolRequest =
  | { type: 'inspect'; sources: Source[] }
  | { type: 'merge'; sources: Source[]; options: MergeOptions }
  | { type: 'split'; source: Source; options: SplitOptions };

self.onmessage = async (event: MessageEvent<SheetToolRequest>) => {
  try {
    const request = event.data;
    if (request.type === 'inspect') {
      self.postMessage({ result: await inspectSheets(request.sources) });
      return;
    }
    const result: ToolResult = request.type === 'merge'
      ? await mergeSheets(request.sources, request.options)
      : await splitSheet(request.source, request.options);
    self.postMessage({ result }, { transfer: result.files.map(file => file.bytes.buffer as ArrayBuffer) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
