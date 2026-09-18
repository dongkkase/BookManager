import assert from 'node:assert/strict';
import test from 'node:test';
import {
    SUPERTONIC_READING_PRESETS, applySupertonicReadingPreset, normalizeSupertonicReading,
    planSupertonicSpeech, prepareSupertonicPages, splitSupertonicDialogue, splitSupertonicRequests,
    supertonicReadingCacheKey, supertonicReadingPresetId, validateSupertonicStyle,
} from './supertonicReading.js';

test('기본 스타일은 오디오북과 일상 대화이며 저장된 수동 설정은 그대로 유지한다', () => {
    const defaults = normalizeSupertonicReading();
    assert.equal(supertonicReadingPresetId(defaults.narration), 'audiobook');
    assert.equal(supertonicReadingPresetId(defaults.dialogue), 'conversation');
    assert.equal(supertonicReadingPresetId(defaults.thought), 'inner_monologue');
    assert.equal(defaults.thoughtEnabled, true);
    const previous = { voice: 'F3', speed: 0.85, pause: 0.37, customStyle: null };
    const restored = normalizeSupertonicReading({ narration: previous });
    assert.deepEqual(restored.narration, previous);
    assert.equal(supertonicReadingPresetId(restored.narration), '');
    assert.deepEqual(restored.thought, { voice: '', speed: 0.9, pause: 0.4, customStyle: null });
    assert.equal(applySupertonicReadingPreset(previous, 'unknown'), previous);
});

test('각 프리셋은 선택한 음성을 유지하고 저장 후에도 해당 역할에 적용되며 캐시를 구분한다', () => {
    const original = normalizeSupertonicReading({ narration: { voice: 'F2' }, dialogue: { voice: 'M3' } });
    const cacheKeys = new Set();
    for (const preset of SUPERTONIC_READING_PRESETS) {
        const updated = {
            ...original, narration: applySupertonicReadingPreset(original.narration, preset.id),
        };
        const restored = normalizeSupertonicReading(JSON.parse(JSON.stringify(updated)));
        assert.equal(supertonicReadingPresetId(restored.narration), preset.id);
        const plan = planSupertonicSpeech('그가 말했다. “안녕!”', restored);
        assert.deepEqual([plan[0].voice, plan[0].speed, plan[0].pause], ['F2', preset.speed, preset.pause]);
        assert.deepEqual([plan[1].voice, plan[1].speed, plan[1].pause], ['M3', 1.05, 0.18]);
        cacheKeys.add(supertonicReadingCacheKey(restored));
        const dialogue = applySupertonicReadingPreset(original.dialogue, preset.id);
        assert.equal(supertonicReadingPresetId(dialogue), preset.id);
        assert.equal(dialogue.voice, 'M3');
    }
    assert.equal(cacheKeys.size, SUPERTONIC_READING_PRESETS.length);
    assert.equal(supertonicReadingPresetId(original.narration), 'audiobook');
});

test('가져온 스타일은 프리셋으로 표시하지 않고 프리셋 선택 시 가져온 데이터를 해제한다', () => {
    const customStyle = {
        id: 'imported', name: 'My voice', data: {
            style_ttl: { dims: [1, 50, 256], data: Array(12800).fill(0.1) },
            style_dp: { dims: [1, 8, 16], data: Array(128).fill(0.2) },
        },
    };
    const saved = normalizeSupertonicReading({ dialogue: { voice: 'M4', customStyle } });
    assert.equal(supertonicReadingPresetId(saved.dialogue), '');
    assert.deepEqual(saved.dialogue.customStyle, customStyle);
    const dialogue = applySupertonicReadingPreset(saved.dialogue, 'calm_conversation');
    const plan = planSupertonicSpeech('“안녕!”', { ...saved, dialogue });
    assert.equal(plan[0].voice, 'M4');
    assert.equal(plan[0].customStyle, null);
    assert.equal(plan[0].speed, 0.95);
    assert.equal(plan[0].pause, 0.25);
    assert.equal(saved.dialogue.customStyle.id, 'imported');
    assert.equal(supertonicReadingPresetId({ ...dialogue, pause: 0.42 }), '');
});

