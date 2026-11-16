export function normalizePhotoSrc(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
  if (
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/')
  ) {
    return trimmed;
  }
  if (trimmed.startsWith('/9j/')) {
    return `data:image/jpeg;base64,${trimmed}`;
  }
  if (trimmed.startsWith('iVBOR')) {
    return `data:image/png;base64,${trimmed}`;
  }
  if (trimmed.startsWith('UklGR')) {
    return `data:image/webp;base64,${trimmed}`;
  }
  return null;
}

function renderImageToDataUrl(
  img: HTMLImageElement,
  maxDim: number,
  quality: number
): string | null {
  let width = img.naturalWidth || img.width || maxDim;
  let height = img.naturalHeight || img.height || maxDim;
  if (width > maxDim || height > maxDim) {
    if (width >= height) {
      height = Math.max(1, Math.round((height * maxDim) / width));
      width = maxDim;
    } else {
      width = Math.max(1, Math.round((width * maxDim) / height));
      height = maxDim;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

export function compressImageFile(
  file: File,
  maxDim = 760,
  quality = 0.78
): Promise<string> {
  return new Promise((resolve, reject) => {
    const readViaFileReader = () => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
      reader.onload = () => {
        const resultStr = String(reader.result || '');
        const img = new Image();
        img.onerror = () => {
          if (resultStr.startsWith('data:image/')) {
            resolve(resultStr);
          } else {
            reject(new Error('Bild konnte nicht geladen werden'));
          }
        };
        img.onload = () => {
          const compressed = renderImageToDataUrl(img, maxDim, quality);
          resolve(compressed || resultStr);
        };
        img.src = resultStr;
      };
      reader.readAsDataURL(file);
    };

    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      let objectUrl = '';
      try {
        objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          readViaFileReader();
        };
        img.onload = () => {
          try {
            const compressed = renderImageToDataUrl(img, maxDim, quality);
            URL.revokeObjectURL(objectUrl);
            if (compressed && compressed.startsWith('data:image/')) {
              resolve(compressed);
            } else {
              readViaFileReader();
            }
          } catch {
            URL.revokeObjectURL(objectUrl);
            readViaFileReader();
          }
        };
        img.src = objectUrl;
        return;
      } catch {
        if (objectUrl) {
          try {
            URL.revokeObjectURL(objectUrl);
          } catch {
            // ignore
          }
        }
      }
    }

    readViaFileReader();
  });
}
