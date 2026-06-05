import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { app } from 'electron';
import Seven from 'node-7z';
import type { WebContents } from 'electron';

export interface ArchiveEntry {
  name: string;
  size: number;
  compressedSize: number;
  mtime: Date;
  isDirectory: boolean;
}

export interface ListResult {
  entries: ArchiveEntry[];
  totalSize: number;
}

export interface ExtractResult {
  success: boolean;
  message?: string;
}

export interface ArchiveInfo {
  format: 'zip' | 'rar' | '7z';
  entryCount: number;
  totalSize: number;
}

export interface ComicInfo {
  title?: string;
  series?: string;
  volume?: string;
  number?: string;
  writer?: string;
  penciller?: string;
  inker?: string;
  colorist?: string;
  letterer?: string;
  coverArtist?: string;
  artist?: string;
  author?: string;
  editor?: string;
  publisher?: string;
  imprint?: string;
  genre?: string;
  tags?: string;
  pagecount?: number;
  language?: string;
  country?: string;
  date?: string;
  year?: string;
  month?: string;
  day?: string;
  isbn?: string;
  issn?: string;
  altColorist?: string;
  altCoverArtist?: string;
  altEditor?: string;
  altInker?: string;
  altPenciller?: string;
  altWriter?: string;
  characters?: string;
  locations?: string;
  synopsis?: string;
  notes?: string;
  web?: string;
  draft?: string;
  lastMajorUpdate?: string;
  lastMinorUpdate?: string;
}

