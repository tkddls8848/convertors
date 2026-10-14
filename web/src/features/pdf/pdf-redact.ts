/**
 * 화면에서 글자 지우기 일꾼을 부른다.
 *
 * 일꾼은 한 번 세우면 붙들어 둔다. wasm 을 받고 컴파일하는 데 시간이 들어서,
 * 고칠 때마다 새로 세우면 미리보기가 그때마다 느려진다.
 *
 * 마지막 결과를 하나 기억한다. 미리보기는 고칠 때마다 처음부터 다시 짓는데, 빈
 * 곳에 글자를 넣기만 했다면 지울 자리는 그대로다 — 같은 것을 다시 지울 까닭이 없다.
 */
import type { RedactArea } from './pdf-redact-core';
import type { RedactReply, RedactRequest } from './pdf-redact.worker';

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }>();
let last: { source: Uint8Array; key: string; result: Promise<Uint8Array> } | null = null;

export function redactText(source: Uint8Array, areas: RedactArea[]): Promise<Uint8Array> {
  if (!areas.length) return Promise.resolve(source);
  const key = JSON.stringify(areas);
  if (last && last.source === source && last.key === key) return last.result;
  const result = call(source, areas);
  last = { source, key, result };
  // 실패한 결과를 기억하면 다시 눌러도 같은 실패만 돌려준다.
  result.catch(() => { if (last?.result === result) last = null; });
  return result;
}

function call(source: Uint8Array, areas: RedactArea[]): Promise<Uint8Array> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    // 원본은 화면이 계속 들고 있어야 한다. 넘기지(transfer) 않고 복사해 보낸다.
    spawn().postMessage({ id, source, areas } satisfies RedactRequest);
  });
}

function spawn(): Worker {
  if (worker) return worker;
  const created = new Worker(new URL('./pdf-redact.worker.ts', import.meta.url), { type: 'module' });
  created.onmessage = (event: MessageEvent<RedactReply>) => {
    const job = waiting.get(event.data.id);
    if (!job) return;
    waiting.delete(event.data.id);
    if (event.data.error !== undefined || !event.data.bytes) job.reject(new Error(event.data.error ?? '글자를 지우지 못했습니다.'));
    else job.resolve(event.data.bytes);
  };
  created.onerror = () => {
    // 일꾼이 죽으면 기다리던 것을 모두 놓아 준다. 다음 부름에서 새로 세운다.
    for (const job of waiting.values()) job.reject(new Error('글자 지우기 엔진을 실행하지 못했습니다. 새로고침한 뒤 다시 해 주세요.'));
    waiting.clear();
    created.terminate();
    if (worker === created) worker = null;
  };
  worker = created;
  return created;
}
