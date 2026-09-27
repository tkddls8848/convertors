import { describe, expect, it } from 'vitest';

import { reason, STALE_DEPLOY } from './errors';

describe('오류를 화면에 보일 말로', () => {
  it('낡은 화면이 사라진 조각을 부를 때는 무엇을 해야 하는지 적는다', () => {
    // 브라우저마다 말이 다르다. 셋 다 "새 판이 배포되어 조각 이름이 바뀌었다" 는
    // 같은 일이고, 영어 원문을 그대로 보이면 도구가 깨진 것처럼 보인다.
    const chrome = new TypeError('Failed to fetch dynamically imported module: https://x/assets/fontkit.es-C8DOfELi.js');
    const firefox = new TypeError('error loading dynamically imported module');
    const safari = new TypeError('Importing a module script failed.');
    const vite = new Error('Unable to preload CSS for /assets/index-abc.css');

    for (const error of [chrome, firefox, safari, vite]) expect(reason(error)).toBe(STALE_DEPLOY);
    expect(STALE_DEPLOY).toMatch(/새로고침/);
  });

  it('그 밖의 오류는 그대로 옮긴다', () => {
    // 우리가 쓴 한글 메시지를 덮어쓰면 무엇이 잘못됐는지 알 수 없게 된다.
    expect(reason(new Error('암호화된 PDF입니다.'))).toBe('암호화된 PDF입니다.');
    expect(reason('글꼴 파일이 너무 짧습니다.')).toBe('글꼴 파일이 너무 짧습니다.');
  });
});
