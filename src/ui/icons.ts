const NS = 'http://www.w3.org/2000/svg';

/**
 * Inline single-path SVG. Icons are decorative here: every control that uses one
 * also carries its own `aria-label`, so the mark itself stays out of the a11y tree.
 */
export function icon(name: string, path: string): SVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', `icon icon--${name}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const shape = document.createElementNS(NS, 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}
