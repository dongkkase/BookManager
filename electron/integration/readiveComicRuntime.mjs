import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');

// Execute the current Readive implementation. Only platform I/O is adapted to Node;
// XML parsing, metadata mapping, persistence, overlays, and ratings are production code.
// Cloud sync registration and device-specific archive/SQLite implementations are outside this harness.
export async function createReadiveComicRuntime({ readiveRoot, archivePath, title, serverId = 'bookmanager' }) {
    const readiveRequire = createRequire(path.join(readiveRoot, 'package.json'));
    const ts = readiveRequire('typescript');
    const read = name => readFileSync(path.join(readiveRoot, name), 'utf8');
    const compile = source => ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const load = (name, imports = {}) => {
        const output = {};
        new Function('exports', 'require', compile(read(name)))(output, dependency => {
            assert.ok(dependency in imports, `Unadapted Readive dependency: ${name}: ${dependency}`);
            return imports[dependency];
        });
        return output;
    };
    const extract = (name, functions, constants, dependencies) => {
        const source = ts.createSourceFile(name, read(name), ts.ScriptTarget.Latest, true);
        const declarations = [];
        const found = new Set();
        for (const node of source.statements) {
            if (ts.isFunctionDeclaration(node) && functions.includes(node.name?.text)) {
                found.add(node.name.text);
                declarations.push(node.getText(source));
            } else if (ts.isVariableStatement(node)) {
                for (const declaration of node.declarationList.declarations) {
                    if (ts.isIdentifier(declaration.name) && constants.includes(declaration.name.text)) {
                        found.add(declaration.name.text);
                        declarations.push(`const ${declaration.getText(source)};`);
                    }
                }
            }
        }
        for (const selected of [...functions, ...constants]) assert.ok(found.has(selected), `Missing Readive declaration: ${selected}`);
        const output = {};
        new Function('exports', ...Object.keys(dependencies), compile(`${declarations.join('\n')}\nexport { ${functions.join(', ')} };`))(
            output, ...Object.values(dependencies),
        );
        return output;
    };
    const workingDirectory = mkdtempSync(path.join(tmpdir(), 'readive-comic-flow-'));
    const toPath = uri => uri.startsWith('file:') ? fileURLToPath(uri) : uri;
    const joinParts = parts => path.join(...parts.map(part => toPath(typeof part === 'string' ? part : part.uri)));
    class NodeDirectory {
        constructor(...parts) { this.uri = pathToFileURL(joinParts(parts)).href; }
        create() { mkdirSync(toPath(this.uri), { recursive: true }); }
    }
    class NodeFile {
        constructor(...parts) { this.uri = pathToFileURL(joinParts(parts)).href; }
        get exists() { return existsSync(toPath(this.uri)); }
        get size() { return statSync(toPath(this.uri)).size; }
        info() {
            const stats = statSync(toPath(this.uri));
            return { size: stats.size, creationTime: stats.birthtimeMs, modificationTime: stats.mtimeMs };
        }
        async bytes() { return new Uint8Array(readFileSync(toPath(this.uri))); }
        copy(destination) { copyFileSync(toPath(this.uri), toPath(destination.uri)); }
        move(destination) { renameSync(toPath(this.uri), toPath(destination.uri)); this.uri = destination.uri; }
        delete() { rmSync(toPath(this.uri), { force: true }); }
    }
    const sql = new DatabaseSync(':memory:');
    sql.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, file_format TEXT, local_uri TEXT,
            size_bytes INTEGER, thumbnail_uri TEXT, updated_at TEXT, last_position REAL DEFAULT 0);
        CREATE TABLE library_collections (id TEXT PRIMARY KEY);
        CREATE TABLE library_collection_items (collection_id TEXT, book_id TEXT, created_at TEXT,
            PRIMARY KEY (collection_id, book_id));
        CREATE TABLE book_detail_metadata (book_id TEXT PRIMARY KEY, source_signature TEXT,
            metadata_version INTEGER, metadata_json TEXT, extracted_at TEXT);
        CREATE TABLE book_search_index (book_id TEXT PRIMARY KEY, search_text TEXT);
    `);
    const database = {
        execAsync: async statement => sql.exec(statement),
        getFirstAsync: async (statement, ...values) => sql.prepare(statement).get(...values) ?? null,
        getAllAsync: async (statement, ...values) => sql.prepare(statement).all(...values),
        runAsync: async (statement, ...values) => sql.prepare(statement).run(...values),
    };
    const storage = {
        getDatabase: async () => database,
        withExclusiveDatabaseTransaction: async work => {
            sql.exec('BEGIN IMMEDIATE');
            try { const value = await work(database); sql.exec('COMMIT'); return value; }
            catch (error) { sql.exec('ROLLBACK'); throw error; }
        },
    };
    await load('src/bookManager/schema.ts').ensureBookManagerSchema(database);
    const protocol = load('src/bookManager/protocol.ts');
    const types = load('src/library/types.ts');
    const parser = load('src/library/comicMetadataXml.ts', { './types': types, '@xmldom/xmldom': readiveRequire('@xmldom/xmldom') });
    const ratings = load('src/library/bookRatingRepository.ts', {
        'expo-crypto': { randomUUID }, '../storage/database': storage,
        './bookRating': load('src/library/bookRating.ts'),
    });
    const merge = load('src/bookManager/metadata.ts', { '../library/types': types });
    const overlay = load('src/library/bookManagerMetadata.ts', {
        './bookRatingRepository': ratings, '../storage/database': storage, '../bookManager/metadata': merge,
    });
    const titles = load('src/library/kavitaProgressTitle.ts');
    const search = load('src/library/bookSearchIndex.ts', { '../storage/database': storage, './kavitaProgressTitle': titles });
    const books = new Map();
    const bookRepository = {
        addBook: async book => {
            books.set(book.id, book);
            sql.prepare('INSERT INTO books (id, title, file_format, local_uri, size_bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
                .run(book.id, book.title, book.fileFormat, book.localUri, book.sizeBytes, book.updatedAt);
        },
        getStoredBookById: async id => {
            const book = books.get(id);
            const row = sql.prepare('SELECT title FROM books WHERE id = ?').get(id);
            return book && row ? { ...book, title: row.title } : null;
        },
        rollBackNewlyImportedBooksByIds: async ids => ids.forEach(id => { books.delete(id); sql.prepare('DELETE FROM books WHERE id = ?').run(id); }),
    };
    const hash = uri => {
        const bytes = readFileSync(toPath(uri));
        return `sha256-full-v2:${bytes.length}:${createHash('sha256').update(bytes).digest('hex')}`;
    };
    const imports = load('src/library/fileImport.ts', {
        'expo-document-picker': {}, 'expo-file-system': { Directory: NodeDirectory, File: NodeFile },
        '../storage/privateStorage': { getPrivateStorageDirectory: () => workingDirectory, preparePrivateStorage: async () => {} },
        './bookRepository': bookRepository, './ignoredLibraryFiles': load('src/library/ignoredLibraryFiles.ts'),
        './incomingFileQueue': { incomingBookId: id => id },
        './serviceImportPathName': load('src/library/serviceImportPathName.ts'),
        '../sync/importRegistration': {
            fingerprintImportedBook: async (uri, options) => {
                const fingerprint = hash(uri);
                if (options.expectedContentFingerprint) assert.equal(fingerprint, options.expectedContentFingerprint);
                return fingerprint;
            },
            registerImportedBookForSync: async () => {}, registerImportedBookForSyncBestEffort: async () => {},
        },
    });
    const book = await imports.importBookFileFromUri({
        name: path.basename(archivePath), uri: pathToFileURL(archivePath).href,
        size: statSync(archivePath).size, provenance: 'pcUpload', expectedContentFingerprint: hash(archivePath),
    });
    assert.ok(book, 'Readive must import the archive');
    if (title) { book.title = title; sql.prepare('UPDATE books SET title = ? WHERE id = ?').run(title, book.id); }
    const cache = new Map();
    const counters = { archiveListings: 0, extractedEntries: [] };
    const pendingWarnings = [];
    let api;
    let indexedMetadata = null;
    const nativeArchive = {
        listNativeArchiveEntries: async uri => {
            counters.archiveListings += 1;
            return new AdmZip(readFileSync(toPath(uri))).getEntries().map((entry, index) => ({
                name: entry.entryName, index, size: entry.header.size,
            }));
        },
        enqueueNativeArchiveExtraction: async request => {
            const entry = new AdmZip(readFileSync(toPath(request.sourceUri))).getEntries()[request.entryIndex];
            assert.equal(entry.entryName, request.expectedName);
            const bytes = entry.getData();
            assert.ok(bytes.length <= request.maximumOutputBytes, 'Native extraction output limit');
            counters.extractedEntries.push(entry.entryName);
            writeFileSync(toPath(request.destinationUri), bytes);
        },
    };
    api = extract('src/library/bookFile.ts', [
        'getBookDisplayFormat', 'inferBookFileFormat', 'getBookDetailMetadata', 'getStoredBookDetailMetadata',
        'trimBookDetailMetadataCache', 'loadBookDetailMetadata', 'createBookDetailMetadataSourceSignature',
        'readPersistedBookDetailMetadata', 'persistBookDetailMetadata', 'isBookDetailMetadata',
        'readBookDetailMetadata', 'readBookFileTimestamps', 'timestampToIsoString', 'readComicDetailMetadata',
        'normalizeComicMetadataText', 'splitComicMetadataValues', 'uniqueComicMetadataValues', 'readComicPublicationDate',
        'normalizeMetadataText', 'normalizeReaderText', 'decodeXml', 'parsePositiveInteger', 'stripFileExtension',
        'getArchiveReadingDirectionHint', 'readNativeArchiveIndexes', 'compareArchiveEntries', 'isReadableArchiveImageEntry',
        'isSafeArchiveMetadataEntry', 'readComicArchiveMetadataEntryText', 'readNativeArchiveEntryBytes',
        'extractNativeArchiveEntryToFile', 'readArchiveImageDimensionsSafely', 'readNativeArchiveImageDimensions',
        'decodeArchiveText', 'decodeTextWithEncoding', 'normalizeArchiveTextEncoding', 'detectArchiveTextEncoding',
        'scoreDecodedArchiveText', 'isLatinMojibakeCodeUnit', 'isWhitespaceCodeUnit', 'decodeLatin1', 'decodeUtf16Le', 'decodeUtf16Be',
        'createTextEncodingSample', 'isTextEncodingSampleBoundaryByte', 'getFileExtension', 'hashString',
        'readImageDimensions', 'normalizeImageDimensions', 'readUInt16LE', 'readUInt16BE', 'readUInt32BE', 'readInt32LE',
        'parseXmlAttributes',
    ], [
        'audioExtensions', 'zipArchiveExtensions', 'nativeArchiveExtensions', 'archiveExtensions', 'nativeArchiveMimeTypes',
        'archiveMimeTypes', 'epubExtensions', 'imageExtensions', 'textExtensions', 'maximumXmlMetadataEntrySize',
        'maximumBookDetailMetadataCacheEntries', 'bookDetailMetadataVersion', 'nativeArchiveMethod',
        'maximumArchiveImageEntrySize', 'maximumTextEncodingSampleBytes', 'textEncodingSampleSectionCount',
        'textEncodingSampleBoundarySearchBytes', 'archiveTextEncodingCandidates',
    ], {
        File: NodeFile, ...storage, ...parser, ...overlay, ...titles, ...nativeArchive,
        iconv: readiveRequire('iconv-lite'), bookDetailMetadataCache: cache,
        compareLibraryNames: load('src/library/libraryNameSort.ts').compareLibraryNames,
        isSharedDocumentBookId: () => false,
        getArchiveIndexWithAllEntries: async value => (await api.readNativeArchiveIndexes(value.localUri)).allEntries,
        getTemporaryBookThumbnailSourceFile: () => new NodeFile(workingDirectory, `entry-${randomUUID()}`),
        deleteTemporaryThumbnailSource: uri => rmSync(toPath(uri), { force: true }),
        NativeImage: { getSize: async uri => {
            const result = api.readImageDimensions(new Uint8Array(readFileSync(toPath(uri))));
            assert.ok(result, 'Image dimensions must be available');
            return result;
        } },
        replaceBookMetadataSearchIndex: async (db, id, metadata) => {
            indexedMetadata = structuredClone(metadata);
            await search.replaceBookMetadataSearchIndex(db, id, metadata);
        },
        console: { warn: (...args) => pendingWarnings.push(args.map(String).join(' ')) },
    });
    const transfer = extract('src/bookManager/repository.ts', ['saveTransferredBook'], [], {
        ...storage, ...bookRepository, getBookDetailMetadata: api.getBookDetailMetadata,
        replaceBookMetadataSearchIndex: async (db, id, metadata) => {
            indexedMetadata = structuredClone(metadata);
            await search.replaceBookMetadataSearchIndex(db, id, metadata);
        },
    });
    const preview = extract('src/components/bookManager/bookManagerBrowserPolicy.ts', ['createBookManagerDetailMetadata'], [], merge);
    const readerSource = ts.createSourceFile('ReaderScreen.tsx', read('src/screens/ReaderScreen.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const expressions = {};
    const visit = node => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
            && ['preferredReadingDirection', 'effectiveReadingDirection'].includes(node.name.text)) {
            expressions[node.name.text] = node.initializer.getText(readerSource);
        }
        ts.forEachChild(node, visit);
    };
    visit(readerSource);
    assert.equal(Object.keys(expressions).length, 2, 'ReaderScreen direction expressions must be found');
    const resolve = new Function('sessionReadingDirectionOverride', 'archiveReadingDirectionHint', 'readingDirection', 'readerKind', 'flowMode',
        `const preferredReadingDirection = ${expressions.preferredReadingDirection};
        const effectiveReadingDirection = ${expressions.effectiveReadingDirection};
        return { preferredReadingDirection, effectiveReadingDirection };`);
    return {
        book, database: sql, counters, warnings: pendingWarnings, types, parser,
        parseManifest: protocol.parseManifest,
        parseEntryPreview: protocol.parseBookManagerEntryPreview,
        getDetail: async () => api.getBookDetailMetadata(await bookRepository.getStoredBookById(book.id)),
        getStoredDetail: () => api.getStoredBookDetailMetadata(book.id),
        getDirection: () => api.getArchiveReadingDirectionHint(book),
        resolveDirection: async ({ sessionOverride = null, globalDirection = 'ltr', flowMode = 'paged', readerKind = 'comic' } = {}) =>
            resolve(sessionOverride, await api.getArchiveReadingDirectionHint(book), globalDirection, readerKind, flowMode),
        saveTransfer: file => transfer.saveTransferredBook(serverId, file, book.id, null, null),
        previewDetail: metadata => preview.createBookManagerDetailMetadata({ name: book.originalFileName, relativePath: book.originalFileName },
            { path: book.originalFileName, metadata }),
        applyRatingReply: reply => ratings.applyBookManagerRatings(serverId, ratings.parseRatingReplies([reply], [reply.itemId], []), [], () => {}),
        getRatingState: () => ratings.getBookRatingState(book.id),
        setRating: value => ratings.saveBookRating(book.id, value),
        clearMemoryCache: () => cache.clear(),
        getPersistedDetail: () => {
            const row = sql.prepare('SELECT metadata_json FROM book_detail_metadata WHERE book_id = ?').get(book.id);
            return row ? JSON.parse(row.metadata_json) : null;
        },
        getIndexDetail: () => indexedMetadata,
        getSearchText: () => sql.prepare('SELECT search_text FROM book_search_index WHERE book_id = ?').get(book.id)?.search_text,
        getImportedBytes: () => readFileSync(toPath(book.localUri)),
        close: () => { sql.close(); rmSync(workingDirectory, { recursive: true, force: true }); },
    };
}
