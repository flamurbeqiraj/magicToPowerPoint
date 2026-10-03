import { SLIDE_HEIGHT, SLIDE_WIDTH, type Presentation, type Slide, type SlideElement, type TextElement } from './model';

const NS = 'http://www.w3.org/2000/svg';
type RenderOptions = { selectedIndex?: number; className?: string; width?: number; height?: number };
const iconPaths: Record<string, string[]> = {
  sparkles:['M12 3 13.8 9.2 20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8L12 3Z','m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14Z'],
  code:['m8 17-5-5 5-5','m16 7 5 5-5 5','m14 4-4 16'], check:['m5 12 4 4L19 6'],
  'arrow-right':['M5 12h14','m13 6 6 6-6 6'], zap:['m13 2-3 9h7L11 22l2-9H6l7-11Z'],
  brain:['M12 18V5','M15.5 4.5a3.5 3.5 0 0 1 3.4 5.1A3.5 3.5 0 0 1 18 16.2a3.5 3.5 0 0 1-6 2.4','M8.5 4.5a3.5 3.5 0 0 0-3.4 5.1A3.5 3.5 0 0 0 6 16.2a3.5 3.5 0 0 0 6 2.4'],
  terminal:['m4 17 6-5-6-5','M12 19h8'], layers:['m12 2 9 5-9 5-9-5 9-5Z','m3 12 9 5 9-5','m3 17 9 5 9-5'],
  shield:['M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z','m9 12 2 2 4-4'],
  rocket:['M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2','m12 15-3-3a22 22 0 0 1 2-3.9A13 13 0 0 1 22 3c0 3.3-.9 7.8-5.1 11A22 22 0 0 1 12 15Z','M9 12H4s.5-3 4-4h3','M12 15v5s3-.5 4-4'],
  target:['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z','M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z','M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
  chart:['M3 3v18h18','m19 9-5 5-4-4-6 6']
};

function svg(tag: string, attrs: Record<string, string | number | undefined> = {}): SVGElement {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined) element.setAttribute(key, String(value));
  return element;
}
function safeToken(input: string): string { return input.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 60) || 'slide'; }

function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (const originalWord of words) {
      let word = originalWord;
      const charLimit = Math.max(1, Math.floor(maxWidth / (fontSize * 0.55)));
      while (word.length > charLimit) {
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, charLimit)); word = word.slice(charLimit);
        if (lines.length >= maxLines) return lines.slice(0, maxLines);
      }
      const next = line ? `${line} ${word}` : word;
      if (next.length * fontSize * 0.55 > maxWidth && line) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
    if (lines.length >= maxLines) return lines.slice(0, maxLines);
  }
  return lines.slice(0, maxLines);
}

function addWrappedText(parent: SVGElement, value: string, element: TextElement | Extract<SlideElement, {type:'bulletList'}>, width: number, height: number, id: string, bullet?: { color: string; spacing: number }): void {
  const size = element.fontSize;
  const lineHeight = size * (bullet?.spacing ?? 1.22);
  const maxLines = Math.max(1, Math.floor(height / lineHeight));
  const lines = wrapText(value, width, size, maxLines);
  const anchor = element.align === 'center' ? 'middle' : element.align === 'right' ? 'end' : 'start';
  const startX = element.align === 'center' ? width / 2 : element.align === 'right' ? width : 0;
  const availableHeight = lines.length * lineHeight;
  let baseline = size;
  const verticalAlign = 'verticalAlign' in element ? element.verticalAlign : 'top';
  if (verticalAlign === 'middle') baseline = Math.max(size, (height - availableHeight) / 2 + size);
  if (verticalAlign === 'bottom') baseline = Math.max(size, height - availableHeight + size);
  const clipId = `clip-${safeToken(id)}`;
  const defs = svg('defs');
  const clip = svg('clipPath', { id: clipId });
  clip.append(svg('rect', { x:0, y:0, width, height })); defs.append(clip); parent.append(defs);
  const text = svg('text', {
    x:startX, y:baseline, 'font-size':size, 'font-weight':element.fontWeight, fill:element.color,
    'font-family':element.fontFamily || 'Inter, Arial, sans-serif', 'text-anchor':anchor,
    'letter-spacing':'letterSpacing' in element ? element.letterSpacing : 0, 'clip-path':`url(#${clipId})`,
    'dominant-baseline':'alphabetic'
  });
  for (let i = 0; i < lines.length; i++) {
    const tspan = svg('tspan', { x:startX, y:baseline + i * lineHeight });
    if (bullet && i === 0) tspan.setAttribute('data-bullet-color', bullet.color);
    tspan.textContent = lines[i]; text.append(tspan);
  }
  parent.append(text);
}

