const PDF_RANGE_CHUNK_BYTES = 64 * 1024;

function abortError() {
    return Object.assign(new Error('PDF loading cancelled.'), { name: 'AbortError' });
}

function responseRange(response) {
    const match = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
    if (!match) return null;
    const [start, end, length] = match.slice(1).map(Number);
    return Number.isSafeInteger(length) && start >= 0 && end >= start && end < length
        ? { start, end, length }
        : null;
}

export async function loadViewerPdfDocument(pdfjs, url, options = {}) {
    const fetchDocument = options.fetch || globalThis.fetch;
    const signal = options.signal;
    const checkAborted = () => {
        if (signal?.aborted) throw abortError();
    };
    const request = headers => fetchDocument(url, { cache: 'no-store', signal, headers });
    const loadFullData = async (requestSignal = signal) => {
        checkAborted();
        const response = await fetchDocument(url, { cache: 'no-store', signal: requestSignal });
        if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            throw new Error(`PDF load failed: ${response.status}`);
        }
        const data = new Uint8Array(await response.arrayBuffer());
        checkAborted();
        if (requestSignal?.aborted) throw abortError();
        return data;
    };
    checkAborted();
    let initialResponse;
    try {
        initialResponse = await request({ Range: `bytes=0-${PDF_RANGE_CHUNK_BYTES - 1}` });
    } catch (error) {
        checkAborted();
        initialResponse = null;
    }
    checkAborted();
    let initialData;
    let range;
    try {
        if (initialResponse?.ok) {
            initialData = new Uint8Array(await initialResponse.arrayBuffer());
            range = initialResponse.status === 206 ? responseRange(initialResponse) : null;
        } else {
            await initialResponse?.body?.cancel().catch(() => {});
        }
    } catch {
        await initialResponse?.body?.cancel().catch(() => {});
        checkAborted();
        initialResponse = null;
    }
    checkAborted();
    const hasRanges = range?.start === 0 && initialData.length === range.end + 1;
    if (!hasRanges && initialResponse?.status !== 200) initialData = await loadFullData();

    let transport;
    let loadingTask;
    let rejectRangeFailure;
    const rangeFailure = new Promise((resolve, reject) => { rejectRangeFailure = reject; });
    if (hasRanges && initialData.length < range.length) {
        const requestController = new AbortController();
        let fullDataPromise;
        const pending = new Map();
        const getFullData = () => {
            if (!fullDataPromise) fullDataPromise = loadFullData(requestController.signal).then(data => {
                if (data.length !== range.length) throw new Error('PDF changed while loading.');
                return data;
            });
            return fullDataPromise;
        };
        const abortRanges = () => {
            requestController.abort();
            signal?.removeEventListener('abort', abortRanges);
            pending.clear();
            fullDataPromise = null;
        };
        transport = new pdfjs.PDFDataRangeTransport(range.length, initialData, true);
        transport.abort = abortRanges;
        signal?.addEventListener('abort', abortRanges, { once: true });
        transport.requestDataRange = (begin, end) => {
            const key = `${begin}:${end}`;
            if (pending.has(key) || requestController.signal.aborted) return;
            const work = (async () => {
                let bytes;
                try {
                    if (fullDataPromise) {
                        bytes = (await fullDataPromise).slice(begin, end);
                    } else {
                        const response = await fetchDocument(url, {
                            cache: 'no-store',
                            signal: requestController.signal,
                            headers: { Range: `bytes=${begin}-${end - 1}` },
                        });
                        const receivedRange = responseRange(response);
                        if (response.status !== 206 || receivedRange?.start !== begin
                            || receivedRange.end !== end - 1 || receivedRange.length !== range.length) {
                            await response.body?.cancel().catch(() => {});
                            throw new Error('PDF range response was not valid.');
                        }
                        bytes = new Uint8Array(await response.arrayBuffer());
                        if (bytes.length !== end - begin) throw new Error('PDF range response was incomplete.');
                    }
                } catch (error) {
                    if (requestController.signal.aborted || signal?.aborted) throw abortError();
                    bytes = (await getFullData()).slice(begin, end);
                }
                if (!requestController.signal.aborted && !signal?.aborted) transport.onDataRange(begin, bytes);
            })();
            pending.set(key, work);
            work.catch(error => {
                rejectRangeFailure(error);
                void loadingTask?.destroy().catch(() => {});
            }).finally(() => pending.delete(key));
        };
    }

    try {
        loadingTask = pdfjs.getDocument({
            ...(transport ? { range: transport, rangeChunkSize: PDF_RANGE_CHUNK_BYTES } : { data: initialData }),
            disableAutoFetch: true,
            disableStream: true,
        });
        options.onLoadingTask?.(loadingTask);
    } catch (error) {
        transport?.abort();
        loadingTask?.promise.catch(() => {});
        await loadingTask?.destroy().catch(() => {});
        throw error;
    }
    const abortLoading = () => {
        rejectRangeFailure(abortError());
        transport?.abort();
        void loadingTask.destroy().catch(() => {});
    };
    signal?.addEventListener('abort', abortLoading, { once: true });
    if (signal?.aborted) abortLoading();
    try {
        return await Promise.race([loadingTask.promise, rangeFailure]);
    } catch (error) {
        transport?.abort();
        await loadingTask.destroy().catch(() => {});
        throw error;
    } finally {
        signal?.removeEventListener('abort', abortLoading);
    }
}
