type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Clear GPU drag offset only — never wipe width/height or the widget can expand uncontrollably. */
export function clearDragTransform(el: HTMLElement) {
  el.style.transform = '';
  el.style.willChange = '';
}

export function applyDragTranslate(el: HTMLElement, dx: number, dy: number) {
  el.style.willChange = 'transform';
  el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
}

export function applyResizeBox(
  el: HTMLElement,
  originX: number,
  originY: number,
  x: number,
  y: number,
  width: number,
  height: number
) {
  el.style.willChange = 'width, height, left, top';
  el.style.transform = '';
  el.style.left = `${originX + x}px`;
  el.style.top = `${originY + y}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
}

/** Pin final layout after resize commit so content cannot blow up before React re-renders. */
export function pinElementBox(
  el: HTMLElement,
  originX: number,
  originY: number,
  x: number,
  y: number,
  width: number,
  height: number
) {
  el.style.willChange = '';
  el.style.transform = '';
  el.style.left = `${originX + x}px`;
  el.style.top = `${originY + y}px`;
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
}

/** Compute new box from resize handle drag delta. */
export function computeResizeBox(
  handle: ResizeHandle,
  start: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
  minWidth: number,
  minHeight: number
) {
  let newW = start.width;
  let newH = start.height;
  let newX = start.x;
  let newY = start.y;

  if (handle.includes('e')) newW = start.width + dx;
  if (handle.includes('w')) {
    newW = start.width - dx;
    newX = start.x + dx;
  }
  if (handle.includes('s')) newH = start.height + dy;
  if (handle.includes('n')) {
    newH = start.height - dy;
    newY = start.y + dy;
  }

  if (newW < minWidth) {
    if (handle.includes('w')) newX = start.x + start.width - minWidth;
    newW = minWidth;
  }
  if (newH < minHeight) {
    if (handle.includes('n')) newY = start.y + start.height - minHeight;
    newH = minHeight;
  }

  return { x: newX, y: newY, width: newW, height: newH };
}
