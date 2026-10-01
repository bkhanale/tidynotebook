/**
 * The image viewer of a note (record 0145).
 *
 * A press on a picture of the note opens it here, in the one dialog of
 * `@notesapp/ui`. The picture fits the screen first. The zoom buttons, the
 * `+`, `-` and `0` keys, and the wheel with Ctrl or Cmd held zoom it, and a
 * drag with the mouse moves a zoomed picture. The actions are the ones the
 * page can do with that picture: a picture of the workspace is copied and
 * downloaded, and a picture of another host gives its link and its original.
 *
 * `lib/image-viewer.ts` holds every rule of that. This module turns the rules
 * into elements and browser calls, and it reads the bytes only from the blob
 * address the editor already shows, so it starts no request of its own.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { ImageOpenRequest } from '@notesapp/editor';
import {
  Button,
  buttonClassName,
  CloseIcon,
  CopyIcon,
  Dialog,
  DownloadIcon,
  ExternalLinkIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from '@notesapp/ui';
import {
  fitZoom,
  imageActionLabels,
  imageActionMessages,
  imageActions,
  imageDownloadName,
  imageTitle,
  wheelZoom,
  zoomIn,
  zoomKey,
  zoomLimits,
  zoomOut,
  zoomPercent,
  zoomedSize,
  type ImageAction,
  type ImageSize,
} from '../../lib/image-viewer.ts';
import { copyPngImage, copyText } from '../../platform.ts';

/** The viewer of one picture, or nothing while no picture is open. */
export function ImageViewer({
  image,
  onClose,
}: {
  readonly image: ImageOpenRequest | null;
  readonly onClose: () => void;
}): ReactNode {
  const titleId = useId();
  // The viewer draws its own title row, so the name of the picture and Close
  // share one line at every width. The dialog keeps the heading for
  // assistive software.
  return (
    <Dialog
      open={image !== null}
      onClose={onClose}
      title={imageTitle(image?.alt ?? '')}
      titleId={titleId}
      hideTitle
      width="full"
      align="center"
    >
      {image === null ? null : (
        <ImageViewerBody key={image.url} image={image} onClose={onClose} />
      )}
    </Dialog>
  );
}

/** The zoom a person chose: the fit of the screen, or one fixed scale. */
type Zoom =
  { readonly kind: 'fit' } | { readonly kind: 'scale'; readonly value: number };

const fit: Zoom = { kind: 'fit' };

/** Where one drag of a zoomed picture started. */
type DragStart = {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly left: number;
  readonly top: number;
};

/** Encodes the shown picture as one PNG, the one type a clipboard takes. */
function pngOf(picture: HTMLImageElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = picture.naturalWidth;
    canvas.height = picture.naturalHeight;
    const context = canvas.getContext('2d');
    if (context === null || canvas.width === 0 || canvas.height === 0) {
      reject(new Error('notesapp image viewer: the picture has no pixels'));
      return;
    }
    context.drawImage(picture, 0, 0);
    canvas.toBlob((blob) => {
      if (blob === null)
        reject(new Error('notesapp image viewer: the encode failed'));
      else resolve(blob);
    }, 'image/png');
  });
}

