/**
 * 테스트에서 PDFium 을 Node 로 띄운다. 화면은 이것을 쓰지 않는다 — 워커가
 * 배포 경로에서 wasm 을 받아 같은 엔진을 띄운다 (`pdf-redact.worker.ts`).
 *
 * 테스트가 흉내 낸 엔진이 아니라 **배포되는 그 wasm** 으로 지워 보는 것이
 * 요점이다. 지웠다고 믿게 만드는 가짜는 이 기능에서 가장 위험하다.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';

import { redactWith, type RedactArea } from './pdf-redact-core';

let engine: Promise<WrappedPdfiumModule> | null = null;

export function nodeEngine(): Promise<WrappedPdfiumModule> {
  return (engine ??= (async () => {
    const wasm = readFileSync(createRequire(import.meta.url).resolve('@embedpdf/pdfium/pdfium.wasm'));
    const module = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) });
    module.PDFiumExt_Init();
    return module;
  })());
}

/** `applyTextEdits` 에 넘길 지우개. 워커 대신 이 프로세스에서 지운다. */
export async function nodeRedact(source: Uint8Array, areas: RedactArea[]): Promise<Uint8Array> {
  return redactWith(await nodeEngine(), source, areas);
}