function elementGroup(el: SlideElement, index: number, slide: Slide, selected: boolean): SVGGElement {
  const group = svg('g', { 'data-element-index':index, opacity:el.opacity ?? 1, cursor:'move' }) as SVGGElement;
  if (el.type === 'line') {
    group.append(svg('line', { x1:el.x1, y1:el.y1, x2:el.x2, y2:el.y2, stroke:el.stroke, 'stroke-width':el.strokeWidth, opacity:el.opacity, 'stroke-linecap':'round' }));
    group.append(svg('line', { x1:el.x1, y1:el.y1, x2:el.x2, y2:el.y2, stroke:'#ffffff', 'stroke-opacity':0.001, 'stroke-width':Math.max(16,el.strokeWidth), 'pointer-events':'stroke' }));
    if (selected) {
      const x = Math.min(el.x1,el.x2), y = Math.min(el.y1,el.y2), width = Math.max(Math.abs(el.x2-el.x1),12), height = Math.max(Math.abs(el.y2-el.y1),12);
      group.append(svg('rect', { x:x-6, y:y-6, width:width+12, height:height+12, fill:'none', stroke:'#a7e35d', 'stroke-width':2, 'stroke-dasharray':'7 5', 'vector-effect':'non-scaling-stroke', 'pointer-events':'none' }));
    }
    return group;
  }
  const cx = el.x + el.width / 2, cy = el.y + el.height / 2;
  if (el.rotation) group.setAttribute('transform', `rotate(${el.rotation} ${cx} ${cy})`);
  if (el.type === 'text') {
    group.setAttribute('data-text', 'true'); group.setAttribute('data-editable', 'true');
    const textBox = svg('g', { transform:`translate(${el.x} ${el.y})` });
    addWrappedText(textBox, el.text, el, el.width, el.height, `${index}-${slide.id}`);
    group.append(textBox);
  } else if (el.type === 'bulletList') {
    const rowHeight = el.fontSize * el.lineSpacing;
    el.items.slice(0, 12).forEach((item, itemIndex) => {
      const y = itemIndex * rowHeight;
      if (y >= el.height) return;
      group.append(svg('circle', { cx:el.x + Math.min(10, el.fontSize * .4), cy:el.y + y + el.fontSize * .58, r:Math.max(2.5, el.fontSize * .075), fill:el.bulletColor }));
      const inner = svg('g', { transform:`translate(${el.x + el.fontSize * .95} ${el.y + y})` });
      const copy = { ...el, x:0, y:0, width:Math.max(0, el.width - el.fontSize), height:Math.min(el.height - y, rowHeight * 1.9), align:el.align, verticalAlign:'top' as const };
      addWrappedText(inner, item, copy, copy.width, copy.height, `${index}-${itemIndex}-${slide.id}`);
      group.append(inner);
    });
  } else if (el.type === 'rectangle' || el.type === 'roundedRectangle') {
    group.append(svg('rect', { x:el.x, y:el.y, width:el.width, height:el.height,
      rx:el.type === 'roundedRectangle' ? el.radius : 0, fill:el.fill, stroke:el.stroke, 'stroke-width':el.strokeWidth }));
  } else if (el.type === 'circle' || el.type === 'ellipse') {
    group.append(svg('ellipse', { cx:el.x + el.width/2, cy:el.y + el.height/2, rx:el.width/2, ry:el.height/2, fill:el.fill, stroke:el.stroke, 'stroke-width':el.strokeWidth }));
  } else if (el.type === 'icon') {
    const paths = iconPaths[el.icon] ?? iconPaths.sparkles;
    const icon = svg('svg', { x:el.x, y:el.y, width:el.width, height:el.height, viewBox:'0 0 24 24', fill:'none', stroke:el.color, 'stroke-width':1.7, 'stroke-linecap':'round', 'stroke-linejoin':'round' });
    for (const d of paths) icon.append(svg('path', { d })); group.append(icon);
  } else if (el.type === 'image') {
    const radius = el.borderRadius;
    group.append(svg('rect', { x:el.x, y:el.y, width:el.width, height:el.height, rx:radius, fill:'#252a2d', stroke:'#464c4f', 'stroke-width':1 }));
    const icon = svg('svg', { x:el.x + el.width/2 - 17, y:el.y + el.height/2 - 28, width:34, height:34, viewBox:'0 0 24 24', fill:'none', stroke:'#afb6b3', 'stroke-width':1.5, 'stroke-linecap':'round', 'stroke-linejoin':'round' });
    icon.append(svg('rect', {x:3,y:3,width:18,height:18,rx:2}), svg('circle',{cx:8.5,cy:8.5,r:1.5}), svg('path',{d:'m21 15-5-5L5 21'})); group.append(icon);
    const label = svg('text', { x:el.x + el.width/2, y:el.y + el.height/2 + 20, fill:'#aab1ae', 'font-size':14, 'text-anchor':'middle', 'font-family':'Arial, sans-serif' });
    label.textContent = el.searchQuery ? `Image · ${el.searchQuery.slice(0, 32)}` : 'Image provider placeholder'; group.append(label);
  }
  // A nearly transparent hit area makes the whole element box draggable, including whitespace in text boxes.
  group.append(svg('rect', { x:el.x, y:el.y, width:el.width, height:el.height, fill:'#ffffff', 'fill-opacity':0.001, 'pointer-events':'all' }));
  if (selected) {
    group.append(svg('rect', { x:el.x, y:el.y, width:el.width, height:el.height, fill:'none', stroke:'#a7e35d', 'stroke-width':2, 'stroke-dasharray':'7 5', 'vector-effect':'non-scaling-stroke', 'pointer-events':'none' }));
    group.append(svg('rect', { x:el.x + el.width - 8, y:el.y + el.height - 8, width:16, height:16, rx:3, fill:'#a7e35d', stroke:'#151719', 'stroke-width':2, 'data-resize-index':index, cursor:'nwse-resize' }));
  }
  return group;
}