/** Saves the bytes of one blob address under a name. */
function saveAs(url: string, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

/** The icon of one action. */
function actionIcon(action: ImageAction): ReactNode {
  if (action === 'download') return <DownloadIcon />;
  if (action === 'open') return <ExternalLinkIcon />;
  return <CopyIcon />;
}

/** The room inside the padding of one element. */
function contentBox(element: HTMLElement): ImageSize {
  const style = getComputedStyle(element);
  const across =
    Number.parseFloat(style.paddingLeft) +
    Number.parseFloat(style.paddingRight);
  const down =
    Number.parseFloat(style.paddingTop) +
    Number.parseFloat(style.paddingBottom);
  return {
    width: Math.max(0, element.clientWidth - across),
    height: Math.max(0, element.clientHeight - down),
  };
}

/** The tools and the picture of one open viewer. */
function ImageViewerBody({
  image,
  onClose,
}: {
  readonly image: ImageOpenRequest;
  readonly onClose: () => void;
}): ReactNode {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const pictureRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragStart | null>(null);
  const [natural, setNatural] = useState<ImageSize | null>(null);
  const [room, setRoom] = useState<ImageSize>({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<Zoom>(fit);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');

  const fitted = natural === null ? 1 : fitZoom(natural, room);
  const scale = zoom.kind === 'fit' ? fitted : zoom.value;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const size = natural === null ? null : zoomedSize(natural, scale);
  const overflows =
    size !== null && (size.width > room.width || size.height > room.height);

  // The room of the picture follows the screen, so the fit follows a turn of
  // a phone and a resize of the window.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const measure = (): void => {
      setRoom(contentBox(scroller));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => {
      observer.disconnect();
    };
  }, []);

  // The wheel with Ctrl or Cmd held zooms the picture and not the page. A
  // React wheel handler is passive and cannot keep the page zoom away, so
  // this listener is added by hand.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom({
        kind: 'scale',
        value: wheelZoom(scaleRef.current, event.deltaY),
      });
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      scroller.removeEventListener('wheel', onWheel);
    };
  }, []);

  const zoomTo = (value: number): void => {
    setZoom({ kind: 'scale', value });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const step = zoomKey(event.key);
    if (step === null) return;
    event.preventDefault();
    if (step === 'fit') setZoom(fit);
    else zoomTo(step === 'in' ? zoomIn(scale) : zoomOut(scale));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const scroller = scrollerRef.current;
    if (scroller === null || !overflows) return;
    if (event.pointerType === 'touch' || event.button !== 0) return;
    event.preventDefault();
    scroller.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: scroller.scrollLeft,
      top: scroller.scrollTop,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const scroller = scrollerRef.current;
    const start = dragRef.current;
    if (scroller === null || start?.pointerId !== event.pointerId) return;
    scroller.scrollLeft = start.left - (event.clientX - start.x);
    scroller.scrollTop = start.top - (event.clientY - start.y);
  };

  const endDrag = (): void => {
    dragRef.current = null;
  };

  const run = (action: ImageAction): void => {
    if (action === 'download') {
      saveAs(image.url, imageDownloadName(image.destination, image.alt));
      return;
    }
    if (action === 'copy-link') {
      void copyText(image.url).then((done) => {
        setMessage(
          done
            ? imageActionMessages.copiedLink
            : imageActionMessages.copyLinkFailed,
        );
      });
      return;
    }
    const picture = pictureRef.current;
    if (picture === null) return;
    void copyPngImage(pngOf(picture)).then((done) => {
      setMessage(
        done
          ? imageActionMessages.copiedImage
          : imageActionMessages.copyImageFailed,
      );
    });
  };

  const status = failed ? imageActionMessages.notLoaded : message;
  // The zoom means nothing until the picture states its size, so the tools
  // wait for it and no percentage shows that the picture does not have.
  const idle = failed || natural === null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-cluster pe-3 ps-5 pt-2">
        <p
          className="m-0 min-w-0 flex-1 truncate text-ui font-semibold text-strong"
          aria-hidden="true"
        >
          {imageTitle(image.alt)}
        </p>
        <Button
          variant="ghost"
          size="sm"
          label="Close"
          icon={<CloseIcon />}
          onClick={onClose}
        />
      </div>
      <div className="flex flex-wrap items-center gap-cluster px-5 pb-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            label="Zoom out"
            icon={<ZoomOutIcon />}
            disabled={idle || scale <= zoomLimits.min}
            onClick={() => {
              zoomTo(zoomOut(scale));
            }}
          />
          <span className="w-12 text-center text-control tabular-nums text-muted">
            {idle ? '' : zoomPercent(scale)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            label="Zoom in"
            icon={<ZoomInIcon />}
            disabled={idle || scale >= zoomLimits.max}
            onClick={() => {
              zoomTo(zoomIn(scale));
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={idle || zoom.kind === 'fit'}
            onClick={() => {
              setZoom(fit);
            }}
          >
            Fit
          </Button>
        </div>
        <p
          className="m-0 min-w-0 flex-1 truncate text-control text-muted"
          role="status"
        >
          {status}
        </p>
        <div className="flex items-center gap-cluster">
          {imageActions(image.external).map((action) =>
            action === 'open' ? (
              <a
                key={action}
                className={buttonClassName({
                  variant: 'secondary',
                  size: 'sm',
                })}
                href={image.url}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                <span
                  className="inline-flex items-center justify-center"
                  aria-hidden="true"
                >
                  {actionIcon(action)}
                </span>
                <span>{imageActionLabels[action]}</span>
              </a>
            ) : (
              <Button
                key={action}
                variant="secondary"
                size="sm"
                icon={actionIcon(action)}
                disabled={action === 'copy-image' ? idle : failed}
                onClick={() => {
                  run(action);
                }}
              >
                {imageActionLabels[action]}
              </Button>
            ),
          )}
        </div>
      </div>
      <div
        ref={scrollerRef}
        className={`flex min-h-0 flex-1 overflow-auto overscroll-contain bg-app p-4 ${overflows ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {failed ? null : (
          <img
            ref={pictureRef}
            className={`m-auto max-w-none select-none ${size === null ? 'invisible' : ''}`}
            src={image.url}
            alt={image.alt}
            width={size?.width}
            height={size?.height}
            draggable={false}
            referrerPolicy={image.external ? 'no-referrer' : undefined}
            onLoad={(event): void => {
              const picture = event.currentTarget;
              setNatural({
                width: picture.naturalWidth,
                height: picture.naturalHeight,
              });
            }}
            onError={(): void => {
              setFailed(true);
            }}
          />
        )}
      </div>
    </div>
  );
}
