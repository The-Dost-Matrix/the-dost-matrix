/**
 * Truncates a string to a maximum length, appending an ellipsis character
 * when the text had to be shortened.
 *
 * The returned string never exceeds `maxLength` characters: the ellipsis
 * takes up one of the available characters.
 *
 * @param text - The text to truncate.
 * @param maxLength - The maximum allowed length of the result.
 * @returns The original text when it fits, otherwise a truncated version ending in '…'.
 *
 * @example
 * truncateText('Hello world', 20); // 'Hello world'
 * truncateText('Hello world', 8);  // 'Hello w…'
 * truncateText('Hello world', 0);  // ''
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= 0) {
    return '';
  }

  if (maxLength === 1) {
    return '…';
  }

  return `${text.slice(0, maxLength - 1)}…`;
}
