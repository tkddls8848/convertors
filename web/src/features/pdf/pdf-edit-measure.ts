import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { FontSource } from './pdf-edit';
import { stripLayoutTables } from './sfnt';

/** One cache per editor, retained across edits as before. */
export function createFontMeasurer() {
  const measurers = new Map<string, Promise<(value: string, size: number) => number>>();

  function measurer(font: FontSource): Promise<(value: string, size: number) => number> {
    let held = measurers.get(font.id);
    if (!held) {
      held = buildMeasurer(font);
      measurers.set(font.id, held);
    }
    return held;
  }

  async function buildMeasurer(font: FontSource): Promise<(value: string, size: number) => number> {
    const document = await PDFDocument.create();
    let embedded;
    if (font.standard) {
      embedded = await document.embedFont(StandardFonts[font.standard]);
    } else {
      document.registerFontkit((await import('@pdf-lib/fontkit')).default);
      embedded = await document.embedFont(stripLayoutTables(font.bytes!), { subset: false });
    }
    return (value, size) => Math.max(...value.split('\n').map(line => embedded.widthOfTextAtSize(line, size)));
  }

  return measurer;
}
