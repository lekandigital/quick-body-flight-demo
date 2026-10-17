// Settings → Credits: every attribution in one place. The stage's small
// credit label opens it; the background on screen is listed first.

import { LIBRARY, backgroundById } from '../stage/backgrounds';

interface Line { what: string; who: string; whoUrl?: string; terms: string; termsUrl?: string; link?: string }
interface Group { title: string; note?: string; lines: Line[] }

const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';
const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const OFL = 'https://openfontlicense.org';

const GROUPS = (): Group[] => [
  {
    title: '3D backgrounds',
    note: 'Sketchfab models, shown in Sketchfab’s viewer (sketchfab.com).',
    lines: LIBRARY.map((b) => {
      const c = b.credits[0];
      return { what: c.title, link: c.source, who: c.author, whoUrl: c.authorUrl, terms: 'CC BY 4.0', termsUrl: CC_BY };
    }),
  },
  {
    title: 'Avatars',
    lines: [
      { what: 'Female Mannequin (Universal Animation Library 2)', link: 'https://opengameart.org/content/universal-animation-library-2', who: 'Quaternius', whoUrl: 'https://quaternius.com', terms: 'CC0', termsUrl: CC0 },
      { what: 'Astronaut and Erika (100Avatars R1)', link: 'https://github.com/ToxSam/open-source-avatars', who: 'Polygonal Mind', terms: 'CC0', termsUrl: CC0 },
      { what: 'Robot and hand puppets', who: 'BodyArcade', terms: 'built in code' },
    ],
  },
  {
    title: 'Games',
    lines: [
      { what: 'TinySkies / GlobeFly (Flight and Rowing)', link: 'https://github.com/dannylimanseta/tinyskies', who: 'Danny Limanseta', terms: 'used with permission' },
      { what: 'TinySkies music, sound effects and 3D assets', who: 'Suno, ElevenLabs, Tripo3D', terms: 'per the game’s credits' },
      { what: 'Domine, Darumadrop One (game fonts)', who: 'Google Fonts', terms: 'SIL OFL 1.1', termsUrl: OFL },
    ],
  },
  {
    title: 'Tracking and rendering',
    lines: [
      { what: 'MediaPipe Pose and Hand Landmarker', link: 'https://ai.google.dev/edge/mediapipe', who: 'Google', terms: 'Apache-2.0', termsUrl: 'https://www.apache.org/licenses/LICENSE-2.0' },
      { what: 'three.js', link: 'https://threejs.org', who: 'three.js authors', terms: 'MIT' },
      { what: 'three-vrm', link: 'https://github.com/pixiv/three-vrm', who: 'pixiv', terms: 'MIT' },
      { what: 'Liquid glass (web-glass-effect)', who: 'Creatorem', terms: 'MIT' },
      { what: 'Sketchfab Viewer API', link: 'https://sketchfab.com/developers/viewer', who: 'Sketchfab', terms: 'Sketchfab terms' },
      { what: 'fast-png', who: 'image-js', terms: 'MIT' },
    ],
  },
  {
    title: 'Fonts',
    lines: [{ what: 'Inter, Fraunces, JetBrains Mono', who: 'their authors, via Fontsource', terms: 'SIL OFL 1.1', termsUrl: OFL }],
  },
];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const a = (text: string, href?: string) =>
  href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>` : esc(text);
const line = (l: Line) =>
  `<li><b>${a(l.what, l.link)}</b><span>${a(l.who, l.whoUrl)} · ${a(l.terms, l.termsUrl)}</span></li>`;

/** (Re)draw the credits page; `currentBg` is the background on screen. */
export function renderCredits(el: HTMLElement, currentBg: string | null): void {
  const bg = currentBg ? backgroundById(currentBg) : undefined;
  const now = bg
    ? `<section class="credits-group credits-now"><h4>On screen now</h4><ul>${line({
        what: bg.credits[0].title,
        link: bg.credits[0].source,
        who: bg.credits[0].author,
        whoUrl: bg.credits[0].authorUrl,
        terms: 'CC BY 4.0',
        termsUrl: CC_BY,
      })}</ul></section>`
    : '';
  el.innerHTML =
    now +
    GROUPS()
      .map((g) => `<section class="credits-group"><h4>${esc(g.title)}</h4>${g.note ? `<p>${esc(g.note)}</p>` : ''}<ul>${g.lines.map(line).join('')}</ul></section>`)
      .join('');
}