test('낭독 설정은 저장된 이전 설정 및 잘못된 숫자를 안전하게 처리한다', () => {
    const defaults = normalizeSupertonicReading();
    assert.equal(defaults.dialogueEnabled, true);
    assert.equal(defaults.effectsMode, 'shorten');
    const normalized = normalizeSupertonicReading({
        narration: { voice: '../invalid', speed: Infinity, pause: -1 },
        dialogue: { voice: 'f2', speed: 99, pause: null },
        totalStep: 5.6, effectsVolume: -1, effectsMaxSeconds: 100, effectsMode: 'unknown',
    });
    assert.deepEqual(normalized.narration, { voice: '', speed: 1, pause: 0, customStyle: null });
    assert.deepEqual(normalized.dialogue, { voice: 'F2', speed: 2, pause: 0.18, customStyle: null });
    assert.equal(normalized.totalStep, 6);
    assert.equal(normalized.effectsVolume, 0.1);
    assert.equal(normalized.effectsMaxSeconds, 5);
});

test('중첩 따옴표와 영문 축약형을 구분하고 서술문으로 복귀한다', () => {
    const { segments, quotes } = splitSupertonicDialogue('그가 말했다. “Don’t say 「hello」.” 그리고 "안녕!" 끝.');
    assert.deepEqual(segments.map(part => [part.text.trim(), part.dialogue]), [
        ['그가 말했다.', false], ['Don’t say hello.', true],
        ['그리고', false], ['안녕!', true], ['끝.', false],
    ]);
    assert.deepEqual(quotes, []);
    assert.equal(splitSupertonicDialogue('」닫는 따옴표만 있는 글').segments[0].dialogue, false);
    assert.deepEqual(planSupertonicSpeech('“첫째”“둘째”').map(part => part.text), ['첫째', '둘째']);
    assert.equal(planSupertonicSpeech('“Don’t say 「hello」.”')[0].pauseAfter, 0.45);
});

test('작은따옴표와 백틱 속마음은 큰따옴표 대사 및 일반 문장과 다른 설정으로 읽는다', () => {
    for (const [open, close] of [["'", "'"], ['‘', '’'], ['`', '`']]) {
        const text = `그가 멈췄다. ${open}왜 그랬을까.${close} "괜찮아." 끝.`;
        const plan = planSupertonicSpeech(text, { thought: { voice: 'F3' }, dialogue: { voice: 'M2' } });
        assert.deepEqual(plan.map(part => [part.text, part.voice, part.speed, part.pause, part.pauseAfter]), [
            ['그가 멈췄다.', 'M1', 1, 0.3, undefined],
            ['왜 그랬을까.', 'F3', 0.9, 0.4, 0.4],
            ['괜찮아.', 'M2', 1.05, 0.18, 0.45],
            ['끝.', 'M1', 1, 0.3, undefined],
        ]);
    }
    const consecutive = planSupertonicSpeech("'첫 생각.' '다음 생각.'");
    assert.deepEqual(consecutive.map(part => part.text), ['첫 생각.', '다음 생각.']);
});

test('백틱 독백은 영문 아포스트로피와 구분하고 중첩 인용은 바깥 역할을 따른다', () => {
    const plan = planSupertonicSpeech('앞. `I don\'t know.` “그는 `괜찮아`라고 했다.” `왜 “괜찮아”라고 했을까.` 뒤.');
    assert.deepEqual(plan.map(part => [part.text, part.speed]), [
        ['앞.', 1], ["I don't know.", 0.9], ['그는 괜찮아라고 했다.', 1.05],
        ['왜 괜찮아라고 했을까.', 0.9], ['뒤.', 1],
    ]);
    const disabled = planSupertonicSpeech('앞. `속마음.` 뒤.', { thoughtEnabled: false });
    assert.equal(disabled.length, 1);
    assert.equal(disabled[0].text, '앞. 속마음. 뒤.');
    assert.equal(disabled[0].speed, 1);
    assert.deepEqual(splitSupertonicDialogue('앞.`first``second`뒤.').segments.map(part => part.role), [
        'narration', 'thought', 'thought', 'narration',
    ]);
});

