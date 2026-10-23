/**
 * Limited regression model of Proton's published HSL color rules, not a mail
 * client. It handles only opaque hex colors used by these email fixtures.
 * Source: ProtonMail/clients at 2ecb794dbc221384dc6d88840965ac144db301ad,
 * mail-html-transformer/src/transforms/styles/colors.rs and dark_mode_visitor/declaration_block.rs.
 * Keep this model out of sent email and production imports.
 */
export function rgb(hex: string): { r: number; g: number; b: number } {
  if (!/^#[0-9a-f]{6}$/i.test(hex))
    throw new Error('Expected an opaque hex color.');
  return {
    r: Number.parseInt(hex.slice(1, 3), 16) / 255,
    g: Number.parseInt(hex.slice(3, 5), 16) / 255,
    b: Number.parseInt(hex.slice(5, 7), 16) / 255,
  };
}

export function contrast(first: string, second: string): number {
  const luminance = (hex: string) => {
    const { r, g, b } = rgb(hex);
    const linear = (value: number) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    return 0.212639 * linear(r) + 0.715169 * linear(g) + 0.072192 * linear(b);
  };
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function protonColor(
  hex: string,
  purpose: 'foreground' | 'background',
): string {
  const { r, g, b } = rgb(hex);
  const high = Math.max(r, g, b),
    low = Math.min(r, g, b),
    delta = high - low;
  let l = (high + low) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  let h =
    delta === 0
      ? 0
      : high === r
        ? ((g - b) / delta) % 6
        : high === g
          ? (b - r) / delta + 2
          : (r - g) / delta + 4;
  h = (h * 60 + 360) % 360;
  if (purpose === 'background' && hex.toLowerCase() === '#ffffff')
    return '#191927';
  if (s <= 0.05 || l <= 0.01 || l >= 0.95)
    return purpose === 'background' ? '#16171d' : '#ffffff';
  l = purpose === 'background' ? Math.min(l, 0.3) : Math.max(l, 0.9);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const components =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return (
    '#' +
    components
      .map((value) =>
        Math.round((value + m) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Proton keeps an existing foreground if it has sufficient contrast. */
export function protonForeground(
  color: string,
  background = '#191927',
): string {
  return contrast(color, background) >= 4.5
    ? color
    : protonColor(color, 'foreground');
}
