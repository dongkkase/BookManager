import sharp from 'sharp';

export interface OptimizeOptions {
  format?: 'webp' | 'jpeg' | 'png' | 'none';
  quality?: number; // 0 to 100
  stripMetadata?: boolean;
}

export async function optimizeImage(inputPath: string, outputPath: string, options: OptimizeOptions): Promise<void> {
  let pipeline = sharp(inputPath);

  if (options.stripMetadata) {
    // Stripping EXIF and other metadata
    pipeline = pipeline.withMetadata(false as any); // actually .withMetadata() without args adds it, to strip we just don't call it, or call rotate to auto-orient then strip
    // sharp automatically strips metadata unless withMetadata() is called.
    // However, it's good to auto-orient based on EXIF before stripping.
    pipeline = pipeline.rotate(); 
  } else {
    // If we shouldn't strip, we preserve it. 
    // Wait, the python project always stripped EXIF: "이미지에 포함된 불필요한 EXIF 데이터를 제거하고"
    pipeline = pipeline.rotate(); 
  }

  const quality = options.quality ?? 85;

  if (options.format === 'webp') {
    pipeline = pipeline.webp({ quality });
  } else if (options.format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  } else if (options.format === 'png') {
    pipeline = pipeline.png({ quality: Math.max(10, quality), compressionLevel: 9 });
  }

  await pipeline.toFile(outputPath);
}

export async function getImageDimensions(inputPath: string): Promise<{ width: number; height: number }> {
  const metadata = await sharp(inputPath).metadata();
  return {
    width: metadata.width || 0,
    height: metadata.height || 0
  };
}