test('속마음 자동 구분은 대사와 독립적으로 끄고 켤 수 있다', () => {
    const text = '앞. \'생각.\' "말." 뒤.';
    const withoutThought = planSupertonicSpeech(text, { thoughtEnabled: false });
    assert.deepEqual(withoutThought.map(part => [part.text, part.speed]), [['앞. 생각.', 1], ['말.', 1.05], ['뒤.', 1]]);
    const withoutDialogue = planSupertonicSpeech(text, { dialogueEnabled: false });
    assert.deepEqual(withoutDialogue.map(part => [part.text, part.speed]), [['앞.', 1], ['생각.', 0.9], ['말. 뒤.', 1]]);
    const disabled = planSupertonicSpeech(text, { dialogueEnabled: false, thoughtEnabled: false });
    assert.equal(disabled.length, 1);
    assert.equal(disabled[0].text, '앞. 생각. 말. 뒤.');
    assert.equal(disabled[0].pauseAfter, undefined);
});

test('영문 축약형 소유격은 보존하고 중첩 인용은 바깥쪽 역할을 따른다', () => {
    for (const text of ["Don't touch John's book. James' room is here.", 'Don’t touch John’s book. James’ room is here.']) {
        const parsed = splitSupertonicDialogue(text);
        assert.deepEqual(parsed.quotes, []);
        assert.equal(parsed.segments.length, 1);
        assert.equal(parsed.segments[0].role, 'narration');
        assert.equal(planSupertonicSpeech(text)[0].text, text);
    }
    const thought = planSupertonicSpeech("'I don't know.'");
    assert.equal(thought[0].text, "I don't know.");
    assert.equal(thought[0].speed, 0.9);
    const dialogue = planSupertonicSpeech('“그가 \'괜찮아\'라고 했어.”');
    assert.equal(dialogue.length, 1);
    assert.equal(dialogue[0].speed, 1.05);
    const nested = planSupertonicSpeech('‘왜 “괜찮아”라고 했을까.’');
    assert.equal(nested.length, 1);
    assert.equal(nested[0].speed, 0.9);
    assert.equal(nested[0].text, '왜 괜찮아라고 했을까.');
    for (const apostrophe of ["'", '’']) {
        for (let padding = 0; padding < 20; padding += 1) {
            const text = `${'x'.repeat(padding)}don${apostrophe}t${'b'.repeat(20)}`;
            const plan = splitSupertonicRequests(text, 16).flatMap(request => planSupertonicSpeech(request));
            assert.equal(plan.map(part => part.text).join(''), text);
            assert.ok(plan.every(part => part.speed === 1));
        }
    }
});

test('페이지와 긴 합성 요청을 넘겨도 속마음 역할과 원문을 유지한다', () => {
    const pages = prepareSupertonicPages(["앞. '왜 “그", '말”을 했을까. ', "모르겠네.' 뒤."]);
    assert.deepEqual(pages, ['앞. ‘왜 그’', '‘말을 했을까. ’', '‘모르겠네.’ 뒤.']);
    const profile = { thought: { voice: 'F5' } };
    assert.ok(planSupertonicSpeech(pages[1], profile).every(part => part.voice === 'F5'));
    assert.deepEqual(planSupertonicSpeech(pages[2], profile).map(part => part.voice), ['F5', 'M1']);
    const body = '긴 생각이 계속 이어졌다. '.repeat(200);
    const requests = splitSupertonicRequests(`앞. ‘${body}’ 뒤.`, 90);
    assert.ok(requests.every(request => request.length <= 90));
    const plan = requests.flatMap(request => planSupertonicSpeech(request, profile));
    assert.ok(plan.slice(1, -1).every(part => part.voice === 'F5'));
    assert.equal(plan.map(part => part.text).join('').replace(/\s/g, ''), `앞.${body}뒤.`.replace(/\s/g, ''));
    assert.equal(plan.filter(part => part.pauseAfter).length, 1);
    assert.equal(plan.at(-2).pauseAfter, 0.4);
    const backtickPages = prepareSupertonicPages(['앞. `왜 “그', '말”을 했을까. ', '모르겠네.` 뒤.']);
    assert.deepEqual(backtickPages, pages);
    assert.deepEqual(splitSupertonicRequests('앞. `' + body + '` 뒤.', 90), requests);
});

