/** Characters outside the standard fonts' encoding (WinAnsi) are replaced. */
export function printable(text: string): string {
  return text
    .replace(/[▒█■]/g, '#')
    .replace(/[\u2009\u202f]/g, ' ')
    .replace(
      /[^\t\n\u0020-\u007e\u00a0-\u00ff\u20ac\u0152\u0153\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026]/g,
      '?',
    );
}
