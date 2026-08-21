// Adapted from Supertone Inc.'s MIT-licensed Supertonic Node.js reference implementation.
// Copyright (c) 2025 Supertone Inc.

import fs from 'fs';
import path from 'path';

export const SUPERTONIC_VOICES = Object.freeze(['M1', 'M2', 'M3', 'M4', 'M5', 'F1', 'F2', 'F3', 'F4', 'F5']);
export const SUPERTONIC_LANGUAGES = Object.freeze([
    'en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi',
    'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro',
    'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi',
]);

const SUPERTONIC_INPUT_MAX_LENGTH = 1000;
const runtimeCache = new Map();
const styleCache = new Map();
let synthesisQueue = Promise.resolve();

function supertonicError(code, message) {
    return Object.assign(new Error(message), { code });
}

export function detectSupertonicLanguage(text = '', fallback = 'en') {
    const source = String(text || '');
    if (/[가-힣ᄀ-ᇿ]/u.test(source)) return 'ko';
    if (/[぀-ヿ]/u.test(source)) return 'ja';
    if (SUPERTONIC_LANGUAGES.includes(fallback) && !['ko', 'ja', 'en'].includes(fallback)) return fallback;
    if (/[A-Za-z]/u.test(source)) return 'en';
    return SUPERTONIC_LANGUAGES.includes(fallback) ? fallback : 'en';
}

