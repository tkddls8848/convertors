import { describe, expect, it } from 'vitest';

import { hwpxToMarkdown } from './hwpx';
import { makeZip } from './zip-fixture';

const section = (body: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><hp:sec xmlns:hp="urn:hancom">${body}</hp:sec>`;

const paragraph = (text: string): string => `<hp:p><hp:run><hp:t>${text}</hp:t></hp:run></hp:p>`;

describe('hwpxToMarkdown', () => {
  it('규격서의 ID·글머리표·병합 칸을 잃지 않는다', async () => {
    // gong-go 의 converter/hwpx-table.test.js 에서 옮겨 온 회귀 시험이다. 실제
    // 제안요청서에서 ID 가 잘리고 병합 칸이 한 칸씩 밀리던 두 가지를 잡는다.
    const ids = Array.from(
      { length: 42 },
      (_, index) => `ECR-${['COM', 'HW', 'NW', 'SW'][index % 4]}-${String(index + 1).padStart(2, '0')}`,
    );
    const bullets = Array.from({ length: 179 }, () => '◦ 보존').join('');
    const table =
      '<hp:tbl>' +
      `<hp:tr><hp:tc colSpan="2">${paragraph('세부내용')}</hp:tc></hp:tr>` +
      `<hp:tr><hp:tc>${paragraph('CPU')}</hp:tc><hp:tc>${paragraph('16 core')}</hp:tc></hp:tr>` +
      '</hp:tbl>';
    const zip = await makeZip([
      { name: 'Contents/section0.xml', content: section(paragraph(ids.join(' ') + bullets) + table), deflate: true },
    ]);

    const { markdown, stats } = await hwpxToMarkdown(zip);

    expect(ids.filter((id) => markdown.includes(id))).toHaveLength(42);
    expect(stats.bullets).toBe(179);
    // colSpan="2" 는 두 칸을 같은 값으로 덮는다. 빈칸으로 두면 아래 행과 어긋난다.
    expect(markdown).toMatch(/\| 세부내용 \| 세부내용 \|/);
    expect(markdown).toMatch(/\| CPU \| 16 core \|/);
    expect(stats).toMatchObject({ sections: 1, tables: 1, rows: 2, cells: 3 });
  });

  it('rowSpan 은 아래 행까지 같은 값으로 덮는다', async () => {
    const table =
      '<hp:tbl>' +
      `<hp:tr><hp:tc rowSpan="2">${paragraph('구분')}</hp:tc><hp:tc>${paragraph('1행')}</hp:tc></hp:tr>` +
      `<hp:tr><hp:tc>${paragraph('2행')}</hp:tc></hp:tr>` +
      '</hp:tbl>';
    const zip = await makeZip([{ name: 'Contents/section0.xml', content: section(table) }]);

    const { markdown } = await hwpxToMarkdown(zip);

    expect(markdown).toMatch(/\| 구분 \| 1행 \|/);
    expect(markdown).toMatch(/\| 구분 \| 2행 \|/);
  });

  it('구역은 번호 순서로 잇는다 — section10 은 section2 뒤다', async () => {
    const zip = await makeZip([
      { name: 'Contents/section10.xml', content: section(paragraph('열째')) },
      { name: 'Contents/section2.xml', content: section(paragraph('둘째')) },
    ]);

    const { markdown, stats } = await hwpxToMarkdown(zip);

    expect(stats.sections).toBe(2);
    expect(markdown.indexOf('둘째')).toBeLessThan(markdown.indexOf('열째'));
  });

  it('표 안의 표는 바깥 문단으로 새지 않는다', async () => {
    const inner = `<hp:tbl><hp:tr><hp:tc>${paragraph('안쪽')}</hp:tc></hp:tr></hp:tbl>`;
    const outer = `<hp:tbl><hp:tr><hp:tc>${paragraph('바깥')}${inner}</hp:tc></hp:tr></hp:tbl>`;
    const zip = await makeZip([{ name: 'Contents/section0.xml', content: section(outer) }]);

    const { markdown } = await hwpxToMarkdown(zip);

    // 바깥 칸의 글에 안쪽 표의 글이 섞이면 규격 항목이 뒤엉킨다.
    expect(markdown).toMatch(/\| 바깥 \|/);
    expect(markdown).not.toMatch(/바깥 안쪽/);
  });

  it('HWPX 가 아니면 무엇이 없는지 말한다', async () => {
    const zip = await makeZip([{ name: 'word/document.xml', content: '<w:document/>' }]);
    await expect(hwpxToMarkdown(zip)).rejects.toThrow(/Contents\/sectionN\.xml/);
  });
});
