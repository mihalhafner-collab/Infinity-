export function normalizePhotoSrc(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return null;
  // JPEG-Base64 beginnt ebenfalls mit "/": vor relativen Pfaden prüfen.
  const mime = trimmed.startsWith('/9j/') ? 'jpeg'
    : trimmed.startsWith('iVBOR') ? 'png'
    : trimmed.startsWith('UklGR') ? 'webp' : null;
  if (mime) {
    const base64 = trimmed.replace(/\s/g, '');
    return /^[A-Za-z0-9+/]+={0,2}$/.test(base64)
      ? `data:image/${mime};base64,${base64}` : null;
  }
  if (/^data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*,[\s\S]+$/i.test(trimmed)) return trimmed;
  if (/^blob:[^\s]+$/.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).hostname ? trimmed : null;
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith('/')) return trimmed;
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
        img.onerror = () => reject(new Error('Bild konnte nicht geladen werden'));
        img.onload = () => {
          try {
            const compressed = renderImageToDataUrl(img, maxDim, quality);
            resolve(compressed || resultStr);
          } catch (error) {
            reject(error);
          }
        };
        img.src = resultStr;
      };
      try {
        reader.readAsDataURL(file);
      } catch (error) {
        reject(error);
      }
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
