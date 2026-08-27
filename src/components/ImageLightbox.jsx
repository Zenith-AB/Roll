import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const DOUBLE_TAP_MS = 320;
const TAP_SLOP = 12;

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Full-screen viewer for a figure.
 *
 * A figure in a PDF is often a dense chart whose labels are unreadable at the
 * width of a phone, so being able to zoom into it is not a flourish — it is the
 * only way the figure is usable at all on the platform most of this app's
 * reading happens on.
 *
 * Everything runs on Pointer Events, which is the one input model Android
 * Chrome, iOS Safari and desktop browsers all agree on: the same two handlers
 * give pinch-zoom from two fingers, drag-to-pan from one finger or the mouse,
 * and double-tap/double-click to toggle. The transform is written straight to
 * the node rather than through React state, so a pinch stays smooth instead of
 * re-rendering on every move event.
 */
export default function ImageLightbox({ figure, onClose }) {
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const tap = useRef({ time: 0, x: 0, y: 0, moved: false });
  const [zoomed, setZoomed] = useState(false);

  const apply = useCallback(() => {
    const el = imgRef.current;
    if (!el) return;
    const { scale, x, y } = view.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
    setZoomed(scale > 1.02);
  }, []);

  // Keeps the picture inside its stage: at 1× it stays centred, and zoomed in
  // it can only be dragged as far as its own edges. Without this a flick sends
  // the figure off-screen and the reader is left staring at a black rectangle.
  const clampView = useCallback(() => {
    const el = imgRef.current;
    const stage = stageRef.current;
    if (!el || !stage) return;

    const v = view.current;
    v.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale));

    const rect = stage.getBoundingClientRect();
    const maxX = Math.max(0, (el.offsetWidth * v.scale - rect.width) / 2);
    const maxY = Math.max(0, (el.offsetHeight * v.scale - rect.height) / 2);
    v.x = Math.min(maxX, Math.max(-maxX, v.x));
    v.y = Math.min(maxY, Math.max(-maxY, v.y));
  }, []);

  // Zooms around a point on screen, so the detail under the fingers (or the
  // cursor) is the detail that stays put.
  const zoomAt = useCallback(
    (clientX, clientY, nextScale) => {
      const stage = stageRef.current;
      if (!stage) return;
      const v = view.current;
      const target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale));
      if (target === v.scale) return;

      const rect = stage.getBoundingClientRect();
      const offsetX = clientX - rect.left - rect.width / 2 - v.x;
      const offsetY = clientY - rect.top - rect.height / 2 - v.y;
      const ratio = target / v.scale;

      v.x -= offsetX * (ratio - 1);
      v.y -= offsetY * (ratio - 1);
      v.scale = target;

      clampView();
      apply();
    },
    [apply, clampView]
  );

  const reset = useCallback(() => {
    view.current = { scale: 1, x: 0, y: 0 };
    apply();
  }, [apply]);

  const handlePointerDown = useCallback((e) => {
    const stage = stageRef.current;
    try {
      stage?.setPointerCapture?.(e.pointerId);
    } catch {
      /* Safari refuses capture for some pointer types; panning still works */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: distance(a, b) || 1, scale: view.current.scale };
    } else {
      tap.current = { time: Date.now(), x: e.clientX, y: e.clientY, moved: false };
    }
  }, []);

  const handlePointerMove = useCallback(
    (e) => {
      const previous = pointers.current.get(e.pointerId);
      if (!previous) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > TAP_SLOP) {
        tap.current.moved = true;
      }

      if (pointers.current.size >= 2 && pinch.current) {
        const [a, b] = [...pointers.current.values()];
        const spread = distance(a, b);
        if (!spread) return;
        const centre = midpoint(a, b);
        zoomAt(centre.x, centre.y, pinch.current.scale * (spread / pinch.current.distance));
        return;
      }

      if (view.current.scale <= 1.02) return; // nothing to pan at full fit
      view.current.x += e.clientX - previous.x;
      view.current.y += e.clientY - previous.y;
      clampView();
      apply();
    },
    [apply, clampView, zoomAt]
  );

  const handlePointerUp = useCallback(
    (e) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;

      if (pointers.current.size === 0 && !tap.current.moved) {
        const now = Date.now();
        const isDoubleTap =
          now - tap.current.time < DOUBLE_TAP_MS &&
          tap.current.previous != null &&
          now - tap.current.previous < DOUBLE_TAP_MS * 2;

        if (isDoubleTap) {
          tap.current.previous = null;
          if (view.current.scale > 1.02) reset();
          else zoomAt(e.clientX, e.clientY, 2.6);
          return;
        }
        tap.current.previous = now;
      }

      if (pointers.current.size === 0 && view.current.scale <= 1.02) reset();
    },
    [reset, zoomAt]
  );

  // Wheel/trackpad zoom, plus the two things a browser would otherwise do for
  // us and get wrong: scroll the page behind the overlay, and (on Safari) run
  // its own page-level pinch gesture on top of ours.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const onWheel = (e) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, view.current.scale * (e.deltaY > 0 ? 0.88 : 1.14));
    };
    const swallow = (e) => e.preventDefault();

    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('gesturestart', swallow);
    stage.addEventListener('gesturechange', swallow);
    stage.addEventListener('gestureend', swallow);

    return () => {
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('gesturestart', swallow);
      stage.removeEventListener('gesturechange', swallow);
      stage.removeEventListener('gestureend', swallow);
    };
  }, [zoomAt]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoomAt(window.innerWidth / 2, window.innerHeight / 2, view.current.scale * 1.3);
      else if (e.key === '-') zoomAt(window.innerWidth / 2, window.innerHeight / 2, view.current.scale / 1.3);
      else if (e.key === '0') reset();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, reset, zoomAt]);

  if (!figure?.image?.url) return null;

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={figure.caption || 'Figura'}>
      <button className="lightbox-close" onClick={onClose} aria-label="Cerrar">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>

      <div
        ref={stageRef}
        className={`lightbox-stage ${zoomed ? 'is-zoomed' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={(e) => {
          // Tapping the darkness closes; tapping the figure never should.
          if (e.target === e.currentTarget && !zoomed) onClose();
        }}
      >
        <img
          ref={imgRef}
          className="lightbox-img"
          src={figure.image.url}
          alt={figure.caption || 'Figura del documento'}
          draggable="false"
        />
      </div>

      <div className="lightbox-bar">
        {figure.caption ? (
          <p className="lightbox-caption">{figure.caption}</p>
        ) : (
          <p className="lightbox-caption lightbox-caption--muted">Página {figure.page}</p>
        )}
        <p className="lightbox-hint">
          {zoomed ? 'Arrastra para mover · doble toque para ajustar' : 'Pellizca o doble toque para acercar'}
        </p>
      </div>
    </div>
  );
}
