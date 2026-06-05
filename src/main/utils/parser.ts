import { parseXml } from 'xml2js';

export interface ComicInfo {
  title?: string;
  series?: string;
  issue?: string;
  volume?: string;
  writer?: string;
  penciller?: string;
  inker?: string;
  colorist?: string;
  letterer?: string;
  coverArtist?: string;
  publisher?: string;
  imprint?: string;
  genre?: string;
  tags?: string[];
  pageCount?: number;
  publishedDate?: string;
  description?: string;
  characters?: string[];
  teams?: string[];
  locations?: string[];
  notes?: string;
}

export async function parseComicInfo(filePath: string): Promise<ComicInfo | null> {
  try {
    const data = await parse(filePath);
    return data;
  } catch (error) {
    console.error('Failed to parse comic info:', error);
    return null;
  }
}
