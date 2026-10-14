/**
 * 글자 지우기 일꾼. PDFium(wasm 4.6MB)은 여기에만 든다 — 글자를 처음 지울 때
 * 받고, 큰 PDF 를 지우는 동안에도 화면이 멈추지 않는다.
 *
 * wasm 은 이 사이트에서 받는다. 패키지가 기본으로 가리키는 CDN 은 쓰지 않는다 —
 * CSP 가 막기도 하지만, 파일을 다루는 엔진이 바깥에서 오면 "이 컴퓨터를 벗어나지
 * 않는다" 는 약속이 남의 서버에 걸린다.
 */
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';

import { redactWith, type RedactArea } from './pdf-redact-core';

export interface RedactRequest { id: number; source: Uint8Array; areas: RedactArea[] }
export interface RedactReply { id: number; bytes?: Uint8Array; error?: string }

let engine: Promise<WrappedPdfiumModule> | null = null;

function load(): Promise<WrappedPdfiumModule> {
  return (engine ??= (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`글자 지우기 엔진을 받지 못했습니다 (${response.status}). 새로고침한 뒤 다시 해 주세요.`);
    const module = await init({ wasmBinary: await response.arrayBuffer() });
    module.PDFiumExt_Init();
    return module;
  })().catch((error: unknown) => {
    // 한 번 실패한 것을 붙들고 있으면 새로고침 전까지 영영 못 지운다. 다음에 다시 받는다.
    engine = null;
    throw error;
  }));
}

self.onmessage = async (event: MessageEvent<RedactRequest>) => {
  const { id, source, areas } = event.data;
  try {
    const bytes = redactWith(await load(), source, areas);
    self.postMessage({ id, bytes } satisfies RedactReply, { transfer: [bytes.buffer as ArrayBuffer] });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) } satisfies RedactReply);
  }
};
