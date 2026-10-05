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

// Golos Text, Rubik and JetBrains Mono lack ʻ (U+02BB), used in Uzbek Latin oʻ and gʻ. Nunito has
// both ʻ and ʼ (U+02BC): it serves just these two characters, first in every font stack.
import uzMarksUrl from '@fontsource/nunito/files/nunito-latin-400-normal.woff2?url';

export const UZ_MARKS_FAMILY = 'MIG Uz Marks';
if (typeof document !== 'undefined' && 'fonts' in document && typeof FontFace === 'function') {
  const face = new FontFace(UZ_MARKS_FAMILY, `url(${uzMarksUrl}) format('woff2')`, {
    unicodeRange: 'U+02BB-02BC',
    weight: '100 900',
    display: 'swap',
  });
  document.fonts.add(face);
}
