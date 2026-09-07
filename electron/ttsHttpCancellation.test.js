import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./ipcHandlers.js', import.meta.url), 'utf8');

function loadHttpHelpers() {
    const requests = [];
    const https = {
        request(options, onResponse) {
            const request = new EventEmitter();
            request.options = options;
            request.write = body => { request.body = body; };
            request.end = () => {};
            request.destroy = error => {
                request.destroyed = true;
                request.emit('error', error);
            };
            request.respond = (body, contentType) => {
                const response = new EventEmitter();
                response.headers = { 'content-type': contentType };
                response.statusCode = 200;
                response.setEncoding = () => {};
                onResponse(response);
                if (body instanceof Error) response.emit('error', body);
                else {
                    response.emit('data', body);
                    response.emit('end');
                }
            };
            options.signal?.addEventListener('abort', () => request.destroy(options.signal.reason), { once: true });
            requests.push(request);
            return request;
        },
    };
    const functions = ['requestJsonPost', 'requestFormPost', 'requestBufferPost'].map(name => {
        const start = source.indexOf(`function ${name}(`);
        return source.slice(start, source.indexOf('\n}\n', start) + 3);
    }).join('\n');
    const context = vm.createContext({ https, Buffer, URL, URLSearchParams, i18nT: value => value });
    vm.runInContext(functions, context);
    return { context, requests };
}

const calls = [
    ['requestJsonPost', (fn, runtime) => fn('https://example.invalid/tts', { text: '본문' }, {}, undefined, runtime)],
    ['requestFormPost', (fn, runtime) => fn('https://example.invalid/token', { assertion: 'token' }, {}, runtime)],
    ['requestBufferPost', (fn, runtime) => fn('https://example.invalid/tts', { input: '본문' }, {}, undefined, undefined, runtime)],
];

for (const [name, invoke] of calls) {
    test(`${name} forwards cancellation to the active HTTP request`, async () => {
        const { context, requests } = loadHttpHelpers();
        const controller = new AbortController();
        const response = invoke(context[name], { signal: controller.signal });
        assert.equal(requests[0].options.signal, controller.signal);
        const error = new Error('speech stopped');
        controller.abort(error);
        await assert.rejects(response, error);
        assert.equal(requests[0].destroyed, true);
    });

    test(`${name} preserves successful output and rejects interrupted responses`, async () => {
        const { context, requests } = loadHttpHelpers();
        const response = invoke(context[name], {});
        if (name === 'requestBufferPost') {
            const audio = Buffer.from([0, 255, 128, 1]);
            requests[0].respond(audio, 'audio/mpeg');
            const result = await response;
            assert.deepEqual(result.buffer, audio);
            assert.equal(result.contentType, 'audio/mpeg');
        } else {
            requests[0].respond('{"audioContent":"original"}', 'application/json');
            assert.equal((await response).audioContent, 'original');
        }
        const interrupted = invoke(context[name], {});
        requests[1].respond(new Error('connection closed'));
        await assert.rejects(interrupted, /connection closed/);
    });
}
