const round = (n: number): number => Math.round(n * 10) / 10;

function spikesMarkup(): string {
  const cx = 96;
  const cy = 126;
  const count = 9;
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = ((158 + (180 * i) / (count - 1)) * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const baseR = 46;
    const tipR = 74 + (i % 2 === 0 ? 5 : 0);
    const bx = cx + cos * baseR;
    const by = cy + sin * baseR;
    const tx = cx + cos * tipR;
    const ty = cy + sin * tipR;
    const px = -sin;
    const py = cos;
    const w = 12;
    parts.push(
      `<polygon class="hh-spike" points="${round(bx + px * w)},${round(by + py * w)} ` +
        `${round(tx)},${round(ty)} ${round(bx - px * w)},${round(by - py * w)}"/>`
    );
  }
  return parts.join('');
}

export function hedgehogMarkup(): string {
  return `<svg class="hedgehog" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g id="hh-root">
    <g id="hh-spikes">${spikesMarkup()}</g>
    <g id="hh-legs">
      <ellipse id="hh-leg-bl" class="hh-leg" cx="70" cy="170" rx="11" ry="18"/>
      <ellipse id="hh-leg-fl" class="hh-leg" cx="118" cy="172" rx="11" ry="18"/>
      <ellipse id="hh-leg-br" class="hh-leg" cx="92" cy="172" rx="11" ry="18"/>
      <ellipse id="hh-leg-fr" class="hh-leg" cx="140" cy="170" rx="11" ry="18"/>
    </g>
    <g id="hh-body">
      <ellipse class="hh-body" cx="96" cy="128" rx="62" ry="50"/>
      <ellipse class="hh-belly" cx="104" cy="150" rx="34" ry="24"/>
    </g>
    <g id="hh-head">
      <g id="hh-ears">
        <ellipse class="hh-ear" cx="138" cy="116" rx="10" ry="10"/>
        <ellipse class="hh-ear" cx="162" cy="112" rx="9" ry="9"/>
      </g>
      <ellipse class="hh-face" cx="146" cy="146" rx="34" ry="28"/>
      <g id="hh-eyes">
        <g id="hh-eye-l"><circle class="hh-eye" cx="136" cy="130" r="7"/><circle class="hh-glint" cx="133.5" cy="127.5" r="2.5"/></g>
        <g id="hh-eye-r"><circle class="hh-eye" cx="158" cy="126" r="7"/><circle class="hh-glint" cx="155.5" cy="123.5" r="2.5"/></g>
      </g>
      <g id="hh-eyes-happy">
        <path d="M128 132 Q136 123 144 132"/>
        <path d="M150 128 Q158 119 166 128"/>
      </g>
      <g id="hh-mouth"><ellipse id="hh-mouth-shape" class="hh-mouth-shape" cx="168" cy="158" rx="7" ry="1.5"/></g>
      <ellipse class="hh-nose" cx="174" cy="146" rx="7" ry="6"/>
    </g>
  </g>
</svg>`;
}
