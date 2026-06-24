const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const WINDOWS_ZIP_NAME = 'BookManager-win.zip';
const WINDOWS_EXECUTABLE_NAME = 'BookManager.exe';

const crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
        value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    return value >>> 0;
});

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    const dosTime = (date.getHours() << 11)
        | (date.getMinutes() << 5)
        | Math.floor(date.getSeconds() / 2);
    const dosDate = ((year - 1980) << 9)
        | ((date.getMonth() + 1) << 5)
        | date.getDate();
    return { dosDate, dosTime };
}

function createSingleFileZip(sourcePath, zipPath, entryName) {
    const source = fs.readFileSync(sourcePath);
    const compressed = zlib.deflateRawSync(source, { level: 9 });
    const fileName = Buffer.from(entryName, 'utf8');
    const stats = fs.statSync(sourcePath);
    const { dosDate, dosTime } = toDosDateTime(stats.mtime);
    const checksum = crc32(source);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(source.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralDirectoryOffset = localHeader.length + fileName.length + compressed.length;
    const centralDirectory = Buffer.alloc(46);
    centralDirectory.writeUInt32LE(0x02014b50, 0);
    centralDirectory.writeUInt16LE(20, 4);
    centralDirectory.writeUInt16LE(20, 6);
    centralDirectory.writeUInt16LE(0, 8);
    centralDirectory.writeUInt16LE(8, 10);
    centralDirectory.writeUInt16LE(dosTime, 12);
    centralDirectory.writeUInt16LE(dosDate, 14);
    centralDirectory.writeUInt32LE(checksum, 16);
    centralDirectory.writeUInt32LE(compressed.length, 20);
    centralDirectory.writeUInt32LE(source.length, 24);
    centralDirectory.writeUInt16LE(fileName.length, 28);
    centralDirectory.writeUInt16LE(0, 30);
    centralDirectory.writeUInt16LE(0, 32);
    centralDirectory.writeUInt16LE(0, 34);
    centralDirectory.writeUInt16LE(0, 36);
    centralDirectory.writeUInt32LE(0, 38);
    centralDirectory.writeUInt32LE(0, 42);

    const centralDirectorySize = centralDirectory.length + fileName.length;
    const endOfCentralDirectory = Buffer.alloc(22);
    endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
    endOfCentralDirectory.writeUInt16LE(0, 4);
    endOfCentralDirectory.writeUInt16LE(0, 6);
    endOfCentralDirectory.writeUInt16LE(1, 8);
    endOfCentralDirectory.writeUInt16LE(1, 10);
    endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
    endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);
    endOfCentralDirectory.writeUInt16LE(0, 20);

    fs.writeFileSync(zipPath, Buffer.concat([
        localHeader,
        fileName,
        compressed,
        centralDirectory,
        fileName,
        endOfCentralDirectory,
    ]));
}

async function afterAllArtifactBuild(context) {
    const portableArtifact = (context.artifactPaths || [])
        .find(filePath => path.basename(filePath) === WINDOWS_EXECUTABLE_NAME);
    if (!portableArtifact || !fs.existsSync(portableArtifact)) return [];

    const zipPath = path.join(context.outDir, WINDOWS_ZIP_NAME);
    createSingleFileZip(portableArtifact, zipPath, WINDOWS_EXECUTABLE_NAME);
    return [zipPath];
}

module.exports = afterAllArtifactBuild;
module.exports.afterAllArtifactBuild = afterAllArtifactBuild;
module.exports.createSingleFileZip = createSingleFileZip;
