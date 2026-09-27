import type { PageViewport, PDFDocumentProxy } from 'pdfjs-dist';
import type { SourceFont } from './pdf-source-font';

/** 화면에 겹칠 글자 조각 하나. PDF 좌표와 화면 좌표를 같이 들고 있는다. */
export interface Span {
  text: string;
  /** 회전을 적용하지 않은 PDF 사용자 공간. 저장할 때 그대로 쓴다. */
  pdf: { x: number; y: number; width: number; height: number };
  /** 캔버스 위 자리. 상자를 놓는 데 쓴다. */
  view: { left: number; top: number; width: number; height: number };
  /** 원본이 이 조각을 그릴 때 쓴 크기. 조각 높이보다 이쪽이 정확하다. */
  size: number;
  /** 원본이 이 조각에 쓴 글꼴. 다시 쓸 수 없는 글꼴이면 없다. */
  font?: SourceFont | undefined;
}

const MAX_SPANS = 4000;

export async function readEditSpans(document: PDFDocumentProxy, pageNumber: number, viewport: PageViewport, fonts: SourceFont[] | undefined): Promise<Span[]> {
  const spans: Span[] = [];
  const page = await document.getPage(pageNumber);
  try {
    // 조각마다 어떤 글꼴을 썼는지는 글꼴 객체가 있어야 알 수 있고, 그 객체는
    // 쪽을 한 번 훑어야 채워진다. 글자만 뽑아서는 채워지지 않는다.
    const named = await fontNames(page);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      if (spans.length >= MAX_SPANS) break;
      const x = item.transform[4] as number;
      const y = item.transform[5] as number;
      const width = item.width || 1;
      const height = Math.max(item.height, 1);
      const [ax, ay] = viewport.convertToViewportPoint(x, y);
      const [bx, by] = viewport.convertToViewportPoint(x + width, y + height);
      spans.push({
        text: item.str,
        pdf: { x, y, width, height },
        view: {
          left: Math.min(ax!, bx!), top: Math.min(ay!, by!),
          width: Math.max(Math.abs(bx! - ax!), 2), height: Math.max(Math.abs(by! - ay!), 2),
        },
        // 가로 배율이 그릴 때 쓴 글자 크기다. 조각 높이는 글자 모양에 따라 들쭉날쭉하다.
        size: Math.max(1, Math.round(Math.abs(item.transform[0] as number) * 10) / 10) || height,
        font: matchSourceFont(fonts, named.get(item.fontName), item.str),
      });
    }
  } finally { page.cleanup(); }

  return spans;
}

/**
 * PDF.js 가 조각에 붙인 글꼴 이름을 **PDF 안의 글꼴 이름**으로 바꾼다.
 *
 * 조각이 들고 있는 이름은 PDF.js 안에서만 통하는 것(`g_d0_f1`)이라 자원
 * 목록과 곧바로 이어지지 않는다. 쪽을 한 번 훑으면 글꼴 객체가 채워지고,
 * 거기에 원래 이름(BaseFont)이 들어 있다.
 */
async function fontNames(page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    await page.getOperatorList();
  } catch {
    // 훑지 못하면 원본 글꼴을 고르지 못할 뿐이다. 나머지는 그대로 돈다.
    return names;
  }
  const content = await page.getTextContent();
  for (const item of content.items) {
    if (!('str' in item) || names.has(item.fontName)) continue;
    try {
      const object = page.commonObjs.get(item.fontName) as { name?: string } | null;
      if (object?.name) names.set(item.fontName, object.name);
    } catch { /* 아직 안 채워진 글꼴은 건너뛴다 */ }
  }
  return names;
}

/**
 * 이름이 같은 원본 글꼴을 찾는다.
 *
 * 서브셋 접두사(ABCDEF+)는 같은 글꼴에도 문서마다 다르게 붙으므로 떼고 견준다.
 * 같은 이름이 여럿이면 **그 조각의 원래 글자를 쓸 수 있는** 쪽을 고른다 —
 * 그 글자를 담고 있는 서브셋이 실제로 쓰인 것이다.
 */
function matchSourceFont(found: SourceFont[] | undefined, base: string | undefined, text: string): SourceFont | undefined {
  if (!found?.length || !base) return undefined;
  const bare = (value: string): string => value.replace(/^[A-Z]{6}\+/, '');
  const named = found.filter(font => bare(font.label) === bare(base));
  return named.find(font => !font.missing(text).length) ?? named[0];
}

