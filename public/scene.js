/* Lounj lounge illustration (SVG). window.LOUNJ_SCENE(opts) -> svg string.
   opts: { glow: '#F0A35E', accent: '#7A2E3A', seed: 0, hero: false } */
window.LOUNJ_SCENE = function ({ glow = '#F0A35E', accent = '#7A2E3A', seed = 0, hero = false } = {}) {
  const r = n => ((Math.sin(seed * 9301 + n * 49297) + 1) / 2);   // deterministic 0..1
  const flip = seed % 2 ? -1 : 1;
  const lantern = (x, y, s, len, op = 1) => `
    <g transform="translate(${x} 0)" opacity="${op}">
      <line x1="0" y1="0" x2="0" y2="${y}" stroke="#6b5232" stroke-width="1.2"/>
      <circle cx="0" cy="${y + 22 * s}" r="${46 * s}" fill="url(#lg)"/>
      <g transform="translate(0 ${y}) scale(${s})">
        <path d="M0 0 L-7 10 H7 Z" fill="#b8883f"/>
        <path d="M-12 10 H12 L10 14 H-10 Z" fill="#c99a4a"/>
        <path d="M-11 14 C-15 24 -15 32 -9 40 H9 C15 32 15 24 11 14 Z" fill="${glow}" opacity=".95"/>
        <path d="M-11 14 C-15 24 -15 32 -9 40 H9 C15 32 15 24 11 14 Z" fill="url(#lattice)" opacity=".55"/>
        <path d="M-9 40 H9 L6 45 H-6 Z" fill="#c99a4a"/>
        <path d="M0 45 V${len}" stroke="#b8883f" stroke-width="1.4"/>
      </g>
    </g>`;
  const smoke = `
    <g transform="translate(200 248) scale(1.22) translate(-200 -248)" fill="none" stroke="url(#sm)" stroke-linecap="round" filter="url(#blur)">
      <path d="M200 132 C 190 110 214 96 202 76 C 190 56 214 44 204 22" stroke-width="7"/>
      <path d="M206 130 C 222 112 200 98 214 80 C 228 62 210 48 222 30" stroke-width="5" opacity=".7"/>
      <path d="M196 134 C 178 120 192 104 180 90 C 168 76 182 62 172 48" stroke-width="4" opacity=".55"/>
    </g>`;
  const hookah = `
    <g transform="translate(200 248) scale(1.22) translate(0 -248)">
      <!-- hose -->
      <path d="M8 176 C 40 168 66 190 62 212 C 58 232 ${30 * flip + 70} 238 ${flip > 0 ? 112 : -40} 226" fill="none" stroke="#2a1a14" stroke-width="5" stroke-linecap="round"/>
      <path d="M8 176 C 40 168 66 190 62 212 C 58 232 ${30 * flip + 70} 238 ${flip > 0 ? 112 : -40} 226" fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" stroke-dasharray="2 3"/>
      <!-- vase -->
      <path d="M-6 190 C -10 200 -30 206 -34 222 C -38 238 -24 248 0 248 C 24 248 38 238 34 222 C 30 206 10 200 6 190 Z" fill="url(#glass)"/>
      <path d="M-28 228 C -24 242 24 242 28 228 C 30 238 18 246 0 246 C -18 246 -30 238 -28 228 Z" fill="${glow}" opacity=".35"/>
      <path d="M-22 214 C -26 222 -24 232 -18 238" stroke="rgba(255,255,255,.55)" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <!-- stem -->
      <rect x="-4" y="140" width="8" height="52" rx="2" fill="url(#brass)"/>
      <ellipse cx="0" cy="152" rx="9" ry="5" fill="url(#brass)"/>
      <ellipse cx="0" cy="168" rx="11" ry="6" fill="url(#brass)"/>
      <ellipse cx="0" cy="182" rx="8" ry="4" fill="url(#brass)"/>
      <path d="M4 172 L18 170 L20 176 L6 178 Z" fill="url(#brass)"/>
      <!-- tray -->
      <ellipse cx="0" cy="140" rx="30" ry="6" fill="url(#brass)"/>
      <ellipse cx="0" cy="138.5" rx="26" ry="4" fill="#e6c27a" opacity=".5"/>
      <!-- bowl + heat -->
      <path d="M-11 122 H11 L7 138 H-7 Z" fill="#8a3b26"/>
      <rect x="-13" y="116" width="26" height="7" rx="2" fill="#cfd3d6" opacity=".9"/>
      <circle cx="-6" cy="114" r="4.2" fill="#ff7a2a"/><circle cx="4" cy="113" r="4.6" fill="#ffb347"/><circle cx="-1" cy="110" r="3.6" fill="#ff5e1a"/>
      <circle cx="0" cy="113" r="16" fill="url(#coal)"/>
    </g>`;
  const scene = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b120d"/><stop offset=".7" stop-color="#120c09"/><stop offset="1" stop-color="#0c0806"/></linearGradient>
    <radialGradient id="amb" cx="50%" cy="58%" r="60%"><stop offset="0" stop-color="${glow}" stop-opacity=".55"/><stop offset=".5" stop-color="${glow}" stop-opacity=".14"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
    <radialGradient id="lg"><stop offset="0" stop-color="${glow}" stop-opacity=".55"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>
    <radialGradient id="coal"><stop offset="0" stop-color="#ffb347" stop-opacity=".9"/><stop offset="1" stop-color="#ff5e1a" stop-opacity="0"/></radialGradient>
    <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3d58e"/><stop offset=".5" stop-color="#b8883f"/><stop offset="1" stop-color="#7a5524"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4fb3a5" stop-opacity=".85"/><stop offset=".6" stop-color="#1f5f62" stop-opacity=".9"/><stop offset="1" stop-color="#0f3036"/></linearGradient>
    <linearGradient id="sofa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="#2a0f14"/></linearGradient>
    <linearGradient id="sm" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#fff2e0" stop-opacity=".55"/><stop offset="1" stop-color="#fff2e0" stop-opacity="0"/></linearGradient>
    <pattern id="lattice" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 3 L3 0 L6 3 L3 6 Z" fill="none" stroke="#3a2412" stroke-width=".8"/></pattern>
    <pattern id="rug" width="22" height="12" patternUnits="userSpaceOnUse"><path d="M0 6 L11 0 L22 6 L11 12 Z" fill="none" stroke="${glow}" stroke-opacity=".25" stroke-width="1"/></pattern>
    <filter id="blur"><feGaussianBlur stdDeviation="2.2"/></filter>
  </defs>
  <rect width="400" height="300" fill="url(#wall)"/>
  <!-- arched alcove with lattice -->
  <g opacity=".55">
    <path d="M150 210 V110 C150 70 175 48 200 40 C225 48 250 70 250 110 V210 Z" fill="#160e0a" stroke="#4a3220" stroke-width="2"/>
    <path d="M160 210 V114 C160 80 180 62 200 55 C220 62 240 80 240 114 V210 Z" fill="url(#lattice)" opacity=".7"/>
  </g>
  <rect width="400" height="300" fill="url(#amb)"/>
  ${lantern(70 + r(1) * 10, 30 + r(2) * 14, 1.05, 52)}
  ${lantern(330 - r(3) * 10, 18 + r(4) * 16, .9, 48)}
  ${hero ? lantern(120, 6, .7, 40, .8) + lantern(285, 10, .65, 36, .8) : ''}
  <!-- floor + rug -->
  <path d="M0 236 H400 V300 H0 Z" fill="#0d0907"/>
  <ellipse cx="200" cy="262" rx="190" ry="34" fill="#2a1410"/>
  <ellipse cx="200" cy="262" rx="190" ry="34" fill="url(#rug)"/>
  <ellipse cx="200" cy="262" rx="176" ry="28" fill="none" stroke="${glow}" stroke-opacity=".35" stroke-width="1.5"/>
  <!-- sofas & cushions -->
  <g>
    <path d="M-10 196 Q 0 176 30 178 L118 184 Q 132 186 132 200 V244 H-10 Z" fill="url(#sofa)"/>
    <rect x="-6" y="214" width="138" height="30" rx="8" fill="#3a141b"/>
    <rect x="12" y="186" width="44" height="34" rx="12" fill="#c9a24e" opacity=".9" transform="rotate(-8 34 203)"/>
    <rect x="64" y="190" width="40" height="30" rx="12" fill="#2f6f6a" transform="rotate(6 84 205)"/>
    <path d="M410 196 Q 400 176 370 178 L282 184 Q 268 186 268 200 V244 H410 Z" fill="url(#sofa)"/>
    <rect x="268" y="214" width="138" height="30" rx="8" fill="#3a141b"/>
    <rect x="296" y="190" width="40" height="30" rx="12" fill="#c9a24e" opacity=".9" transform="rotate(-6 316 205)"/>
    <rect x="344" y="186" width="44" height="34" rx="12" fill="#2f6f6a" transform="rotate(8 366 203)"/>
  </g>
  <!-- brass tray table -->
  <ellipse cx="200" cy="252" rx="62" ry="12" fill="#0c0806" opacity=".7"/>
  <path d="M170 248 L178 270 M230 248 L222 270" stroke="#7a5524" stroke-width="4" stroke-linecap="round"/>
  <ellipse cx="200" cy="246" rx="58" ry="11" fill="url(#brass)"/>
  <ellipse cx="200" cy="244" rx="50" ry="8" fill="none" stroke="#f3d58e" stroke-opacity=".6" stroke-width="1"/>
  <!-- tea glasses -->
  <g transform="translate(146 230)"><path d="M-5 0 H5 C4 6 2 8 3 14 H-3 C-2 8 -4 6 -5 0 Z" fill="#b5462a" opacity=".85"/><ellipse cx="0" cy="15" rx="7" ry="2" fill="url(#brass)"/></g>
  <g transform="translate(256 232)"><path d="M-5 0 H5 C4 6 2 8 3 14 H-3 C-2 8 -4 6 -5 0 Z" fill="#b5462a" opacity=".85"/><ellipse cx="0" cy="15" rx="7" ry="2" fill="url(#brass)"/></g>
  ${smoke}
  ${hookah}
  <rect width="400" height="300" fill="url(#amb)" opacity=".35"/>
</svg>`;
  return scene;
};
