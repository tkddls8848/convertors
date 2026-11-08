/**
 * .xlsx 의 칸 값만 바꿔 넣는다 — SheetJS 로 다시 쓰면 양식(글꼴·테두리·병합·인쇄 설정)이
 * 떨어지므로, 압축을 풀어 고친 시트 XML 의 `<v>` 만 글자 그대로 바꾸고 다시 묶는다.
 * 나머지 부분(스타일·공유 문자열·그림·다른 시트)은 내용이 한 바이트도 바뀌지 않는다.
 *
 * 수식 칸은 `<f>` 를 그대로 두고 계산값 `<v>` 만 새로 쓴다. 그리고 통합 문서에
 * `fullCalcOnLoad` 를 켜서 엑셀이 열 때 모든 수식을 다시 계산하게 한다.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

import type { XlsProblem, XlsValue, XlsWrite } from './xls-patch';

const escapeXml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescapeXml = (text: string): string =>
  text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** 시트 이름 → 압축 안의 시트 XML 경로. */
function sheetPaths(files: Record<string, Uint8Array>): Map<string, string> {
  const workbook = strFromU8(files['xl/workbook.xml'] ?? new Uint8Array());
  const rels = strFromU8(files['xl/_rels/workbook.xml.rels'] ?? new Uint8Array());
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
    const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
    if (id && target) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
  }
  const paths = new Map<string, string>();
  for (const m of workbook.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[0])?.[1];
    const id = /\br:id="([^"]+)"/.exec(m[0])?.[1];
    if (name !== undefined && id && targets.has(id)) paths.set(unescapeXml(name), targets.get(id)!);
  }
  return paths;
}

/** 칸 하나를 고친 XML. 고칠 수 없으면 까닭(문자열)을 돌려준다. */
function patchCell(xml: string, address: string, value: XlsValue): string | { reason: string } {
  const pattern = new RegExp(`<c\\b(?=[^>]*\\br="${address}")([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`);
  const match = pattern.exec(xml);
  if (!match) return { reason: '숫자가 든 칸이 아니라 고칠 수 없습니다(빈 칸).' };
  let attributes = match[1]!.replace(/\s*\/$/, '');
  const inner = match[2] ?? '';
  const type = /\bt="([^"]*)"/.exec(attributes)?.[1] ?? 'n';
  const formula = /<f\b/.test(inner);
  if (!formula) {
    const text = type === 's' || type === 'str' || type === 'inlineStr';
    if (text) {
      if (typeof value !== 'string') return { reason: '글자 칸에는 글자만 넣을 수 있습니다.' };
      // 공유 문자열 표는 건드리지 않고 그 칸 안에 글자를 넣는다(inlineStr). 스타일(s)은 그대로다.
      const rebuilt = `<c${attributes.replace(/\s*\bt="[^"]*"/, '')} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
      return xml.slice(0, match.index) + rebuilt + xml.slice(match.index + match[0].length);
    }
    if (type !== 'n' || !/<v>/.test(inner)) return { reason: '빈 칸이라 고칠 수 없습니다.' };
    if (typeof value !== 'number') return { reason: '숫자 칸에는 숫자만 넣을 수 있습니다.' };
    return xml.slice(0, match.index) + match[0].replace(/<v>[^<]*<\/v>/, `<v>${value}</v>`) + xml.slice(match.index + match[0].length);
  }
  let newType: string | null;
  let text: string;
  if (typeof value === 'number') { newType = null; text = String(value); }
  else if (typeof value === 'boolean') { newType = 'b'; text = value ? '1' : '0'; }
  else if (value === null) { newType = 'str'; text = ''; }
  else if (typeof value === 'object') { newType = 'e'; text = value.error; }
  else { newType = 'str'; text = value; }
  attributes = attributes.replace(/\s*\bt="[^"]*"/, '') + (newType ? ` t="${newType}"` : '');
  const fpart = /<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/.exec(inner)![0];
  const rest = inner.replace(fpart, '').replace(/<v>[\s\S]*?<\/v>|<v\/>/, '');
  const rebuilt = `<c${attributes}>${fpart}<v>${escapeXml(text)}</v>${rest}</c>`;
  return xml.slice(0, match.index) + rebuilt + xml.slice(match.index + match[0].length);
}

/** 엑셀이 열 때 모든 수식을 다시 계산하도록 workbook.xml 에 표시한다. 스키마 순서를 지킨다. */
function markFullCalc(workbook: string): string {
  if (/<calcPr\b/.test(workbook)) {
    return workbook.replace(/<calcPr\b([^>]*?)(\/?)>/, (_, attributes: string, slash: string) =>
      `<calcPr${attributes.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"${slash}>`);
  }
  const anchors = ['</definedNames>', '<definedNames/>', '</externalReferences>', '</functionGroups>', '<functionGroups/>', '</sheets>'];
  for (const anchor of anchors) {
    const at = workbook.lastIndexOf(anchor);
    if (at >= 0) return workbook.slice(0, at + anchor.length) + '<calcPr fullCalcOnLoad="1"/>' + workbook.slice(at + anchor.length);
  }
  return workbook;
}

export function patchXlsx(file: Uint8Array, requests: XlsWrite[]): { bytes: Uint8Array; problems: XlsProblem[] } {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(file); } catch { throw new Error('xlsx 파일이 아니거나 깨졌습니다.'); }
  if (!files['xl/workbook.xml']) throw new Error('xlsx 안에서 통합 문서를 찾지 못했습니다.');
  const paths = sheetPaths(files);
  const problems: XlsProblem[] = [];
  const sheets = new Map<string, string>();
  let wrote = false;

  for (const request of requests) {
    const path = paths.get(request.sheet);
    if (!path || !files[path]) { problems.push({ sheet: request.sheet, address: request.address, reason: '그 이름의 시트를 찾지 못했습니다.' }); continue; }
    const xml = sheets.get(path) ?? strFromU8(files[path]!);
    const patched = patchCell(xml, request.address, request.value);
    if (typeof patched !== 'string') { problems.push({ sheet: request.sheet, address: request.address, reason: patched.reason }); continue; }
    sheets.set(path, patched);
    wrote = true;
  }
  if (!wrote) return { bytes: file.slice(), problems };

  const out: Zippable = {};
  for (const [name, data] of Object.entries(files)) {
    if (sheets.has(name)) out[name] = strToU8(sheets.get(name)!);
    else if (name === 'xl/workbook.xml') out[name] = strToU8(markFullCalc(strFromU8(data)));
    else out[name] = data;
  }
  return { bytes: zipSync(out, { level: 6 }), problems };
}
