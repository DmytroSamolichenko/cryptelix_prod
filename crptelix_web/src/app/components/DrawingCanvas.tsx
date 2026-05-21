import { useRef, useEffect, useState } from 'react';

interface DrawingCanvasProps {
  isActive: boolean;
  /** Viewport element (visible scroll area), not the full world surface */
  viewportRef?: React.RefObject<HTMLDivElement | null>;
}

export function DrawingCanvas({ isActive, viewportRef }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [context, setContext] = useState<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const updateCanvasSize = () => {
      const parent = viewportRef?.current ?? canvas.parentElement;
      if (!parent) return;

      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (w <= 0 || h <= 0) return;

      const imageData =
        canvas.width > 0 && canvas.height > 0
          ? ctx.getImageData(0, 0, canvas.width, canvas.height)
          : null;

      canvas.width = w;
      canvas.height = h;

      if (imageData) {
        ctx.putImageData(imageData, 0, 0);
      }
    };

    updateCanvasSize();
    const parent = viewportRef?.current ?? canvas.parentElement;
    const ro = parent ? new ResizeObserver(updateCanvasSize) : null;
    ro?.observe(parent);
    window.addEventListener('resize', updateCanvasSize);

    // Configure drawing settings for white brush
    ctx.strokeStyle = '#ffffff'; // White color
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'source-over'; // Paint mode

    setContext(ctx);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, [viewportRef]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!context || !isActive) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    setIsDrawing(true);
    context.beginPath();
    context.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !context || !isActive) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    context.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    context.stroke();
  };

  const stopDrawing = () => {
    if (!context) return;
    setIsDrawing(false);
    context.closePath();
  };

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={startDrawing}
      onMouseMove={draw}
      onMouseUp={stopDrawing}
      onMouseLeave={stopDrawing}
      className="pointer-events-none absolute inset-0 z-40"
      style={{ pointerEvents: isActive ? 'auto' : 'none', cursor: isActive ? 'crosshair' : 'default' }}
    />
  );
}