export function renderSlide(root: SVGSVGElement, slide: Slide, presentation: Presentation, options: RenderOptions = {}): void {
  while (root.firstChild) root.removeChild(root.firstChild);
  root.setAttribute('xmlns', NS); root.setAttribute('viewBox', `0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`);
  root.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  root.setAttribute('role', 'img'); root.setAttribute('aria-label', `Slide: ${presentation.title}`);
  if (options.width) root.setAttribute('width', String(options.width));
  if (options.height) root.setAttribute('height', String(options.height));
  const viewportId = `slide-viewport-${safeToken(slide.id)}`;
  const defs = svg('defs'); const viewport = svg('clipPath', { id:viewportId, clipPathUnits:'userSpaceOnUse' });
  viewport.append(svg('rect', { x:0, y:0, width:SLIDE_WIDTH, height:SLIDE_HEIGHT })); defs.append(viewport); root.append(defs);
  root.append(svg('rect', { x:0, y:0, width:SLIDE_WIDTH, height:SLIDE_HEIGHT, fill:presentation.theme.background }));
  const content = svg('g', { 'clip-path':`url(#${viewportId})` });
  slide.elements.forEach((element, index) => content.append(elementGroup(element, index, slide, options.selectedIndex === index)));
  root.append(content);
}

export function slideSvgMarkup(root: SVGSVGElement): string {
  const clone = root.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', NS); clone.setAttribute('width', String(SLIDE_WIDTH)); clone.setAttribute('height', String(SLIDE_HEIGHT));
  return new XMLSerializer().serializeToString(clone);
}
export function slideSvgBlob(root: SVGSVGElement): Blob { return new Blob([slideSvgMarkup(root)], { type:'image/svg+xml;charset=utf-8' }); }

export function downloadSlide(root: SVGSVGElement, fileName: string): void {
  const url = URL.createObjectURL(slideSvgBlob(root));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${fileName.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}.svg`;
  anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
