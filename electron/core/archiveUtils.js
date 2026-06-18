import { execFile } from 'child_process';
import { promisify } from 'util';
import zipfile from 'zip-full';
import fs from 'fs';
import path from 'path';

const execFileAsync = promisify(execFile);

// Windows flag for creating subprocess without window
const CREATE_NO_WINDOW = 0x08000000;

/**
 * Background load image from archive file.
 * @param {string} arcPath - Path to archive file (.zip, .cbz, .cbr, .rar, .7z)
 * @param {string} innerPath - Inner file path within the archive
 * @param {string} ext - File extension of the archive
 * @param {string} targetId - Target identifier for emitting results
 * @param {string} sevenZExe - Path to 7-Zip executable
 * @param {object} signals - Signal emitter object with image_loaded event
 */
export async function bgLoadImage(arcPath, innerPath, ext, targetId, sevenZExe, signals) {
  let imgData = null;
  try {
    if (ext === '.zip' || ext === '.cbz') {
      // Read from ZIP archive
      const data = await readFromZip(arcPath, innerPath);
      imgData = data;
    } else {
      // Use 7-Zip for other archive formats (.cbr, .rar, .7z)
      try {
        const { stdout } = await execFileAsync(sevenZExe, ['e', '-so', arcPath, innerPath], {
          maxBuffer: 500 * 1024 * 1024, // 500MB buffer for large images
        });
        if (stdout && stdout.length > 0) {
          imgData = stdout;
        }
      } catch (e) {
        console.error(`7-Zip extraction error (${arcPath}): ${e.message}`);
      }
    }
  } catch (e) {
    console.error(`Preview image load error (${arcPath}): ${e.message}`);
  }

  // Emit image_loaded signal with targetId, arcPath, and image data
  if (signals && typeof signals.emit === 'function') {
    signals.emit('image_loaded', targetId, String(arcPath), imgData);
  }
}

/**
 * Read a file from a ZIP archive.
 * @param {string} zipPath - Path to ZIP file
 * @param {string} innerPath - Inner file path
 * @returns {Promise<Buffer>} Image data as Buffer
 */
async function readFromZip(zipPath, innerPath) {
  return new Promise((resolve, reject) => {
    const Zip = require('fflate');
    
    fs.readFile(zipPath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      
      try {
        const unzipped = Zip.unzipSync(data);
        // Find the matching file (case-insensitive)
        let fileData = null;
        for (const key of Object.keys(unzipped)) {
          if (key.toLowerCase() === innerPath.toLowerCase()) {
            fileData = Buffer.from(unzipped[key]);
            break;
          }
        }
        
        if (!fileData) {
          // Try partial match
          for (const key of Object.keys(unzipped)) {
            if (key.endsWith(path.basename(innerPath))) {
              fileData = Buffer.from(unzipped[key]);
              break;
            }
          }
        }
        
        if (fileData) {
          resolve(fileData);
        } else {
          reject(new Error(`File not found in archive: ${innerPath}`));
        }
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * List all files inside a ZIP/CBZ archive.
 * @param {string} zipPath - Path to ZIP file
 * @returns {Promise<string[]>} Array of inner file paths
 */
export async function listZipContents(zipPath) {
  return new Promise((resolve, reject) => {
    fs.readFile(zipPath, (err, data) => {
      if (err) {
        reject(err);
        return;
      }
      
      try {
        const Zip = require('fflate');
        const unzipped = Zip.unzipSync(data);
        resolve(Object.keys(unzipped));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Extract image from archive using 7-Zip.
 * @param {string} sevenZExe - Path to 7-Zip executable
 * @param {string} arcPath - Path to archive file
 * @param {string} innerPath - Inner file path
 * @returns {Promise<Buffer>} Image data as Buffer
 */
export async function extractWith7Zip(sevenZExe, arcPath, innerPath) {
  try {
    const { stdout } = await execFileAsync(sevenZExe, ['e', '-so', arcPath, innerPath], {
      maxBuffer: 500 * 1024 * 1024,
    });
    return stdout;
  } catch (e) {
    throw new Error(`7-Zip extraction failed: ${e.message}`);
  }
}

/**
 * List all entries inside an archive (ZIP, CBZ, RAR, CBR, 7z).
 * @param {string} arcPath - Path to archive file
 * @param {string} extType - File extension of the archive
 * @param {string} sevenZExe - Path to 7-Zip executable
 * @returns {Promise<Array>} Array of entry objects { name, size }
 */
export async function listArchiveEntries(arcPath, extType, sevenZExe) {
  const ext = extType.toLowerCase();
  
  if (ext === '.zip' || ext === '.cbz') {
    const names = await listZipContents(arcPath);
    return names.map(name => ({ name, size: 0 }));
  } else {
    // Use 7-Zip for other formats
    try {
      const { stdout } = await execFileAsync(sevenZExe, ['l', arcPath], {
        maxBuffer: 10 * 1024 * 1024,
      });
      
      const entries = [];
      const lines = stdout.split('\n');
      
      for (const line of lines) {
        // 7-Zip list output format parsing
        const parts = line.trim().split(/\s{2,}/);
        if (parts.length >= 6 && !line.startsWith('-------') && !line.startsWith('Path') && line.trim() !== '') {
          const name = parts.slice(5).join(' ').trim();
          const sizeMatch = line.match(/(\d+)\s+/);
          const size = sizeMatch ? parseInt(sizeMatch[1]) : 0;
          
          if (name && !name.startsWith('.') && !name.endsWith('/')) {
            entries.push({ name, size });
          }
        }
      }
      
      return entries;
    } catch (e) {
      throw new Error(`7-Zip list failed: ${e.message}`);
    }
  }
}
