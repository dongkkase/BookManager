import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// folderUtils를 동적으로 import하여 메타데이터를 추출합니다
async function extractMetadata(name) {
  try {
    // ES 모듈 동적 임포트 (Node 환경에서 src 파일 접근)
    const folderUtilsUrl = new URL('../../src/utils/folderUtils.js', import.meta.url);
    const { extractCoreTitle, extractVolNumbers } = await import(folderUtilsUrl);
    
    const series = extractCoreTitle(name);
    const vols = extractVolNumbers(name, series);
    const volume = vols.length > 0 ? (vols.length === 1 ? String(vols[0]) : `${vols[0]}~${vols[vols.length - 1]}`) : '';
    
    return { series, volume };
  } catch (err) {
    console.warn('Failed to extract metadata:', err);
    return { series: name, volume: '' };
  }
}

export async function scanFolder(folderPath, options = {}, event) {
  const { includeSubfolders = true, targetExts = ['.zip', '.cbz', '.rar', '.cbr', '.7z', '.pdf', '.epub'] } = options;
  const results = [];
  let scannedCount = 0;

  async function scanDir(currentPath) {
    let entries;
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      console.error(`Failed to read directory: ${currentPath}`, error);
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      
      if (entry.isDirectory()) {
        if (includeSubfolders) {
          await scanDir(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (targetExts.includes(ext)) {
          try {
            const stats = await fs.promises.stat(fullPath);
            scannedCount++;
            
            const meta = await extractMetadata(entry.name);

            // Mocking metadata and thumbnail properties for UI
            const fileData = {
              name: entry.name,
              path: fullPath,
              full_path: fullPath,
              ext: ext,
              size: stats.size,
              mtime: stats.mtimeMs,
              ctime: stats.ctimeMs,
              created: new Date(stats.birthtimeMs).toISOString(),
              modified: new Date(stats.mtimeMs).toISOString(),
              is_folder: false,
              series: meta.series || '',
              title: entry.name,
              volume: meta.volume || '',
              chapter: '',
              author: '',
              resolution: '',
              cover: '', // Placeholder for now
            };

            results.push(fileData);

            if (event && scannedCount % 50 === 0) {
              event.sender.send('scan-progress', {
                progress: 50, // mock progress
                message: `${scannedCount}개 항목 검색 중...`
              });
            }
          } catch (statError) {
            console.error(`Failed to stat file: ${fullPath}`, statError);
          }
        }
      }
    }
  }

  await scanDir(folderPath);

  if (event) {
    event.sender.send('scan-complete', {
      files: results,
      folderPath
    });
  }

  return results;
}
