import * as pdfjsLib from '/pdfjs/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.mjs';

const PAGE_MARGIN = 12;
const MIN_SCALE = 0.4;
const MAX_SCALE = 4.0;

export function createPdfViewer(rootEl) {
  const toolbar = document.createElement('div');
  toolbar.className = 'pdf-toolbar';
  const zoomOutBtn = document.createElement('button');
  zoomOutBtn.textContent = '−';
  zoomOutBtn.title = 'Zoom out';
  const zoomLabel = document.createElement('span');
  zoomLabel.textContent = '100%';
  const zoomInBtn = document.createElement('button');
  zoomInBtn.textContent = '+';
  zoomInBtn.title = 'Zoom in';
  const fitBtn = document.createElement('button');
  fitBtn.textContent = 'Fit';
  fitBtn.title = 'Fit to width';
  toolbar.append(zoomOutBtn, zoomLabel, zoomInBtn, fitBtn);

  const scrollEl = document.createElement('div');
  scrollEl.className = 'pdf-scroll';

  rootEl.prepend(toolbar);
  rootEl.prepend(scrollEl);

  let pdfDoc = null;
  let loadingTask = null;
  let fitScale = 1;
  let scale = 1;
  let destroyed = false;
  let renderTasks = [];
  let renderRun = 0; // increments to abort stale renderAllPages loops
  let wheelTimer = null;
  let pendingWheelZoom = 0;

  function updateLabel() {
    zoomLabel.textContent = `${Math.round((scale / fitScale) * 100)}%`;
  }

  async function renderAllPages() {
    const run = ++renderRun;
    renderTasks.forEach((t) => t.cancel());
    renderTasks = [];
    scrollEl.replaceChildren();
    if (!pdfDoc) return;

    const dpr = window.devicePixelRatio || 1;
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      if (destroyed || run !== renderRun) return;
      const page = await pdfDoc.getPage(n);
      if (destroyed || run !== renderRun) return;
      const viewport = page.getViewport({ scale });

      const pageEl = document.createElement('div');
      pageEl.className = 'pdf-page';
      pageEl.style.width = `${viewport.width}px`;
      pageEl.style.height = `${viewport.height}px`;

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      pageEl.appendChild(canvas);

      const linkLayer = document.createElement('div');
      linkLayer.className = 'link-layer';
      pageEl.appendChild(linkLayer);

      scrollEl.appendChild(pageEl);

      const task = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      renderTasks.push(task);
      try {
        await task.promise;
      } catch (err) {
        if (err && err.name === 'RenderingCancelledException') return;
        throw err;
      }

      const annotations = await page.getAnnotations();
      if (destroyed || run !== renderRun) return;
      for (const a of annotations) {
        if (a.subtype !== 'Link' || !a.url) continue;
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
        const link = document.createElement('a');
        link.href = a.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = a.url;
        link.style.left = `${Math.min(x1, x2)}px`;
        link.style.top = `${Math.min(y1, y2)}px`;
        link.style.width = `${Math.abs(x2 - x1)}px`;
        link.style.height = `${Math.abs(y2 - y1)}px`;
        linkLayer.appendChild(link);
      }
    }
  }

  function rerenderKeepingScroll() {
    const ratio = scrollEl.scrollHeight > 0 ? scrollEl.scrollTop / scrollEl.scrollHeight : 0;
    updateLabel();
    renderAllPages().then(() => {
      scrollEl.scrollTop = ratio * scrollEl.scrollHeight;
    });
  }

  function setScale(next) {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    if (clamped === scale) return;
    scale = clamped;
    rerenderKeepingScroll();
  }

  function zoomIn() {
    setScale(scale * 1.25);
  }

  function zoomOut() {
    setScale(scale * 0.8);
  }

  function fitWidth() {
    if (!pdfDoc) return;
    pdfDoc.getPage(1).then((page) => {
      if (destroyed) return;
      const w = page.getViewport({ scale: 1 }).width;
      fitScale = Math.max(0.1, (scrollEl.clientWidth - 2 * PAGE_MARGIN) / w);
      setScale(fitScale);
      updateLabel();
    });
  }

  function onWheel(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    pendingWheelZoom += e.deltaY < 0 ? 1 : -1;
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      const steps = pendingWheelZoom;
      pendingWheelZoom = 0;
      if (steps !== 0) setScale(scale * Math.pow(1.25, steps));
    }, 80);
  }

  zoomInBtn.addEventListener('click', zoomIn);
  zoomOutBtn.addEventListener('click', zoomOut);
  fitBtn.addEventListener('click', fitWidth);
  scrollEl.addEventListener('wheel', onWheel, { passive: false });

  return {
    async load(buffer) {
      loadingTask = pdfjsLib.getDocument({ data: buffer });
      pdfDoc = await loadingTask.promise;
      if (destroyed) return;
      const page = await pdfDoc.getPage(1);
      if (destroyed) return;
      const w = page.getViewport({ scale: 1 }).width;
      fitScale = Math.max(0.1, (scrollEl.clientWidth - 2 * PAGE_MARGIN) / w);
      scale = fitScale;
      updateLabel();
      await renderAllPages();
    },
    zoomIn,
    zoomOut,
    fitWidth,
    destroy() {
      destroyed = true;
      renderRun++;
      renderTasks.forEach((t) => t.cancel());
      renderTasks = [];
      clearTimeout(wheelTimer);
      scrollEl.removeEventListener('wheel', onWheel);
      if (loadingTask) loadingTask.destroy().catch(() => {});
      pdfDoc = null;
      toolbar.remove();
      scrollEl.remove();
    },
  };
}
