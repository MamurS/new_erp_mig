// Self-hosted fonts (cyrillic + latin subsets only). No CDNs.
import '@fontsource/golos-text/cyrillic-400.css';
import '@fontsource/golos-text/latin-400.css';
import '@fontsource/golos-text/cyrillic-500.css';
import '@fontsource/golos-text/latin-500.css';
import '@fontsource/golos-text/cyrillic-600.css';
import '@fontsource/golos-text/latin-600.css';
import '@fontsource/golos-text/cyrillic-700.css';
import '@fontsource/golos-text/latin-700.css';
import '@fontsource/jetbrains-mono/cyrillic-400.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/rubik/cyrillic-600.css';
import '@fontsource/rubik/latin-600.css';
import '@fontsource/nunito/cyrillic-400.css';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/cyrillic-600.css';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/cyrillic-700.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/cyrillic-800.css';
import '@fontsource/nunito/latin-800.css';

// Golos Text, Rubik and JetBrains Mono lack ʻ (U+02BB), used in Uzbek Latin oʻ and gʻ. A tiny font
// built from Golos's own glyphs (scripts/build-uz-marks.py, SIL OFL, public/fonts) serves just ʻ and ʼ (U+02BC),
// first in every font stack, so the marks look the same in every theme.
export const UZ_MARKS_FAMILY = 'MIG Uz Marks';
// Served from public/fonts (same origin: CSP font-src 'self'); never inlined as data: URIs.
const UZ_MARKS: [string, string][] = [
  ['100 449', '/fonts/uz-marks-400.woff2'],
  ['450 549', '/fonts/uz-marks-500.woff2'],
  ['550 649', '/fonts/uz-marks-600.woff2'],
  ['650 900', '/fonts/uz-marks-700.woff2'],
];
if (typeof document !== 'undefined' && 'fonts' in document && typeof FontFace === 'function') {
  for (const [weight, url] of UZ_MARKS)
    document.fonts.add(new FontFace(UZ_MARKS_FAMILY, `url(${url}) format('woff2')`, { unicodeRange: 'U+02BB-02BC', weight, display: 'swap' }));
}
