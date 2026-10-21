// Creature art and labels, shared by the server page and the claude.ai page.
// The SVG only uses numbers and fixed strings from the genome.

// Simple round blobs whose shape, colour, ears and eyes come from the genome.
// Mood changes the mouth; fondness adds blush. Babies are smaller.

// Display names for the genome's placeholder values. Creatures are Suns or Moons;
// whom they fall for is a separate gene, so every pairing is possible.
export const KIND_LABEL = { a: '☀️ Sun', b: '🌙 Moon' };
export const HEART_LABEL = { a: 'falls for Suns', b: 'falls for Moons', both: 'falls for anyone', none: '✨ Stargazer (not into romance)' };

export function creatureSVG(c) {
  const g = c.genome;
  const hue = g.hue;
  const fill = `hsl(${hue} 70% 80%)`;
  const stroke = `hsl(${hue} 45% 45%)`;
  const scale = { baby: 0.72, youth: 0.86, adult: 1 }[c.stage] ?? 1;
  const eyeR = 6 + g.traits.curiosity * 3;
  const cx = 100;
  const cy = 118;

  let body;
  if (g.shape === 'tall') body = `<ellipse cx="${cx}" cy="${cy}" rx="46" ry="58" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
  else if (g.shape === 'fluffy') {
    body = [[-38, 10], [38, 10], [-22, -34], [22, -34], [0, -46], [-42, -18], [42, -18]]
      .map(([dx, dy]) => `<circle cx="${cx + dx}" cy="${cy + dy}" r="26" fill="${fill}"/>`)
      .join('') + `<circle cx="${cx}" cy="${cy}" r="58" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;
  } else body = `<circle cx="${cx}" cy="${cy}" r="56" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`;

  const earY = cy - 50;
  const ears = {
    none: '',
    round: `<circle cx="${cx - 38}" cy="${earY}" r="14" fill="${fill}" stroke="${stroke}" stroke-width="3"/><circle cx="${cx + 38}" cy="${earY}" r="14" fill="${fill}" stroke="${stroke}" stroke-width="3"/>`,
    pointy: `<path d="M${cx - 44} ${earY + 10} L${cx - 30} ${earY - 34} L${cx - 14} ${earY + 4} Z" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/><path d="M${cx + 44} ${earY + 10} L${cx + 30} ${earY - 34} L${cx + 14} ${earY + 4} Z" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>`,
    leaf: `<ellipse cx="${cx - 36}" cy="${earY - 6}" rx="10" ry="24" transform="rotate(-25 ${cx - 36} ${earY - 6})" fill="hsl(${(hue + 40) % 360} 60% 70%)" stroke="${stroke}" stroke-width="3"/><ellipse cx="${cx + 36}" cy="${earY - 6}" rx="10" ry="24" transform="rotate(25 ${cx + 36} ${earY - 6})" fill="hsl(${(hue + 40) % 360} 60% 70%)" stroke="${stroke}" stroke-width="3"/>`,
  }[g.ears] ?? '';

  const eyeY = cy - 6;
  const eyes = [cx - 20, cx + 20].map((x) => `
    <circle cx="${x}" cy="${eyeY}" r="${eyeR}" fill="#3d3350"/>
    <circle cx="${x + 2}" cy="${eyeY - 2}" r="${eyeR * 0.35}" fill="#fff"/>`).join('');

  const scared = c.mood === 'scared';
  const brows = c.mood === 'scared' || c.mood === 'hungry'
    ? `<path d="M${cx - 30} ${eyeY - 14} L${cx - 12} ${eyeY - 8}" stroke="#3d3350" stroke-width="2.5" stroke-linecap="round"/><path d="M${cx + 30} ${eyeY - 14} L${cx + 12} ${eyeY - 8}" stroke="#3d3350" stroke-width="2.5" stroke-linecap="round"/>`
    : '';
  const mouths = {
    happy: `<path d="M${cx - 12} ${cy + 16} Q${cx} ${cy + 30} ${cx + 12} ${cy + 16}" fill="none" stroke="#3d3350" stroke-width="3" stroke-linecap="round"/>`,
    content: `<path d="M${cx - 9} ${cy + 18} Q${cx} ${cy + 23} ${cx + 9} ${cy + 18}" fill="none" stroke="#3d3350" stroke-width="3" stroke-linecap="round"/>`,
    hungry: `<ellipse cx="${cx}" cy="${cy + 20}" rx="6" ry="7" fill="#3d3350"/>`,
    tired: `<path d="M${cx - 9} ${cy + 20} L${cx + 9} ${cy + 20}" stroke="#3d3350" stroke-width="3" stroke-linecap="round"/>`,
    scared: `<ellipse cx="${cx}" cy="${cy + 20}" rx="5" ry="8" fill="#3d3350"/>`,
  }[c.mood] ?? '';
  const sweat = scared ? `<path d="M${cx + 52} ${cy - 30} q6 12 0 18 q-6 -6 0 -18z" fill="#9fd8ff"/>` : '';

  const blush = c.you.fondness > 40
    ? `<ellipse cx="${cx - 34}" cy="${cy + 10}" rx="7" ry="4" fill="#ff8fb1" opacity="0.7"/><ellipse cx="${cx + 34}" cy="${cy + 10}" rx="7" ry="4" fill="#ff8fb1" opacity="0.7"/>`
    : '';

  return `<svg class="creature-art bob" viewBox="0 0 200 200" role="img" aria-label="${c.stage} ${c.mood} creature" style="transform-origin:center">
    <g transform="translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})">
      ${ears}${body}${brows}${eyes}${blush}${mouths}${sweat}
    </g></svg>`;
}
