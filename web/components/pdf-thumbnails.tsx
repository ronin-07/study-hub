'use client';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

const rowHeight = 106;

function Thumbnail({ pdf, number, onRendered }: {
  pdf: PDFDocumentProxy; number: number; onRendered: (number: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let stopped = false;
    let task: RenderTask | undefined;
    void pdf.getPage(number).then(async page => {
      if (stopped) return;
      try {
        const source = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(72 / source.width, 69 / source.height) });
        const ratio = Math.min(window.devicePixelRatio, 2);
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        task = page.render({ canvas, viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        await task.promise;
        if (!stopped) setReady(true);
      } finally {
        onRendered(number);
      }
    }).catch(() => {});
    return () => {
      stopped = true;
      task?.cancel();
      canvas.width = canvas.height = 0;
    };
  }, [pdf, number, onRendered]);
  return <canvas ref={canvasRef} aria-hidden="true" className={ready ? 'is-ready' : undefined}/>;
}

export function PdfThumbnails({ pdf, current, onPage, onRendered }: {
  pdf: PDFDocumentProxy; current: number; onPage: (page: number) => void; onRendered: (page: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState({ first: 0, last: 0 });
  const [focused, setFocused] = useState<number | null>(null);
  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    function update() {
      if (!list) return;
      setVisible({
        first: Math.max(0, Math.floor(list.scrollTop / rowHeight) - 2),
        last: Math.min(pdf.numPages, Math.ceil((list.scrollTop + list.clientHeight) / rowHeight) + 2),
      });
    }
    list.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(list);
    update();
    return () => { observer.disconnect(); list.removeEventListener('scroll', update); };
  }, [pdf]);
  useEffect(() => {
    const list = ref.current;
    if (!list) return;
    const top = (current - 1) * rowHeight;
    if (top < list.scrollTop || top + rowHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - Math.floor(list.clientHeight / 3));
    }
  }, [current]);
  const pages = Array.from({ length: visible.last - visible.first }, (_, index) => visible.first + index + 1);
  if (focused !== null && !pages.includes(focused)) pages.push(focused);

  return <div ref={ref} className="pdfjs-thumbnails" role="region" aria-label="Page thumbnails">
    <div style={{ height: pdf.numPages * rowHeight }} className="pdfjs-thumbnail-list">
      {pages.map(number => <button key={number} type="button" className="btn secondary small pdfjs-thumbnail"
        style={{ top: (number - 1) * rowHeight }} aria-label={`Go to page ${number}`}
        aria-current={current === number ? 'page' : undefined} onClick={() => onPage(number)}
        onFocus={() => setFocused(number)} onBlur={() => setFocused(null)}>
        <span className="pdfjs-thumbnail-paper"><Thumbnail pdf={pdf} number={number} onRendered={onRendered}/></span>
        <span>{number}</span>
      </button>)}
    </div>
  </div>;
}
