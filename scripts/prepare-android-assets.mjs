import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const targetWwwDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'www');

if (!fs.existsSync(distDir)) {
  console.error('Fehler: dist/ existiert nicht. Bitte zuerst "vite build" ausführen.');
  process.exit(1);
}

// Unnötige große Entwurfs-/Screenshot-Dateien aus dem APK-Bundle ausschließen,
// während Rechnungslogo, Icons und App-Assets vollständig erhalten bleiben.
function shouldSkipFile(relPath) {
  const normalized = relPath.replace(/\\/g, '/');
  const base = path.basename(normalized);

  if (base === 'sw.js' || base === 'registerSW.js' || base.startsWith('workbox-')) {
    return true;
  }
  if (normalized.startsWith('assets/aistudio/')) {
    // Nur das produktiv genutzte Rechnungslogo im APK behalten
    return base !== 'Hafner_Rechnungslogo_Original_236f7b3b.png';
  }
  if (base.endsWith('.tar.gz') || base.endsWith('.map')) {
    return true;
  }
  return false;
}

function copyRecursiveFiltered(src, dest, relPrefix = '') {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (shouldSkipFile(rel)) continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursiveFiltered(srcPath, destPath, rel);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

fs.rmSync(targetWwwDir, { recursive: true, force: true });
copyRecursiveFiltered(distDir, targetWwwDir);

// Entferne Web-Service-Worker-Registrierung aus der eingebetteten Android-index.html,
// da WebViewAssetLoader bereits 100 % lokal und offline direkt aus dem APK lädt.
const androidIndexPath = path.join(targetWwwDir, 'index.html');
if (fs.existsSync(androidIndexPath)) {
  let html = fs.readFileSync(androidIndexPath, 'utf8');
  html = html.replace(/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/g, '');
  fs.writeFileSync(androidIndexPath, html, 'utf8');
}

console.log('Android Offline-Bundle bereitgestellt in:', targetWwwDir);