test('연속된 대사는 같은 음성이라도 각각 합성하고 대사 끝에 쉼을 남긴다', () => {
    for (const [open, close] of [['"', '"'], ['“', '”'], ['「', '」'], ['『', '』']]) {
        for (const separator of ['', ' ', '\n\n']) {
            const text = `${open}내 잘못 아니라 했잖냐. 적당히 해라.${close}${separator}${open}차장님, 이거 놓으세요. 이 새끼가 진짜…!${close}`;
            const requests = splitSupertonicRequests(prepareSupertonicPages([text])[0]);
            const plan = requests.flatMap(request => planSupertonicSpeech(request));
            assert.deepEqual(plan.map(part => part.text), [
                '내 잘못 아니라 했잖냐. 적당히 해라.', '차장님, 이거 놓으세요. 이 새끼가 진짜…!',
            ]);
            assert.ok(plan.every(part => part.voice === 'M1' && part.pauseAfter === 0.45));
        }
    }
    const slower = planSupertonicSpeech('“첫째” “둘째”', { dialogue: { pause: 0.8 } });
    assert.ok(slower.every(part => part.pauseAfter === 0.8));
    const disabled = planSupertonicSpeech('“첫째” “둘째”', { dialogueEnabled: false });
    assert.equal(disabled.length, 1);
    assert.equal(disabled[0].text, '첫째 둘째');
    assert.equal(disabled[0].pauseAfter, undefined);
});

test('대사 쉼은 비명 처리 모드와 같은 설정의 서술문 사이에서도 유지된다', () => {
    for (const effectsMode of ['original', 'shorten', 'skip']) {
        const plan = planSupertonicSpeech('“하하하! 으아아아악! 그만해.” “알았어.”', { effectsMode });
        assert.equal(plan.filter(part => part.pauseAfter === 0.45).length, 2);
        assert.equal(plan.at(-1).text, '알았어.');
    }
    const plan = planSupertonicSpeech('그가 말했다. “첫째.” “둘째.” 끝.', { dialogue: { speed: 1, pause: 0.3 } });
    assert.deepEqual(plan.map(part => part.text), ['그가 말했다.', '첫째.', '둘째.', '끝.']);
    assert.deepEqual(plan.map(part => part.pauseAfter), [undefined, 0.45, 0.45, undefined]);
    const skipped = planSupertonicSpeech('“첫째.” “으아아아악!” “둘째.”', { effectsMode: 'skip' });
    assert.deepEqual(skipped.map(part => part.text), ['첫째.', '둘째.']);
});

test('페이지를 넘긴 대사도 같은 역할로 이어지며 닫는 따옴표 뒤의 서술문을 보존한다', () => {
    const pages = prepareSupertonicPages(['시작. “안녕 ', '다음 페이지에서도 ', '계속해.” 끝.']);
    assert.deepEqual(pages, ['시작. “안녕 ”', '“다음 페이지에서도 ”', '“계속해.” 끝.']);
    assert.deepEqual(planSupertonicSpeech(pages[2], { dialogue: { voice: 'F1' } }).map(part => part.voice), ['F1', 'M1']);
});

test('긴 대사를 합성 요청으로 나누어도 역할과 텍스트가 유지된다', () => {
    const long = `앞. “${'긴 대사가 이어집니다. '.repeat(200)}” 뒤.`;
    const requests = splitSupertonicRequests(long, 90);
    assert.ok(requests.length > 10);
    assert.ok(requests.every(request => request.length <= 90));
    const plan = requests.flatMap(request => planSupertonicSpeech(request, { dialogue: { voice: 'F2' } }));
    assert.equal(plan[0].voice, 'M1');
    assert.equal(plan.at(-1).voice, 'M1');
    assert.ok(plan.slice(1, -1).every(segment => segment.voice === 'F2'));
    assert.equal(plan.map(part => part.text).join('').replace(/\s/g, ''), long.replace(/[“”\s]/g, ''));
    assert.equal(plan.filter(part => part.pauseAfter).length, 1);
    assert.equal(plan.at(-2).pauseAfter, 0.45);
    assert.equal(planSupertonicSpeech(splitSupertonicRequests('“아직 끝나지 않은 대사')[0])[0].pauseAfter, undefined);
});

