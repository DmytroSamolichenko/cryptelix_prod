export interface DrawingPoint {
  x: number;
  y: number;
}

export interface DrawingStroke {
  id: string;
  color: string;
  width: number;
  points: DrawingPoint[];
}

export interface DrawingDocument {
  version: 1;
  strokes: DrawingStroke[];
}

export const WORLD_STROKE_WIDTH = 6;
export const WORLD_ERASER_WIDTH = 36;

export type DrawToolMode = 'brush' | 'eraser';

export function emptyDrawingDocument(): DrawingDocument {
  return { version: 1, strokes: [] };
}

export function parseDrawingData(raw?: string): DrawingDocument {
  if (!raw) return emptyDrawingDocument();
  if (raw.startsWith('data:')) return emptyDrawingDocument();

  try {
    const parsed = JSON.parse(raw) as Partial<DrawingDocument>;
    if (parsed.version !== 1 || !Array.isArray(parsed.strokes)) {
      return emptyDrawingDocument();
    }

    const strokes = parsed.strokes
      .filter(
        (stroke): stroke is DrawingStroke =>
          !!stroke &&
          typeof stroke === 'object' &&
          typeof stroke.id === 'string' &&
          typeof stroke.color === 'string' &&
          typeof stroke.width === 'number' &&
          Array.isArray(stroke.points)
      )
      .map((stroke) => ({
        id: stroke.id,
        color: stroke.color,
        width: stroke.width,
        points: stroke.points.filter(
          (point): point is DrawingPoint =>
            !!point &&
            typeof point === 'object' &&
            typeof point.x === 'number' &&
            typeof point.y === 'number'
        ),
      }))
      .filter((stroke) => stroke.points.length > 0);

    return { version: 1, strokes };
  } catch {
    return emptyDrawingDocument();
  }
}

export function serializeDrawingData(document: DrawingDocument): string {
  return JSON.stringify(document);
}

export function clientToWorldPoint(
  clientX: number,
  clientY: number,
  worldEl: HTMLElement,
  zoom: number
): DrawingPoint {
  const rect = worldEl.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / zoom,
    y: (clientY - rect.top) / zoom,
  };
}

function distanceBetween(a: DrawingPoint, b: DrawingPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distancePointToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);

  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.hypot(px - projX, py - projY);
}

function eraserHitsStroke(
  eraserPoints: DrawingPoint[],
  eraserRadius: number,
  stroke: DrawingStroke
): boolean {
  const hitRadius = eraserRadius + stroke.width / 2;

  for (const eraserPoint of eraserPoints) {
    for (const strokePoint of stroke.points) {
      if (distanceBetween(eraserPoint, strokePoint) <= hitRadius) return true;
    }
  }

  for (let i = 0; i < eraserPoints.length - 1; i++) {
    const a = eraserPoints[i];
    const b = eraserPoints[i + 1];
    for (const strokePoint of stroke.points) {
      if (distancePointToSegment(strokePoint.x, strokePoint.y, a.x, a.y, b.x, b.y) <= hitRadius) {
        return true;
      }
    }
  }

  for (let i = 0; i < stroke.points.length - 1; i++) {
    const a = stroke.points[i];
    const b = stroke.points[i + 1];
    for (const eraserPoint of eraserPoints) {
      if (distancePointToSegment(eraserPoint.x, eraserPoint.y, a.x, a.y, b.x, b.y) <= hitRadius) {
        return true;
      }
    }
  }

  return false;
}

/** Remove any stroke touched by the eraser path. */
export function eraseStrokesAlongPath(
  strokes: DrawingStroke[],
  eraserPoints: DrawingPoint[],
  eraserWidth: number
): DrawingStroke[] {
  if (eraserPoints.length === 0) return strokes;

  const radius = eraserWidth / 2;
  const points =
    eraserPoints.length === 1
      ? [eraserPoints[0], { x: eraserPoints[0].x + 0.01, y: eraserPoints[0].y }]
      : eraserPoints;

  return strokes.filter((stroke) => !eraserHitsStroke(points, radius, stroke));
}

export interface WorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function normalizeRect(x1: number, y1: number, x2: number, y2: number): WorldRect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

export function rectsIntersect(a: WorldRect, b: WorldRect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

function pointInRect(point: DrawingPoint, rect: WorldRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function segmentsIntersect(
  a1: DrawingPoint,
  a2: DrawingPoint,
  b1: DrawingPoint,
  b2: DrawingPoint
): boolean {
  const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
  if (d === 0) return false;
  const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
  const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function segmentIntersectsRect(a: DrawingPoint, b: DrawingPoint, rect: WorldRect): boolean {
  if (pointInRect(a, rect) || pointInRect(b, rect)) return true;
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  const corners: DrawingPoint[] = [
    { x: rect.x, y: rect.y },
    { x: x2, y: rect.y },
    { x: x2, y: y2 },
    { x: rect.x, y: y2 },
  ];
  return (
    segmentsIntersect(a, b, corners[0], corners[1]) ||
    segmentsIntersect(a, b, corners[1], corners[2]) ||
    segmentsIntersect(a, b, corners[2], corners[3]) ||
    segmentsIntersect(a, b, corners[3], corners[0])
  );
}

export function strokeBounds(stroke: DrawingStroke): WorldRect | null {
  if (stroke.points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of stroke.points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const pad = stroke.width / 2;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

export function unionRects(rects: WorldRect[]): WorldRect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function strokeIntersectsRect(stroke: DrawingStroke, rect: WorldRect): boolean {
  const bounds = strokeBounds(stroke);
  if (!bounds || !rectsIntersect(bounds, rect)) return false;
  if (stroke.points.some((point) => pointInRect(point, rect))) return true;
  for (let i = 0; i < stroke.points.length - 1; i++) {
    if (segmentIntersectsRect(stroke.points[i], stroke.points[i + 1], rect)) return true;
  }
  return false;
}

export function strokeHitsPoint(
  stroke: DrawingStroke,
  point: DrawingPoint,
  extraTolerance = 10
): boolean {
  const hit = stroke.width / 2 + extraTolerance;
  if (stroke.points.length === 1) {
    return distanceBetween(stroke.points[0], point) <= hit;
  }
  for (let i = 0; i < stroke.points.length - 1; i++) {
    const a = stroke.points[i];
    const b = stroke.points[i + 1];
    if (distancePointToSegment(point.x, point.y, a.x, a.y, b.x, b.y) <= hit) return true;
  }
  return false;
}

export function findStrokeAtPoint(
  strokes: DrawingStroke[],
  point: DrawingPoint,
  extraTolerance?: number
): DrawingStroke | null {
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (strokeHitsPoint(strokes[i], point, extraTolerance)) return strokes[i];
  }
  return null;
}

export function translateStrokes(
  strokes: DrawingStroke[],
  ids: Iterable<string>,
  dx: number,
  dy: number
): DrawingStroke[] {
  const selected = new Set(ids);
  if (selected.size === 0 || (dx === 0 && dy === 0)) return strokes;
  return strokes.map((stroke) =>
    selected.has(stroke.id)
      ? { ...stroke, points: stroke.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) }
      : stroke
  );
}

export function removeStrokesById(strokes: DrawingStroke[], ids: Iterable<string>): DrawingStroke[] {
  const selected = new Set(ids);
  if (selected.size === 0) return strokes;
  return strokes.filter((stroke) => !selected.has(stroke.id));
}
