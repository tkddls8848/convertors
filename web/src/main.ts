/**
 * 셸 — 변환기를 세우는 것까지만 한다.
 *
 * 이 저장소에는 도구가 하나뿐이라 탭이 없다. 그래도 셸과 도구는 갈라 둔다 —
 * 화면 뼈대·스타일·논리는 전부 `panel.ts` 아래가 갖고, 여기는 빈 칸을 내주며
 * 부를 뿐이다. 그 경계가 있어야 이 변환기를 탭이 여럿인 셸에 그대로 옮겨
 * 붙일 수 있다 (거기서는 `mountConverters` 를 탭이 처음 열릴 때 부른다).
 *
 * 변환기는 **동적으로** 받아 온다. PDF 라이브러리와 스프레드시트 엔진이
 * 무거워서, 뼈대를 먼저 세우고 그 다음에 받는 편이 첫 화면이 빠르다. 각 도구는
 * 거기서 또 한 번 미뤄 둔다 — 고른 사람만 받는다 (`panel.ts`).
 */

import './styles.css';

const root = document.getElementById('converters-root');
if (!root) throw new Error('요소를 찾지 못했습니다: #converters-root');

const { mountConverters } = await import('./panel');
mountConverters(root);
