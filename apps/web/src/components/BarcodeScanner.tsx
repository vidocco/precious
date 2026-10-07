import { useEffect, useRef, useState } from 'react';
import { Button } from './ui.tsx';

/** The browser's built-in barcode reader, where there is one (Chrome on Android, macOS). */
interface Detector {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>;
}
type DetectorClass = {
  new (opts: { formats: string[] }): Detector;
  getSupportedFormats: () => Promise<string[]>;
};

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];

function cameraError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError') return 'Camera access was refused. Allow it in the browser’s site settings.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device.';
  if (name === 'NotReadableError') return 'The camera is being used by another app.';
  return 'The camera couldn’t be started.';
}

/**
 * Reads an ISBN or EAN barcode with the camera. It uses the browser's own reader when
 * there is one, and otherwise loads a decoder (only then, so it never slows the app).
 */
export function BarcodeScanner({ onDetected, onCancel }: { onDetected: (code: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState(
    window.isSecureContext && 'mediaDevices' in navigator
      ? ''
      : 'Scanning needs a secure connection (https://), which browsers require before they share the camera. A USB or Bluetooth barcode scanner still works: scan into the search box.',
  );
  const [status, setStatus] = useState('Starting the camera…');
  const done = useRef(onDetected);
  done.current = onDetected;

  useEffect(() => {
    if (error) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let zxingStop: (() => void) | undefined;

    const found = (code: string) => {
      if (stopped) return;
      stopped = true;
      navigator.vibrate?.(60);
      done.current(code);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        const v = video.current;
        if (!v || stopped) return;
        v.srcObject = stream;
        await v.play().catch(() => {});
        setStatus('Point the camera at the barcode.');

        const Native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
        const supported = Native ? await Native.getSupportedFormats().catch(() => []) : [];
        if (Native && supported.includes('ean_13')) {
          const detector = new Native({ formats: FORMATS.filter((f) => supported.includes(f)) });
          const tick = async () => {
            if (stopped) return;
            try {
              const [hit] = await detector.detect(v);
              if (hit?.rawValue) return found(hit.rawValue);
            } catch {
              // A frame that couldn't be read; try the next one.
            }
            timer = setTimeout(tick, 200);
          };
          void tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          if (stopped) return;
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromStream(stream, v, (result) => {
            if (result) found(result.getText());
          });
          zxingStop = () => controls.stop();
        }
      } catch (err) {
        if (!stopped) setError(cameraError(err));
      }
    })();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      zxingStop?.();
      for (const t of stream?.getTracks() ?? []) t.stop();
    };
  }, [error]);

  return (
    <div className="grid gap-2">
      {error ? (
        <p className="rounded-[10px] bg-surface-sunk px-3 py-2.5 text-[0.9rem] text-ink-muted" role="alert">
          {error}
        </p>
      ) : (
        <div className="relative overflow-hidden rounded-[12px] bg-black">
          <video ref={video} playsInline muted className="block aspect-[4/3] w-full object-cover" />
          {/* An aiming box with the rest dimmed. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1/2 h-[34%] w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-[10px] border-2 border-white/90 shadow-[0_0_0_100vmax_rgb(0_0_0/0.35)]"
          />
          <p
            className="absolute inset-x-0 bottom-0 bg-black/45 px-3 py-1.5 text-center text-[0.85rem] text-white"
            aria-live="polite"
          >
            {status}
          </p>
        </div>
      )}
      <div>
        <Button size="sm" onClick={onCancel}>
          {error ? 'Back to the search' : 'Cancel'}
        </Button>
      </div>
    </div>
  );
}
