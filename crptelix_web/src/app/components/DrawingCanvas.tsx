import { useRef, useEffect, useState } from 'react';

interface DrawingCanvasProps {
  isActive: boolean;
}

export function DrawingCanvas({ isActive }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [context, setContext] = useState<CanvasRenderingContext2D | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to match container
    const updateCanvasSize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      
      // Store the current canvas content before resizing
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      canvas.width = parent.offsetWidth;
      canvas.height = parent.offsetHeight;
      
      // Restore the previous content after resizing
      ctx.putImageData(imageData, 0, 0);
    };

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);

    // Configure drawing settings for white brush
    ctx.strokeStyle = '#ffffff'; // White color
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalCompositeOperation = 'source-over'; // Paint mode

    setContext(ctx);

    return () => {
      window.removeEventListener('resize', updateCanvasSize);
    };
  }, []);

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
      className="absolute inset-0 z-40 cursor-crosshair"
      style={{ pointerEvents: isActive ? 'auto' : 'none' }}
    />
  );
}