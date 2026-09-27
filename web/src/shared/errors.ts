/**
 * 오류를 화면에 보일 말로 바꾼다.
 *
 * 특별히 알아보는 것이 하나 있다. 이 탭의 무거운 부분(PDF.js·fontkit·HWPX 쓰기)은
 * 누른 사람만 받도록 **그때 가서** 불러온다. 그 사이에 새 판이 배포되면 열려 있던
 * 화면이 가리키던 조각은 이름이 바뀌어 사라지고, 단추를 누르는 순간
 * "Failed to fetch dynamically imported module" 이 뜬다.
 *
 * 고장이 아니라 화면이 낡은 것이다. 영어 원문을 그대로 보이면 도구가 깨진 것처럼
 * 보이므로, 무엇을 해야 하는지로 바꿔 적는다.
 */

/** 브라우저마다 말이 다르다. 셋 다 같은 일이다. */
const STALE = /dynamically imported module|Importing a module script failed|Unable to preload/i;

export const STALE_DEPLOY = '새 판이 배포되어 이 화면이 낡았습니다. 새로고침한 뒤 다시 해 주세요.';

export function reason(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return STALE.test(text) ? STALE_DEPLOY : text;
}
