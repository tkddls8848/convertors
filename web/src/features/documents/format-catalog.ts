/** Shared UI/engine capabilities. No conversion libraries are loaded here. */
export const DOCUMENT_INPUTS = ['docx', 'docm', 'dotx', 'odt', 'ott', 'fodt', 'txt', 'md', 'markdown', 'html', 'htm', 'epub', 'fb2', 'pptx', 'ppsx', 'potx', 'odp', 'hwpx', 'pdf'];
export const DOCUMENT_OUTPUTS = ['docx', 'odt', 'fodt', 'txt', 'md', 'html', 'rtf', 'epub', 'fb2', 'hwpx'];
export const SHEET_INPUTS = ['xlsx', 'xls', 'xlsb', 'xlsm', 'xltx', 'xltm', 'ods', 'fods', 'csv', 'tsv', 'dif', 'sylk', 'slk', 'xml', 'dbf', 'wk1', 'wk3', 'wks', 'numbers', 'json'];
export const SHEET_OUTPUTS = ['xlsx', 'xls', 'xlsb', 'ods', 'fods', 'csv', 'tsv', 'json', 'html', 'md', 'dif', 'sylk'];
export const CONTENT_NOTE = '본문의 글·기본 표를 옮깁니다. 그림·도형·수식·각주·머리말·글꼴·쪽 배치·병합 셀·매크로는 보존하지 않습니다. 목록·제목은 일반 문단이 될 수 있습니다.';
export const MAX_INPUT = 16 * 1024 * 1024;
export interface ConversionFile { name: string; bytes: Uint8Array; mime: string }
export const escapeXml = (s: string): string => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