test('일반 문장과 대사에 음성 속도 쉼을 개별 적용하고 자동 구분을 끌 수 있다', () => {
    const reading = {
        narration: { voice: 'M2', speed: 0.9, pause: 0.4 },
        dialogue: { voice: 'F4', speed: 1.15, pause: 0.1 },
    };
    const plan = planSupertonicSpeech('들어왔다. “안녕!” 나갔다.', reading);
    assert.deepEqual(plan.map(part => [part.voice, part.speed, part.pause]), [
        ['M2', 0.9, 0.4], ['F4', 1.15, 0.1], ['M2', 0.9, 0.4],
    ]);
    const disabled = planSupertonicSpeech('그가 말했다. “안녕!” 나갔다.', { ...reading, dialogueEnabled: false });
    assert.equal(disabled.length, 1);
    assert.equal(disabled[0].text, '그가 말했다. 안녕! 나갔다.');
    assert.equal(disabled[0].voice, 'M2');
});

test('비명만 짧게 읽고 웃음 정상 단어와 주변 대사는 유지한다', () => {
    const text = '하하하하! 호호호. 크크크! 으아아아아악!!! 살려줘! 아악이라는 말. 아아아파트.';
    const plan = planSupertonicSpeech(text);
    assert.deepEqual(plan.map(part => [part.text, part.effect]), [
        ['하하하하! 호호호. 크크크!', false], ['으아악.', true],
        ['살려줘! 아악이라는 말. 아아아파트.', false],
    ]);
    assert.equal(plan[1].volume, 0.7);
    assert.equal(plan[1].maxSeconds, 2.5);
    assert.equal(plan[0].volume, 1);
    assert.equal(plan[0].maxSeconds, null);
    assert.equal(planSupertonicSpeech('Aaaaaah!')[0].effect, true);
    assert.equal(planSupertonicSpeech('あああああっ！')[0].text, 'あっ.');
});

test('원문 모드는 비명을 바꾸지 않고 생략 모드는 주변 문장과 웃음을 남긴다', () => {
    const original = planSupertonicSpeech('으아아아악!!!', { effectsMode: 'original' });
    assert.equal(original[0].text, '으아아아악!!!');
    assert.equal(original[0].volume, 1);
    const skipped = planSupertonicSpeech('하하하! 으아아아악!!! 도망쳐!', { effectsMode: 'skip' });
    assert.deepEqual(skipped.map(part => part.text), ['하하하! 도망쳐!']);
    assert.deepEqual(planSupertonicSpeech('으아아아악!!!', { effectsMode: 'skip' }), []);
});

test('음성 스타일은 정확한 텐서 크기와 유한한 숫자만 허용한다', () => {
    const data = {
        style_ttl: { dims: [1, 50, 256], data: Array(12800).fill(0.1) },
        style_dp: { dims: [1, 8, 16], data: Array(128).fill(0.2) },
    };
    assert.deepEqual(validateSupertonicStyle(data), data);
    assert.throws(() => validateSupertonicStyle({ ...data, style_dp: { dims: [1, 8, 16], data: [1] } }));
    assert.throws(() => validateSupertonicStyle({ ...data, style_dp: { dims: [1, 8, 16], data: Array(128).fill(Infinity) } }));
    const reading = normalizeSupertonicReading({ narration: { customStyle: { id: 'first', name: 'Voice', data } } });
    assert.equal(planSupertonicSpeech('Hello.', reading)[0].customStyle.id, 'first');
    assert.equal(supertonicReadingCacheKey(reading).includes('style_ttl'), false);
    const changed = { ...reading, narration: { ...reading.narration, customStyle: { ...reading.narration.customStyle, id: 'second' } } };
    assert.notEqual(supertonicReadingCacheKey(reading), supertonicReadingCacheKey(changed));
    const thought = normalizeSupertonicReading({ thought: { customStyle: { id: 'thought', name: 'Thought', data } } });
    assert.equal(planSupertonicSpeech("'생각.'", thought)[0].customStyle.id, 'thought');
    assert.equal(supertonicReadingCacheKey(thought).includes('style_ttl'), false);
    assert.notEqual(supertonicReadingCacheKey(thought), supertonicReadingCacheKey({ ...thought, thoughtEnabled: false }));
});
