'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, ListTree, LoaderCircle, Minus, PanelLeft, Plus, Search } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import type { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { PdfPageMark } from '@/lib/types';
import { maxPdfPage, safePdfLink, type PdfMarkChange, type StudyPdf } from '@/lib/pdf-study';
import 'pdfjs-dist/web/pdf_viewer.css';
import './pdf-reader.css';
import { PdfThumbnails } from './pdf-thumbnails';
import { PdfOutline, type PdfDestination } from './pdf-outline';
import { PdfMarks } from './pdf-marks';

type Props = {
  url: string;
  title: string;
  initialPage: number;
  marks: PdfPageMark[];
  marksStatus: StudyPdf['marksStatus'];
  onLoadMarks: () => void;
  autoFocus?: boolean;
  onPage: (page: number) => void;
  onMark: (change: PdfMarkChange) => Promise<void>;
  onFailure: () => void;
};
type ViewerRuntime = { events: EventBus; viewer: PDFViewer; links: PDFLinkService };
type Matches = { current: number; total: number };
const assets = '/pdfjs/';

export function PdfReader({ url, title, initialPage, marks, marksStatus, onLoadMarks, autoFocus = true, onPage, onMark, onFailure }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const pageSurface = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const runtime = useRef<ViewerRuntime | null>(null);
  const startPage = useRef(initialPage);
  const focusAtOpen = useRef(autoFocus);
  const lastReportedPage = useRef(initialPage);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(initialPage);
  const [draft, setDraft] = useState(String(initialPage));
  const [scale, setScale] = useState('page-width');
  const [scalePercent, setScalePercent] = useState(100);
  const [panel, setPanel] = useState<'pages' | 'outline' | 'marks' | null>(null);
  const [query, setQuery] = useState('');
  const [findStatus, setFindStatus] = useState('');
  const [matches, setMatches] = useState<Matches>({ current: 0, total: 0 });
  const [firstPaint, setFirstPaint] = useState(false);

  useEffect(() => {
    const scrolling = container.current;
    const surface = pageSurface.current;
    if (!scrolling || !surface) return;
    const lifetime = new AbortController();
    const { signal } = lifetime;
    let task: PDFDocumentLoadingTask | undefined;
    let viewer: PDFViewer | undefined;
    let painted = false;
    const fallback = () => { if (!signal.aborted) onFailure(); };
    const timer = window.setTimeout(fallback, 25000);
    if (focusAtOpen.current) scrolling.focus({ preventScroll: true });

    async function load() {
      // The viewer loads after the API module initializes its shared browser runtime.
      const engine = await import('pdfjs-dist');
      const { EventBus, FindState, LinkTarget, PDFFindController, PDFLinkService, PDFViewer } = await import('pdfjs-dist/web/pdf_viewer.mjs');
      if (!scrolling || !surface || signal.aborted) return;
      const assetUrl = new URL(assets, window.location.href);
      engine.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', assetUrl).href;
      const events = new EventBus();
      const links = new PDFLinkService({ eventBus: events, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' });
      const linkAttributes = links.addLinkAttributes.bind(links);
      links.addLinkAttributes = (link, url, newWindow) => {
        if (safePdfLink(url)) linkAttributes(link, url, newWindow);
        else link.setAttribute('aria-disabled', 'true');
      };
      const finder = new PDFFindController({ eventBus: events, linkService: links });
      const options = {
        container: scrolling, viewer: surface, eventBus: events, linkService: links, findController: finder,
        imageResourcesPath: new URL('images/', assetUrl).href,
        annotationMode: engine.AnnotationMode.ENABLE,
        annotationEditorMode: engine.AnnotationEditorType.DISABLE,
        enablePermissions: true, enableAutoLinking: false,
        maxCanvasPixels: 8 * 1024 * 1024, maxCanvasDim: 4096,
        abortSignal: signal,
      };
      const activeViewer = new PDFViewer(options);
      viewer = activeViewer;
      links.setViewer(activeViewer);
      runtime.current = { events, viewer: activeViewer, links };
      events.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
        setPage(pageNumber);
        setDraft(String(pageNumber));
      }, { signal });
      events.on('scalechanging', ({ scale, presetValue }: { scale: number; presetValue?: string }) => {
        setScalePercent(Math.round(scale * 100));
        setScale(presetValue || String(scale));
      }, { signal });
      events.on('pagesinit', () => {
        activeViewer.currentScaleValue = 'page-width';
        const target = Math.min(activeViewer.pagesCount, Math.max(1, startPage.current));
        activeViewer.currentPageNumber = target;
        setPage(target);
        setDraft(String(target));
      }, { signal });
      events.on('pagerendered', ({ pageNumber, cssTransform, error }: { pageNumber: number; cssTransform: boolean; error: unknown }) => {
        if (pageNumber !== activeViewer.currentPageNumber || cssTransform) return;
        if (error) { fallback(); return; }
        if (!painted) {
          painted = true;
          window.clearTimeout(timer);
          setFirstPaint(true);
        }
      }, { signal });
      events.on('updatefindmatchescount', ({ matchesCount }: { matchesCount: Matches }) => {
        setMatches(matchesCount);
      }, { signal });
      events.on('updatefindcontrolstate', ({ state, matchesCount }: { state: number; matchesCount: Matches }) => {
        setMatches(matchesCount);
        setFindStatus(state === FindState.PENDING ? 'Searching…' : state === FindState.NOT_FOUND ? 'No matches' : '');
      }, { signal });

      // The blob URL belongs to the already authorized open in Study Mode.
      const response = await fetch(url, { signal });
      const data = await response.arrayBuffer();
      if (signal.aborted) return;
      task = engine.getDocument({
        data,
        cMapUrl: new URL('cmaps/', assetUrl).href,
        iccUrl: new URL('iccs/', assetUrl).href,
        standardFontDataUrl: new URL('standard_fonts/', assetUrl).href,
        wasmUrl: new URL('wasm/', assetUrl).href,
        enableXfa: false,
      });
      task.onPassword = fallback;
      const document = await task.promise;
      if (signal.aborted) return;
      links.setDocument(document);
      activeViewer.setDocument(document);
      setPdf(document);
    }
    void load().catch(fallback);
    return () => {
      window.clearTimeout(timer);
      lifetime.abort();
      runtime.current = null;
      viewer?.setDocument(null);
      void viewer?.l10n?.destroy().catch(() => {});
      if (task) void task.destroy().catch(() => {});
    };
  }, [url, onFailure]);

  useEffect(() => {
    if (firstPaint && page <= maxPdfPage && lastReportedPage.current !== page) {
      lastReportedPage.current = page;
      onPage(page);
    }
  }, [firstPaint, onPage, page]);

  const go = useCallback((number: number) => {
    const viewer = runtime.current?.viewer;
    if (!viewer?.pagesCount) return;
    const target = Math.max(1, Math.min(viewer.pagesCount, Math.floor(number)));
    viewer.currentPageNumber = target;
    setDraft(String(target));
  }, []);
  const finishThumbnail = useCallback((pageNumber: number) => {
    const active = runtime.current;
    if (!active) return;
    const view = active.viewer.getPageView(pageNumber - 1);
    if (view?.pdfPage && !active.viewer.getCachedPageViews().has(view)) view.pdfPage.cleanup();
  }, []);
  const jumpToOutline = useCallback((destination: PdfDestination) => {
    void runtime.current?.links.goToDestination(destination).catch(() => {});
  }, []);

  function find(previous = false) {
    const term = query.trim();
    if (!term) return;
    runtime.current?.events.dispatch('find', {
      source: searchInput.current, type: 'again', query: term, highlightAll: true,
      caseSensitive: false, entireWord: false, findPrevious: previous, matchDiacritics: false,
    });
  }

  function changeZoom(direction: -1 | 1) {
    const viewer = runtime.current?.viewer;
    if (!viewer?.pagesCount) return;
    const next = viewer.currentScale * (direction > 0 ? 1.2 : 1 / 1.2);
    viewer.currentScaleValue = String(Number(Math.max(.25, Math.min(4, next)).toFixed(2)));
  }

  function shortcuts(event: KeyboardEvent<HTMLElement>) {
    const command = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (command && key === 'f') {
      event.preventDefault();
      searchInput.current?.focus();
      searchInput.current?.select();
    } else if (firstPaint && command && ['=', '+', '-', '0'].includes(key)) {
      event.preventDefault();
      if (key === '0' && runtime.current) runtime.current.viewer.currentScaleValue = 'page-width';
      else changeZoom(key === '-' ? -1 : 1);
    } else if (firstPaint && event.target === container.current && !command && (key === 'arrowleft' || key === 'arrowright')) {
      event.preventDefault();
      go(page + (key === 'arrowright' ? 1 : -1));
    }
  }

  return <section className="pdfjs-reader" aria-label={autoFocus ? 'PDF.js reader' : `PDF.js reader for ${title}`} onKeyDown={shortcuts}>
    <div className="pdfjs-toolbar" aria-label="PDF controls">
      <button type="button" className="btn secondary small" disabled={!firstPaint} aria-expanded={panel === 'pages'} onClick={() => setPanel(value => value === 'pages' ? null : 'pages')}>
        <PanelLeft size={15} aria-hidden="true"/> Pages
      </button>
      <button type="button" className="btn secondary small" disabled={!firstPaint} aria-expanded={panel === 'outline'} onClick={() => setPanel(value => value === 'outline' ? null : 'outline')}>
        <ListTree size={15} aria-hidden="true"/> Outline
      </button>
      <button type="button" className="btn secondary small" disabled={!firstPaint} aria-expanded={panel === 'marks'} onClick={() => {
        setPanel(panel === 'marks' ? null : 'marks');
        if (panel !== 'marks' && marksStatus === 'idle') onLoadMarks();
      }}>
        <Bookmark size={15} aria-hidden="true"/> Bookmarks &amp; notes
      </button>
      <form className="pdfjs-page-controls" aria-label="Page navigation" onSubmit={event => {
        event.preventDefault();
        const value = Number(draft);
        if (draft.trim() && Number.isFinite(value)) go(value);
        else setDraft(String(page));
      }}>
        <button type="button" className="btn secondary small" aria-label="Previous page" disabled={!firstPaint || page <= 1} onClick={() => go(page - 1)}><ChevronLeft size={15}/></button>
        <input aria-label="Current PDF page" type="text" inputMode="numeric" disabled={!firstPaint} value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => setDraft(String(page))}/>
        <span aria-label={pdf ? `of ${pdf.numPages} pages` : undefined}>/ {pdf?.numPages ?? '–'}</span>
        <button type="button" className="btn secondary small" aria-label="Next page" disabled={!firstPaint || page >= (pdf?.numPages ?? 0)} onClick={() => go(page + 1)}><ChevronRight size={15}/></button>
      </form>
      <div className="pdfjs-zoom" role="group" aria-label="PDF zoom">
        <button type="button" className="btn secondary small" aria-label="Zoom out" disabled={!firstPaint || scalePercent <= 25} onClick={() => changeZoom(-1)}><Minus size={14}/></button>
        <select aria-label="Zoom level" value={scale} disabled={!firstPaint} onChange={event => { if (runtime.current) runtime.current.viewer.currentScaleValue = event.target.value; }}>
          <option value="page-width">Fit width</option><option value="page-fit">Fit page</option><option value="1">100%</option>
          {!['page-width', 'page-fit', '1'].includes(scale) && <option value={scale}>{scalePercent}%</option>}
        </select>
        <button type="button" className="btn secondary small" aria-label="Zoom in" disabled={!firstPaint || scalePercent >= 400} onClick={() => changeZoom(1)}><Plus size={14}/></button>
      </div>
      <form className="pdfjs-find" role="search" aria-label="Find in PDF" onSubmit={event => { event.preventDefault(); find(); }}>
        <input ref={searchInput} type="search" aria-label="Find in PDF" placeholder="Find in PDF" value={query} disabled={!firstPaint}
          onChange={event => {
            runtime.current?.events.dispatch('findbarclose', { source: searchInput.current });
            setQuery(event.target.value);
            setFindStatus('');
            setMatches({ current: 0, total: 0 });
          }}
          onKeyDown={event => { if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); find(true); } }}/>
        <button type="button" className="btn secondary small" aria-label="Previous match" disabled={!firstPaint || !query.trim()} onClick={() => find(true)}><ChevronLeft size={15}/></button>
        <button type="submit" className="btn secondary small" aria-label="Find next match" disabled={!firstPaint || !query.trim()}><Search size={15}/></button>
        <output aria-live="polite">{findStatus || (matches.total ? `${matches.current} / ${matches.total}` : '')}</output>
      </form>
    </div>
    <div className="pdfjs-stage">
      {pdf && panel === 'pages' && <PdfThumbnails pdf={pdf} current={page} onPage={go} onRendered={finishThumbnail}/>}
      {pdf && panel === 'outline' && <PdfOutline pdf={pdf} onJump={jumpToOutline}/>}
      {pdf && panel === 'marks' && (marksStatus === 'ready'
        ? <PdfMarks page={page} pages={pdf.numPages} marks={marks} onJump={go} onChange={onMark}/>
        : <aside className="pdfjs-marks" aria-label="Bookmarks and page notes">
          {marksStatus === 'error' ? <><p role="alert">Couldn’t load bookmarks and notes.</p>
            <button type="button" className="btn secondary small" onClick={onLoadMarks}>Retry</button></>
            : <p role="status">Loading bookmarks and notes…</p>}
        </aside>)}
      <div className="pdfjs-document">
        <div className="pdfjs-scroll" aria-label={`${title}, page ${page}`} tabIndex={0} ref={container}><div className="pdfViewer" ref={pageSurface}/></div>
        {!firstPaint && <div className="pdf-frame-loading pdfjs-loading" role="status">
          <LoaderCircle size={25} className="spin" aria-hidden="true"/><strong>Preparing the PDF.js reader…</strong>
        </div>}
      </div>
    </div>
  </section>;
}
