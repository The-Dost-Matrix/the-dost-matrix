/**
 * Zet een tekst om naar een eenvoudige slug: alles in kleine letters,
 * waarbij (opeenvolgende) spaties worden vervangen door een enkel streepje.
 *
 * @param text De tekst die omgezet moet worden.
 * @returns De geslugificeerde tekst.
 *
 * @example
 * slugify('Hello World') // 'hello-world'
 * slugify('  Meerdere   spaties  ') // 'meerdere-spaties'
 */
export function slugify(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, '-');
}
