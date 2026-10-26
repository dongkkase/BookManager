import assert from 'node:assert/strict';
import path from 'node:path';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { ReadiveService } from '../readive/service.js';

const local = { name: 'interop', address: '192.168.5.10', netmask: '255.255.255.0' };
const remote = { remoteAddress: '192.168.5.20', localAddress: local.address };
const deviceId = 'comic-interop-phone';

async function captureAsset(send) {
    const chunks = [];
    let status;
    let headers;
    const response = new Writable({
        write(chunk, _encoding, callback) {
            chunks.push(Buffer.from(chunk));
            callback();
        },
    });
    response.writeHead = (code, values) => {
        status = code;
        headers = values;
    };
    const completion = finished(response);
    try {
        await send({ headers: {}, socket: remote }, response);
        await completion;
        return { bytes: Buffer.concat(chunks), status, headers };
    } catch (error) {
        response.destroy();
        await completion.catch(() => {});
        throw error;
    }
}

// Exercise production dispatch and file streams without a TCP listener or a real paired device.
export async function createBookManagerComicRuntime({ directory, libraryRoot, libraryDb }) {
    const service = new ReadiveService({
        directory,
        interfaces: () => [local],
        getRegisteredLibraries: () => [{ path: libraryRoot, alias: 'Comic interoperability fixtures' }],
        getLibraryDb: () => libraryDb,
    });
    service.localInterface = local;
    service.port = 19421;
    service.server = { close: callback => callback() };
    service.certificateSha256 = 'a'.repeat(64);
    let token = '';
    const dispatch = (route, body, method = body === undefined ? 'GET' : 'POST') => service.dispatch({
        ...remote,
        token,
        method,
        pathname: `/readive/v1${route}`,
        body,
    });
    const ticket = JSON.parse((await service.pairing()).ticket);
    token = (await dispatch('/pair', { secret: ticket.secret, deviceId, deviceName: 'Interop phone' })).json.token;
    const libraryId = (await service.status()).libraries[0].id;
    const preview = async relativePath => (await dispatch(`/libraries/${libraryId}/preview`, { path: relativePath })).json;

    return {
        preview,
        async download(relativePath) {
            const filePath = path.resolve(libraryRoot, relativePath);
            assert.ok(filePath.startsWith(path.resolve(libraryRoot) + path.sep), 'Only synthetic library files may be sent.');
            const snapshot = await service.scan({ paths: [filePath] });
            const job = await service.enqueue({ snapshotId: snapshot.id, deviceId, confirmed: true });
            const { manifest } = (await dispatch(`/jobs/${job.id}`)).json;
            assert.equal(manifest.files.length, 1);
            const [file] = manifest.files;
            await dispatch(`/jobs/${job.id}/accept`, { manifestId: manifest.id });
            const payload = await dispatch(`/jobs/${job.id}/files/${file.id}`);
            const received = await captureAsset((request, response) => service.sendAsset(request, response, payload));
            await dispatch(`/jobs/${job.id}/ack`, { fileId: file.id });
            await dispatch(`/jobs/${job.id}/ack`, { complete: true });
            assert.equal((await dispatch(`/jobs/${job.id}`)).json.job.state, 'completed');
            return { ...received, manifest, file, preview: await preview(relativePath) };
        },
        async read(relativePath) {
            const reader = (await dispatch(`/libraries/${libraryId}/read`, { path: relativePath })).json;
            try {
                const payload = await dispatch(`/readers/${reader.id}/content`);
                const received = await captureAsset((request, response) => service.sendReaderAsset(request, response, payload));
                return { ...received, reader };
            } finally {
                await dispatch(`/readers/${reader.id}/close`, {});
            }
        },
        async pullRating(file) {
            const result = (await dispatch('/ratings', { itemIds: [file.itemId], records: [] })).json;
            return result.records.find(record => record.itemId === file.itemId) ?? null;
        },
        close: () => service.stop(),
    };
}
