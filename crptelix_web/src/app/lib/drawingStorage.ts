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
