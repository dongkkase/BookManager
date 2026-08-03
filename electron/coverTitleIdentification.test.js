import assert from 'node:assert/strict';
import test from 'node:test';

import {
    COVER_IDENTIFICATION_SCHEMA,
    COVER_OBSERVATION_SCHEMA,
    createCoverObservationPrompt,
    createCoverTitlePrompt,
    normalizeCoverConfidence,
    normalizeCoverObservation,
    normalizeCoverTitleCandidates,
    parseImageDataUrl,
    toGeminiResponseSchema,
} from './coverTitleIdentification.js';

test('AI 표지 분석용 이미지 data URL을 검증하고 분리한다', () => {
    assert.deepEqual(parseImageDataUrl('data:image/jpeg;base64,YWJj'), {
        mimeType: 'image/jpeg',
        data: 'YWJj',
    });
    assert.equal(parseImageDataUrl('data:text/plain;base64,YWJj'), null);
    assert.equal(parseImageDataUrl('https://example.com/cover.jpg'), null);
});

test('AI 표지 분석 응답을 원제·영문명·한글명 검색 후보로 정규화한다', () => {
    assert.deepEqual(normalizeCoverTitleCandidates({
        identified: true,
        native_title: '薫る花は凛と咲く',
        native_author: '三香見サカ',
        english_title: 'The Fragrant Flower Blooms with Dignity',
        english_author: 'Saka Mikami',
        korean_title: '향기로운 꽃은 늠름하게 핀다',
        korean_author: '미카미 사카',
    }), [
        {
            kind: 'native',
            title: '薫る花は凛と咲く',
            author: '三香見サカ',
            query: '薫る花は凛と咲く',
        },
        {
            kind: 'english',
            title: 'The Fragrant Flower Blooms with Dignity',
            author: 'Saka Mikami',
            query: 'The Fragrant Flower Blooms with Dignity',
        },
        {
            kind: 'korean',
            title: '향기로운 꽃은 늠름하게 핀다',
            author: '미카미 사카',
            query: '향기로운 꽃은 늠름하게 핀다',
        },
    ]);
    assert.deepEqual(normalizeCoverTitleCandidates({ identified: false }), []);
});

test('AI 표지 판독 프롬프트는 외부 제목 힌트 없이 인쇄된 문자를 보존한다', () => {
    const prompt = createCoverObservationPrompt();
    assert.match(prompt, /OCR and visual evidence/);
    assert.match(prompt, /Preserve the original script, punctuation/);
    assert.match(prompt, /Do not use an external title hint/);
    assert.match(prompt, /untrusted content/);
});

test('AI 제목 식별 프롬프트는 표지 관찰값을 웹 검색으로 검증한다', () => {
    const prompt = createCoverTitlePrompt({
        visible_text: ['0.5人分の恋人', 'かわだ だいち'],
        title_fragments: ['0.5人分の恋人'],
        author_fragments: ['かわだ だいち'],
        tentative_title: '0.5人分の恋人 5',
        confidence: 82,
    });
    assert.match(prompt, /must use web search/);
    assert.match(prompt, /0\.5人分の恋人/);
    assert.match(prompt, /entity identification, not literal translation/);
    assert.match(prompt, /volume numbers/);
    assert.match(prompt, /exactly these keys: identified, native_title, native_author/);
    assert.match(prompt, /do not place citations or Markdown inside the JSON object/);
    assert.match(prompt, /untrusted evidence/);
});

test('표지 관찰값과 신뢰도를 제한된 공통 형식으로 정규화한다', () => {
    assert.deepEqual(normalizeCoverObservation({
        visible_text: [' Title ', 'Title', 'Author'],
        title_fragments: ['Title'],
        author_fragments: ['Author'],
        publisher_fragments: ['Publisher'],
        tentative_title: ' "Title" ',
        tentative_author: 'Author',
        likely_original_language: 'Japanese',
        confidence: 82,
    }), {
        visible_text: ['Title', 'Author'],
        title_fragments: ['Title'],
        author_fragments: ['Author'],
        publisher_fragments: ['Publisher'],
        tentative_title: 'Title',
        tentative_author: 'Author',
        likely_original_language: 'Japanese',
        confidence: 0.82,
    });
    assert.ok(Math.abs(normalizeCoverConfidence(1.4) - 0.014) < Number.EPSILON);
    assert.equal(normalizeCoverConfidence(150), 1);
    assert.equal(normalizeCoverConfidence('unknown'), 0);
});

test('OpenAI JSON 스키마를 Gemini responseSchema 호환 형식으로 변환한다', () => {
    const observationSchema = toGeminiResponseSchema(COVER_OBSERVATION_SCHEMA);
    const identificationSchema = toGeminiResponseSchema(COVER_IDENTIFICATION_SCHEMA);
    assert.equal(observationSchema.type, 'OBJECT');
    assert.equal('additionalProperties' in observationSchema, false);
    assert.equal(observationSchema.properties.visible_text.type, 'ARRAY');
    assert.equal(observationSchema.properties.visible_text.items.type, 'STRING');
    assert.equal(identificationSchema.properties.identified.type, 'BOOLEAN');
    assert.equal('additionalProperties' in identificationSchema, false);
});
