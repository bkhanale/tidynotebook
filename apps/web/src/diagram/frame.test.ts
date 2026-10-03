/**
 * The presentation invariants of the diagram frame.
 *
 * The frame is a sandboxed document inside a live-preview widget. A click on
 * a separate document moves the focus into it, so the widget never learns of
 * the click: the source of the diagram stays closed and every keystroke after
 * the click is lost. The frame therefore takes no pointer event.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { themeProperties, themes } from '@notesapp/ui';
import {
  diagramThemeOptions,
  isParentMessage,
  clampDiagramHeight,
  diagramFrameStyle,
  diagramLimits,
  isDiagramRequest,
  longHexColour,
  paletteNames,
} from './frame.ts';

await test('the diagram frame lets a click reach the editor', () => {
  assert.equal(diagramFrameStyle['pointerEvents'], 'none');
});

await test('the diagram frame fills the measure and shows no border', () => {
  assert.equal(diagramFrameStyle['width'], '100%');
  assert.equal(diagramFrameStyle['border'], '0');
});

await test('the load clock is longer than the render clock', () => {
  // Two clocks answer two questions. The frame holds the whole diagram engine
  // inline, so the bytes need more time than the drawing, and a render budget
  // that started before the bytes arrived spent itself on the download. That
  // is what left a diagram as plain text on a slow link.
  assert.ok(diagramLimits.maxLoadMs > diagramLimits.maxRenderMs);
});

await test('a reported height is clamped into the applied bounds', () => {
  assert.equal(clampDiagramHeight(-1), diagramLimits.minHeightPx);
  assert.equal(clampDiagramHeight(Number.NaN), diagramLimits.minHeightPx);
  assert.equal(clampDiagramHeight(10_000), diagramLimits.maxHeightPx);
  assert.equal(clampDiagramHeight(240.4), 240);
});

await test('a short colour of the stylesheet reaches the frame in six digits', () => {
  // The light palette of a published page comes from the built stylesheet,
  // which writes `#ffffff` as `#fff`. The frame refused that request, so a
  // published diagram drew in dark and never in light (record 0158).
  assert.equal(longHexColour('#fff'), '#ffffff');
  assert.equal(longHexColour('#1A6'), '#11AA66');
  assert.equal(longHexColour('#f7f7f5'), '#f7f7f5');
  assert.equal(longHexColour('white'), 'white');
  const palette = ['#fff', '#f7f7f5', '#37352f', '#1a63c4', '#85837d'];
  const request = (colours: readonly string[]) => ({
    requestId: 'r',
    source: 'graph TD;',
    theme: 'light',
    palette: colours,
  });
  assert.equal(paletteNames.length, palette.length);
  assert.equal(isDiagramRequest(request(palette)), false);
  assert.equal(isDiagramRequest(request(palette.map(longHexColour))), true);
});

await test('a diagram takes its colours from the palette of the page in both appearances', () => {
  // The light diagram drew in the lavender of the default Mermaid theme while
  // the page drew the Default palette. Every colour now comes from the palette
  // that the request carries, so a theme of the registry reaches the frame.
  const light = ['#ffffff', '#f7f7f5', '#37352f', '#1a63c4', '#85837d'];
  const dark = ['#191919', '#141414', '#d0cfcc', '#6fa8f5', '#807e79'];
  for (const [theme, palette] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    const options = diagramThemeOptions({
      requestId: 'r',
      source: 'graph TD;',
      theme,
      palette,
    });
    assert.equal(options.theme, 'base');
    assert.equal(options.darkMode, theme === 'dark');
    const variables = options.themeVariables;
    assert.equal(variables['background'], palette[0]);
    assert.equal(variables['primaryColor'], palette[1]);
    assert.equal(variables['primaryTextColor'], palette[2]);
    assert.equal(variables['primaryBorderColor'], palette[4]);
    assert.equal(variables['lineColor'], palette[4]);
    // No colour of a Mermaid theme stays: each value is one of the palette,
    // and the one value that is not a colour turns the shadow off.
    assert.deepEqual(
      Object.entries(variables).filter(([, value]) => !palette.includes(value)),
      [['dropShadow', 'none']],
    );
  }
});

await test('a diagram node draws no shadow in any theme of the registry', () => {
  // Mermaid 12 draws a flowchart and a sequence diagram in its `neo` look,
  // which puts a shadow under each node. The `base` theme colours it a light
  // grey, so every node of a dark page had a pale halo. The `neo` look also
  // adds a shadow filter of a colour that no palette reaches. A node is part
  // of the page and not a raised surface, so no theme draws a shadow.
  assert.ok(themes.length > 2);
  for (const theme of themes) {
    const properties = new Map(themeProperties(theme));
    const palette = paletteNames.map((name) =>
      longHexColour(properties.get(name) ?? ''),
    );
    const request = {
      requestId: 'r',
      source: 'graph TD;',
      theme: theme.appearance,
      palette,
    };
    assert.equal(isDiagramRequest(request), true, theme.id);
    const options = diagramThemeOptions(request);
    assert.equal(options.look, 'classic', theme.id);
    assert.equal(options.themeVariables['dropShadow'], 'none', theme.id);
  }
});

await test('the frame takes a request from its parent and from no one else', () => {
  // A frame document opened at the top level, or a message of a sibling
  // frame, drew whatever it received with the inline script of the frame.
  const parent = { name: 'parent' };
  const framed = { parent };
  assert.equal(isParentMessage(framed, parent), true);
  assert.equal(isParentMessage(framed, { name: 'sibling' }), false);
  assert.equal(isParentMessage(framed, null), false);
  // At the top level a window is its own parent, so nothing is a request.
  const top: { parent: unknown } = { parent: null };
  top.parent = top;
  assert.equal(isParentMessage(top, top), false);
});