export async function listArchiveEntries(filepath: string): Promise<ListResult> {
  try {
    const seven = Seven.list(filepath, { $bin: app.isPackaged ? join(process.resourcesPath, '7z') : undefined });
    
    const entries: ArchiveEntry[] = [];
    let totalSize = 0;

    return new Promise((resolve, reject) => {
      seven.on('data', (entry) => {
        entries.push({
          name: entry.name,
          size: entry.size,
          compressedSize: entry.compressedSize,
          mtime: new Date(entry.mtime),
          isDirectory: entry.isDirectory
        });
        totalSize += entry.size;
      });

      seven.on('end', () => {
        resolve({ entries, totalSize });
      });

      seven.on('error', (err) => {
        reject(err);
      });
    });
  } catch (error) {
    throw new Error(`Failed to list archive entries: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function extractArchive(archivePath: string, outputDir?: string): Promise<ExtractResult> {
  try {
    const seven = Seven.extract(archivePath, outputDir, { $bin: app.isPackaged ? join(process.resourcesPath, '7z') : undefined });
    
    return new Promise((resolve, reject) => {
      seven.on('end', () => {
        resolve({ success: true });
      });

      seven.on('error', (err) => {
        reject(err);
      });
    });
  } catch (error) {
    throw new Error(`Failed to extract archive: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function compressArchive(sourceDir: string, destArchive: string): Promise<void> {
  try {
    const seven = Seven.compress(sourceDir, destArchive, { $bin: app.isPackaged ? join(process.resourcesPath, '7z') : undefined });
    
    await new Promise((resolve, reject) => {
      seven.on('end', () => {
        resolve(true);
      });

      seven.on('error', (err) => {
        reject(err);
      });
    });
  } catch (error) {
    throw new Error(`Failed to compress archive: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function readInnerFile(archivePath: string, innerFilePath: string): Promise<Buffer> {
  try {
    const seven = Seven.extractFull(archivePath, { $bin: app.isPackaged ? join(process.resourcesPath, '7z') : undefined });
    
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);

      seven.on('data', (chunk) => {
        if (chunk.name === innerFilePath) {
          buffer = Buffer.concat([buffer, chunk]);
        }
      });

      seven.on('end', () => {
        resolve(buffer);
      });

      seven.on('error', (err) => {
        reject(err);
      });
    });
  } catch (error) {
    throw new Error(`Failed to read inner file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function extractCoverImage(archivePath: string): Promise<Buffer | null> {
  try {
    const seven = Seven.extractFull(archivePath, { $bin: app.isPackaged ? join(process.resourcesPath, '7z') : undefined });
    
    return new Promise((resolve, reject) => {
      let coverBuffer: Buffer | null = null;
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp'];

      seven.on('data', (chunk) => {
        const fileName = chunk.name.toLowerCase();
        if (imageExtensions.some(ext => fileName.endsWith(ext))) {
          coverBuffer = chunk;
        }
      });

      seven.on('end', () => {
        resolve(coverBuffer);
      });

      seven.on('error', (err) => {
        reject(err);
      });
    });
  } catch (error) {
    throw new Error(`Failed to extract cover image: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function readComicInfo(archivePath: string): Promise<ComicInfo | null> {
  try {
    if (!existsSync(archivePath)) {
      throw new Error(`Archive file not found: ${archivePath}`);
    }

    // Try to read ComicInfo.xml from the archive
    const comicInfoXml = await readInnerFile(archivePath, 'ComicInfo.xml');
    
    if (comicInfoXml) {
      // Parse XML content here - parse the ComicInfo.xml using xml2js
      const xml2js = await import('xml2js');
      
      try {
        const result = await xml2js.parseStringPromise(comicInfoXml.toString('utf-8'));
        const comicInfo = result.ComicInfo[0];
        
        // Map XML fields to ComicInfo interface
        const parsedComicInfo: Partial<ComicInfo> = {};
        
        if (comicInfo.Title) parsedComicInfo.title = comicInfo.Title[0];
        if (comicInfo.Series) parsedComicInfo.series = comicInfo.Series[0];
        if (comicInfo.Volume) parsedComicInfo.volume = comicInfo.Volume[0];
        if (comicInfo.Number) parsedComicInfo.number = comicInfo.Number[0];
        if (comicInfo.Writer) parsedComicInfo.writer = comicInfo.Writer[0];
        if (comicInfo.Penciller) parsedComicInfo.penciller = comicInfo.Penciller[0];
        if (comicInfo.Inker) parsedComicInfo.inker = comicInfo.Inker[0];
        if (comicInfo.Colorist) parsedComicInfo.colorist = comicInfo.Colorist[0];
        if (comicInfo.Letterer) parsedComicInfo.letterer = comicInfo.Letterer[0];
        if (comicInfo.CoverArtist) parsedComicInfo.coverArtist = comicInfo.CoverArtist[0];
        if (comicInfo.Artist) parsedComicInfo.artist = comicInfo.Artist[0];
        if (comicInfo.Author) parsedComicInfo.author = comicInfo.Author[0];
        if (comicInfo.Editor) parsedComicInfo.editor = comicInfo.Editor[0];
        if (comicInfo.Publisher) parsedComicInfo.publisher = comicInfo.Publisher[0];
        if (comicInfo.Imprint) parsedComicInfo.imprint = comicInfo.Imprint[0];
        if (comicInfo.Genre) parsedComicInfo.genre = comicInfo.Genre[0];
        if (comicInfo.Tags) parsedComicInfo.tags = comicInfo.Tags[0];
        if (comicInfo.PageCount) parsedComicInfo.pagecount = parseInt(comicInfo.PageCount[0], 10);
        if (comicInfo.Language) parsedComicInfo.language = comicInfo.Language[0];
        if (comicInfo.Country) parsedComicInfo.country = comicInfo.Country[0];
        if (comicInfo.Date) parsedComicInfo.date = comicInfo.Date[0];
        if (comicInfo.Year) parsedComicInfo.year = comicInfo.Year[0];
        if (comicInfo.Month) parsedComicInfo.month = comicInfo.Month[0];
        if (comicInfo.Day) parsedComicInfo.day = comicInfo.Day[0];
        if (comicInfo.Isbn) parsedComicInfo.isbn = comicInfo.Isbn[0];
        if (comicInfo.Issn) parsedComicInfo.issn = comicInfo.Issn[0];
        if (comicInfo.AltColorist) parsedComicInfo.altColorist = comicInfo.AltColorist[0];
        if (comicInfo.AltCoverArtist) parsedComicInfo.altCoverArtist = comicInfo.AltCoverArtist[0];
        if (comicInfo.AltEditor) parsedComicInfo.altEditor = comicInfo.AltEditor[0];
        if (comicInfo.AltInker) parsedComicInfo.altInker = comicInfo.AltInker[0];
        if (comicInfo.AltPenciller) parsedComicInfo.altPenciller = comicInfo.AltPenciller[0];
        if (comicInfo.AltWriter) parsedComicInfo.altWriter = comicInfo.AltWriter[0];
        if (comicInfo.Characters) parsedComicInfo.characters = comicInfo.Characters[0];
        if (comicInfo.Locations) parsedComicInfo.locations = comicInfo.Locations[0];
        if (comicInfo.Synopsis) parsedComicInfo.synopsis = comicInfo.Synopsis[0];
        if (comicInfo.Notes) parsedComicInfo.notes = comicInfo.Notes[0];
        if (comicInfo.Web) parsedComicInfo.web = comicInfo.Web[0];
        if (comicInfo.Draft) parsedComicInfo.draft = comicInfo.Draft[0];
        if (comicInfo.LastMajorUpdate) parsedComicInfo.lastMajorUpdate = comicInfo.LastMajorUpdate[0];
        if (comicInfo.LastMinorUpdate) parsedComicInfo.lastMinorUpdate = comicInfo.LastMinorUpdate[0];
        
        return parsedComicInfo as ComicInfo;
      } catch (parseError) {
        // If parsing fails, return null
        console.error('Failed to parse ComicInfo.xml:', parseError);
        return null;
      }
    }

    return null;
  } catch (error) {
    // If ComicInfo.xml doesn't exist or cannot be read, return null
    console.error('Error reading ComicInfo.xml:', error);
    return null;
  }
}

export async function renameInnerFiles(archivePath: string, renames: {oldName: string; newName: string}[]): Promise<boolean> {
  try {
    // This is a stub implementation - actual implementation would use 7z to rename files
    return false;
  } catch (error) {
    console.error('Error renaming inner files:', error);
    return false;
  }
}

export async function injectFileToArchive(archivePath: string, filePath: string, targetPath: string): Promise<boolean> {
  try {
    // This is a stub implementation - actual implementation would use 7z to inject files
    return false;
  } catch (error) {
    console.error('Error injecting file to archive:', error);
    return false;
  }
}

export async function injectComicInfo(archivePath: string, comicInfo: ComicInfo): Promise<boolean> {
  try {
    // This is a stub implementation - actual implementation would use 7z to inject ComicInfo.xml
    return false;
  } catch (error) {
    console.error('Error injecting ComicInfo:', error);
    return false;
  }
}

export async function convertArchiveFormat(sourcePath: string, targetPath: string, targetFormat: 'zip' | 'rar' | '7z'): Promise<boolean> {
  try {
    // This is a stub implementation - actual implementation would use 7z to convert formats
    return false;
  } catch (error) {
    console.error('Error converting archive format:', error);
    return false;
  }
}

export async function getArchiveInfo(archivePath: string): Promise<ArchiveInfo> {
  try {
    const entries = await listArchiveEntries(archivePath);
    
    let format: 'zip' | 'rar' | '7z' = 'zip';
    
    // Determine format based on file extension
    if (archivePath.toLowerCase().endsWith('.rar')) {
      format = 'rar';
    } else if (archivePath.toLowerCase().endsWith('.7z')) {
      format = '7z';
    }
    
    return {
      format,
      entryCount: entries.entries.length,
      totalSize: entries.totalSize
    };
  } catch (error) {
    throw new Error(`Failed to get archive info: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