export function normalizeSupertonicOptions(options = {}) {
    const text = String(options.text || options.input || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    if (!text) throw supertonicError('SUPERTONIC_NO_TEXT', 'No text to read.');
    if (text.length > SUPERTONIC_INPUT_MAX_LENGTH) {
        throw supertonicError('SUPERTONIC_TEXT_TOO_LONG', 'Supertonic TTS input is too long.');
    }

    const requestedVoice = String(options.voice || 'M1').trim().toUpperCase();
    const requestedLanguage = String(options.lang || options.language || '').trim().toLowerCase();
    const speed = Number(options.speed);
    const totalStep = Number(options.totalStep);
    return {
        text,
        voice: SUPERTONIC_VOICES.includes(requestedVoice) ? requestedVoice : 'M1',
        lang: SUPERTONIC_LANGUAGES.includes(requestedLanguage)
            ? requestedLanguage
            : detectSupertonicLanguage(text),
        speed: Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1.05,
        totalStep: Number.isFinite(totalStep) ? Math.max(2, Math.min(12, Math.round(totalStep))) : 8,
    };
}

class UnicodeProcessor {
    constructor(indexer) {
        this.indexer = indexer;
    }

    preprocessText(input, lang) {
        let text = String(input || '').normalize('NFKD');
        text = text.replace(/[\u{1F1E6}-\u{1F1FF}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+/gu, '');
        const replacements = {
            '–': '-',
            '‑': '-',
            '—': '-',
            '_': ' ',
            '\u201C': '"',
            '\u201D': '"',
            '\u2018': "'",
            '\u2019': "'",
            '´': "'",
            '`': "'",
            '[': ' ',
            ']': ' ',
            '|': ' ',
            '/': ' ',
            '#': ' ',
            '→': ' ',
            '←': ' ',
        };
        for (const [source, replacement] of Object.entries(replacements)) {
            text = text.replaceAll(source, replacement);
        }
        text = text
            .replace(/[♥☆♡©\\]/g, '')
            .replaceAll('@', ' at ')
            .replaceAll('e.g.,', 'for example, ')
            .replaceAll('i.e.,', 'that is, ')
            .replace(/ ([,.!?;:'])/g, '$1')
            .replace(/""+/g, '"')
            .replace(/''+/g, "'")
            .replace(/``+/g, '`')
            .replace(/\s+/g, ' ')
            .trim();
        if (!/[.!?;:,'"')\]}…。」』】〉》›»]$/u.test(text)) text += '.';
        if (!SUPERTONIC_LANGUAGES.includes(lang)) {
            throw supertonicError('SUPERTONIC_LANGUAGE_UNSUPPORTED', `Unsupported Supertonic language: ${lang}`);
        }
        return `<${lang}>${text}</${lang}>`;
    }

    call(textList, langList) {
        const processed = textList.map((text, index) => this.preprocessText(text, langList[index]));
        const codePoints = processed.map(text => Array.from(text));
        const lengths = codePoints.map(chars => chars.length);
        const maxLength = Math.max(...lengths);
        const textIds = new BigInt64Array(processed.length * maxLength);
        const textMask = new Float32Array(processed.length * maxLength);

        for (let batch = 0; batch < codePoints.length; batch += 1) {
            for (let index = 0; index < codePoints[batch].length; index += 1) {
                const codePoint = codePoints[batch][index].codePointAt(0);
                const mapped = Number(this.indexer[codePoint]);
                textIds[batch * maxLength + index] = BigInt(Number.isInteger(mapped) ? mapped : 0);
                textMask[batch * maxLength + index] = 1;
            }
        }
        return {
            textIds,
            textIdsShape: [processed.length, maxLength],
            textMask,
            textMaskShape: [processed.length, 1, maxLength],
        };
    }
}

class Style {
    constructor(ttl, dp) {
        this.ttl = ttl;
        this.dp = dp;
    }
}

function randomNormal() {
    const first = Math.max(1e-10, Math.random());
    const second = Math.random();
    return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
}

function splitOversizedText(text, maxLength) {
    const chunks = [];
    let remaining = text.trim();
    while (remaining.length > maxLength) {
        const candidate = remaining.slice(0, maxLength);
        const matches = [...candidate.matchAll(/[\s,;:。！？.!?]/gu)];
        const preferred = matches.reverse().find(match => match.index >= Math.floor(maxLength * 0.55));
        const cut = preferred ? preferred.index + preferred[0].length : maxLength;
        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
}

function chunkText(text, maxLength) {
    const chunks = [];
    const paragraphs = String(text || '').trim().split(/\n\s*\n+/).filter(Boolean);
    for (const paragraph of paragraphs) {
        const sentences = paragraph.trim().split(/(?<=[.!?。！？])\s+/u).filter(Boolean);
        let current = '';
        for (const sentence of sentences) {
            if (sentence.length > maxLength) {
                if (current) chunks.push(current);
                chunks.push(...splitOversizedText(sentence, maxLength));
                current = '';
            } else if (!current || current.length + sentence.length + 1 <= maxLength) {
                current += `${current ? ' ' : ''}${sentence}`;
            } else {
                chunks.push(current);
                current = sentence;
            }
        }
        if (current) chunks.push(current);
    }
    return chunks;
}

class TextToSpeech {
    constructor(ort, config, textProcessor, sessions) {
        this.ort = ort;
        this.config = config;
        this.textProcessor = textProcessor;
        this.durationPredictor = sessions.durationPredictor;
        this.textEncoder = sessions.textEncoder;
        this.vectorEstimator = sessions.vectorEstimator;
        this.vocoder = sessions.vocoder;
        this.sampleRate = config.ae.sample_rate;
        this.baseChunkSize = config.ae.base_chunk_size;
        this.chunkCompressFactor = config.ttl.chunk_compress_factor;
        this.latentDimension = config.ttl.latent_dim;
    }

    sampleNoisyLatent(duration) {
        const batchSize = duration.length;
        const waveLengths = duration.map(value => Math.floor(value * this.sampleRate));
        const chunkSize = this.baseChunkSize * this.chunkCompressFactor;
        const latentLengths = waveLengths.map(length => Math.floor((length + chunkSize - 1) / chunkSize));
        const latentLength = Math.max(...latentLengths);
        const latentDimension = this.latentDimension * this.chunkCompressFactor;
        const latent = new Float32Array(batchSize * latentDimension * latentLength);
        const mask = new Float32Array(batchSize * latentLength);

        for (let batch = 0; batch < batchSize; batch += 1) {
            for (let time = 0; time < latentLengths[batch]; time += 1) {
                mask[batch * latentLength + time] = 1;
                for (let dimension = 0; dimension < latentDimension; dimension += 1) {
                    latent[(batch * latentDimension + dimension) * latentLength + time] = randomNormal();
                }
            }
        }
        return {
            latent,
            latentShape: [batchSize, latentDimension, latentLength],
            mask,
            maskShape: [batchSize, 1, latentLength],
        };
    }

    async infer(textList, langList, style, totalStep, speed, onProgress) {
        const batchSize = textList.length;
        const processed = this.textProcessor.call(textList, langList);
        const textIds = new this.ort.Tensor('int64', processed.textIds, processed.textIdsShape);
        const textMask = new this.ort.Tensor('float32', processed.textMask, processed.textMaskShape);
        const durationResult = await this.durationPredictor.run({
            text_ids: textIds,
            style_dp: style.dp,
            text_mask: textMask,
        });
        const duration = Array.from(durationResult.duration.data, value => value / speed);
        const textEncoderResult = await this.textEncoder.run({
            text_ids: textIds,
            style_ttl: style.ttl,
            text_mask: textMask,
        });
        const sampled = this.sampleNoisyLatent(duration);
        const latentMask = new this.ort.Tensor('float32', sampled.mask, sampled.maskShape);
        const totalStepTensor = new this.ort.Tensor('float32', new Float32Array(batchSize).fill(totalStep), [batchSize]);
        let latentTensor = new this.ort.Tensor('float32', sampled.latent, sampled.latentShape);

        for (let step = 0; step < totalStep; step += 1) {
            onProgress?.({ phase: 'synthesize', current: step + 1, total: totalStep, percent: Math.round(((step + 1) / totalStep) * 100) });
            const currentStepTensor = new this.ort.Tensor('float32', new Float32Array(batchSize).fill(step), [batchSize]);
            const vectorResult = await this.vectorEstimator.run({
                noisy_latent: latentTensor,
                text_emb: textEncoderResult.text_emb,
                style_ttl: style.ttl,
                text_mask: textMask,
                latent_mask: latentMask,
                total_step: totalStepTensor,
                current_step: currentStepTensor,
            });
            latentTensor = vectorResult.denoised_latent;
        }

        const vocoderResult = await this.vocoder.run({ latent: latentTensor });
        return { wav: Float32Array.from(vocoderResult.wav_tts.data), duration };
    }

    async call(text, lang, style, totalStep, speed, onProgress) {
        if (style.ttl.dims[0] !== 1) throw new Error('Single speaker synthesis requires one voice style.');
        const maxLength = lang === 'ko' || lang === 'ja' ? 120 : 300;
        const chunks = chunkText(text, maxLength);
        const waveParts = [];
        const silenceLength = Math.floor(0.3 * this.sampleRate);
        let totalLength = 0;
        let totalDuration = 0;

        for (let index = 0; index < chunks.length; index += 1) {
            const result = await this.infer([chunks[index]], [lang], style, totalStep, speed, progress => {
                onProgress?.({ ...progress, chunk: index + 1, chunkCount: chunks.length });
            });
            const expectedLength = Math.min(result.wav.length, Math.floor(this.sampleRate * result.duration[0]));
            const wave = result.wav.subarray(0, expectedLength);
            if (waveParts.length > 0) {
                waveParts.push(new Float32Array(silenceLength));
                totalLength += silenceLength;
                totalDuration += 0.3;
            }
            waveParts.push(wave);
            totalLength += wave.length;
            totalDuration += result.duration[0];
        }

        const combined = new Float32Array(totalLength);
        let offset = 0;
        for (const part of waveParts) {
            combined.set(part, offset);
            offset += part.length;
        }
        return { wav: combined, duration: totalDuration };
    }
}

async function loadRuntime(modelDir) {
    const cached = runtimeCache.get(modelDir);
    if (cached) return cached;
    const promise = (async () => {
        const ort = await import('onnxruntime-node');
        const onnxDir = path.join(modelDir, 'onnx');
        const config = JSON.parse(fs.readFileSync(path.join(onnxDir, 'tts.json'), 'utf8'));
        const indexer = JSON.parse(fs.readFileSync(path.join(onnxDir, 'unicode_indexer.json'), 'utf8'));
        const sessionOptions = { executionProviders: ['cpu'], graphOptimizationLevel: 'all' };
        const [durationPredictor, textEncoder, vectorEstimator, vocoder] = await Promise.all([
            ort.InferenceSession.create(path.join(onnxDir, 'duration_predictor.onnx'), sessionOptions),
            ort.InferenceSession.create(path.join(onnxDir, 'text_encoder.onnx'), sessionOptions),
            ort.InferenceSession.create(path.join(onnxDir, 'vector_estimator.onnx'), sessionOptions),
            ort.InferenceSession.create(path.join(onnxDir, 'vocoder.onnx'), sessionOptions),
        ]);
        return {
            ort,
            textToSpeech: new TextToSpeech(ort, config, new UnicodeProcessor(indexer), {
                durationPredictor,
                textEncoder,
                vectorEstimator,
                vocoder,
            }),
        };
    })();
    runtimeCache.set(modelDir, promise);
    try {
        return await promise;
    } catch (error) {
        runtimeCache.delete(modelDir);
        throw error;
    }
}

function flattenStyleData(data) {
    return Float32Array.from(data.flat(Infinity));
}

async function loadStyle(modelDir, voice, ort) {
    const cacheKey = `${modelDir}:${voice}`;
    if (styleCache.has(cacheKey)) return styleCache.get(cacheKey);
    const parsed = JSON.parse(fs.readFileSync(path.join(modelDir, 'voice_styles', `${voice}.json`), 'utf8'));
    const style = new Style(
        new ort.Tensor('float32', flattenStyleData(parsed.style_ttl.data), parsed.style_ttl.dims),
        new ort.Tensor('float32', flattenStyleData(parsed.style_dp.data), parsed.style_dp.dims),
    );
    styleCache.set(cacheKey, style);
    return style;
}

export function createPcm16WavBuffer(audioData, sampleRate) {
    const dataSize = audioData.length * 2;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    for (let index = 0; index < audioData.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, Number(audioData[index]) || 0));
        buffer.writeInt16LE(Math.round(sample * 32767), 44 + index * 2);
    }
    return buffer;
}

async function synthesizeSupertonic(options, runtime = {}) {
    const normalized = normalizeSupertonicOptions(options);
    const modelDir = runtime.modelDir;
    if (!modelDir) throw supertonicError('SUPERTONIC_MODEL_MISSING', 'Supertonic model is not installed.');
    const loaded = await loadRuntime(modelDir);
    const style = await loadStyle(modelDir, normalized.voice, loaded.ort);
    const result = await loaded.textToSpeech.call(
        normalized.text,
        normalized.lang,
        style,
        normalized.totalStep,
        normalized.speed,
        runtime.onProgress,
    );
    const wavBuffer = createPcm16WavBuffer(result.wav, loaded.textToSpeech.sampleRate);
    return {
        success: true,
        engine: 'supertonic',
        voice: normalized.voice,
        lang: normalized.lang,
        duration: result.duration,
        mimeType: 'audio/wav',
        dataUrl: `data:audio/wav;base64,${wavBuffer.toString('base64')}`,
    };
}

export function createSupertonicTtsDataUrl(options = {}, runtime = {}) {
    const task = synthesisQueue
        .catch(() => {})
        .then(() => synthesizeSupertonic(options, runtime));
    synthesisQueue = task.catch(() => {});
    return task;
}

export function clearSupertonicRuntimeCache() {
    runtimeCache.clear();
    styleCache.clear();
}
