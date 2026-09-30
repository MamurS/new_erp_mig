/*
 * Camera QR scanner (CLINIC_SPEC §4.2): the camera permission is requested only after the user presses
 * «Сканировать камерой». Frames are decoded locally with jsQR; nothing leaves the browser.
 */
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Button } from '@/shared/ui/button';

export function QrScanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = () => {
      if (stopped) return;
      const v = video.current;
      if (v && ctx && v.readyState >= 2 && v.videoWidth) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (found?.data) {
          stopped = true;
          onCode(found.data);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (stopped) return;
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
        raf = requestAnimationFrame(tick);
      } catch {
        setError('Нет доступа к камере. Разрешите доступ в браузере или введите код вручную');
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="rounded-btn bg-danger-soft px-3 py-2 text-danger-text">
          {error}
        </p>
      ) : (
        <video ref={video} className="aspect-video w-full max-w-md rounded-card bg-black object-cover" muted playsInline aria-label="Изображение с камеры" />
      )}
      <Button variant="secondary" className="w-fit" onClick={onClose}>
        Закрыть камеру
      </Button>
    </div>
  );
}
