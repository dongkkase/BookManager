import { IME_SYMBOL_GROUPS } from './imeSymbols.js';
import { EMOJI_GROUPS } from './emojiData.js';

const entries = (category, rows) => rows.map(([value, name, tones = false]) => ({ value, name, category, tones }));
export const SPECIAL_CHARACTERS = [
    ...entries('punctuation', [['…', '말줄임표 ellipsis'], ['—', '긴 대시 em dash'], ['–', '대시 en dash'], ['·', '가운뎃점 middle dot'], ['•', '불릿 bullet'], ['※', '참고 reference'], ['§', '절 section'], ['¶', '문단 paragraph'], ['†', '단검 dagger'], ['‡', '이중 단검 double dagger'], ['“', '여는 큰따옴표 left double quote'], ['”', '닫는 큰따옴표 right double quote'], ['‘', '여는 작은따옴표 left quote'], ['’', '닫는 작은따옴표 right quote']]),
    ...entries('brackets', [['「', '여는 낫표 corner bracket'], ['」', '닫는 낫표 corner bracket'], ['『', '여는 겹낫표 double corner'], ['』', '닫는 겹낫표 double corner'], ['〈', '여는 홑화살괄호 angle bracket'], ['〉', '닫는 홑화살괄호 angle bracket'], ['《', '여는 겹화살괄호 double angle'], ['》', '닫는 겹화살괄호 double angle'], ['【', '여는 검정 렌즈 괄호 black bracket'], ['】', '닫는 검정 렌즈 괄호 black bracket'], ['〔', '여는 대괄호 tortoise bracket'], ['〕', '닫는 대괄호 tortoise bracket']]),
    ...entries('math', [['±', '플러스 마이너스 plus minus'], ['×', '곱하기 multiply'], ['÷', '나누기 divide'], ['−', '빼기 minus'], ['≠', '같지 않음 not equal'], ['≈', '거의 같음 approximately'], ['≤', '작거나 같음 less equal'], ['≥', '크거나 같음 greater equal'], ['∞', '무한대 infinity'], ['√', '제곱근 square root'], ['∑', '합계 sum'], ['∫', '적분 integral'], ['∂', '편미분 partial'], ['∆', '델타 delta'], ['π', '파이 pi'], ['α', '알파 alpha'], ['β', '베타 beta'], ['θ', '세타 theta'], ['Ω', '오메가 omega'], ['µ', '마이크로 micro'], ['°', '도 degree'], ['½', '이분의 일 half'], ['¼', '사분의 일 quarter'], ['¾', '사분의 삼 three quarters']]),
    ...entries('arrows', [['←', '왼쪽 화살표 left arrow'], ['→', '오른쪽 화살표 right arrow'], ['↑', '위 화살표 up arrow'], ['↓', '아래 화살표 down arrow'], ['↔', '양쪽 화살표 left right'], ['↕', '상하 화살표 up down'], ['↗', '오른쪽 위 north east'], ['↘', '오른쪽 아래 south east'], ['⇒', '따라서 implies'], ['⇔', '동치 equivalent'], ['↩', '되돌림 return'], ['↪', '넘김 return right']]),
    ...entries('currency', [['₩', '원 won'], ['€', '유로 euro'], ['£', '파운드 pound'], ['¥', '엔 yen'], ['¢', '센트 cent'], ['₹', '루피 rupee'], ['₽', '루블 ruble'], ['₿', '비트코인 bitcoin'], ['©', '저작권 copyright'], ['®', '등록 상표 registered'], ['™', '상표 trademark'], ['℗', '음반 저작권 sound copyright']]),
    ...entries('symbols', [['☆', '빈 별 star'], ['★', '별 black star'], ['○', '빈 동그라미 circle'], ['●', '동그라미 black circle'], ['□', '빈 네모 square'], ['■', '네모 black square'], ['△', '빈 삼각형 triangle'], ['▲', '삼각형 black triangle'], ['◇', '빈 마름모 diamond'], ['◆', '마름모 black diamond'], ['✓', '체크 check'], ['✕', '가위표 cross'], ['♠', '스페이드 spade'], ['♣', '클로버 club'], ['♥', '하트 heart'], ['♦', '다이아 diamond'], ['♪', '음표 music note'], ['♫', '연결 음표 music notes']]),
    ...entries('letters', [['é', '악센트 e acute'], ['è', '악센트 e grave'], ['ê', '악센트 e circumflex'], ['ä', '움라우트 a umlaut'], ['ö', '움라우트 o umlaut'], ['ü', '움라우트 u umlaut'], ['ñ', '물결 n tilde'], ['ç', '세디유 c cedilla'], ['ß', '독일어 sharp s'], ['æ', '합자 ae'], ['œ', '합자 oe'], ['ø', '빗금 o slash']]),
];
const specialCharacterIndex = new Map(SPECIAL_CHARACTERS.map(entry => [entry.value, entry]));
for (const group of IME_SYMBOL_GROUPS) {
    for (const [value, name] of group.characters) {
        let entry = specialCharacterIndex.get(value);
        if (!entry) {
            entry = { value, name, category: group.category, tones: false };
            specialCharacterIndex.set(value, entry);
            SPECIAL_CHARACTERS.push(entry);
        }
        entry.imeKeys = [...(entry.imeKeys || []), group.key];
        entry.categories = [...new Set([...(entry.categories || [entry.category]), group.category])];
        entry.keywords = `${entry.keywords || ''} ${group.keywords}`.trim();
    }
}

const COMMON_EMOJI_CHARACTERS = [
    ...entries('faces', [['😀', '웃음 grinning smile'], ['😃', '활짝 웃음 smile'], ['😄', '미소 happy'], ['😁', '환한 웃음 grin'], ['😂', '웃픈 눈물 joy tears'], ['🤣', '박장대소 laughing'], ['😊', '수줍음 blush smile'], ['🙂', '미소 slightly smiling'], ['😉', '윙크 wink'], ['😍', '하트 눈 사랑 heart eyes love'], ['🥰', '사랑스러운 loving'], ['😘', '키스 kiss'], ['😎', '선글라스 cool'], ['🤔', '생각 thinking'], ['😐', '무표정 neutral'], ['😮', '놀람 surprised'], ['😢', '슬픔 crying'], ['😭', '울음 sob'], ['😡', '화남 angry'], ['🥺', '부탁 pleading'], ['😴', '잠 sleep'], ['🤗', '포옹 hug'], ['🤩', '별 눈 star struck'], ['🥳', '파티 party']]),
    ...entries('people', [['👍', '엄지 척 thumbs up', true], ['👎', '엄지 아래 thumbs down', true], ['👏', '박수 clap', true], ['🙌', '만세 raised hands', true], ['🙏', '감사 기도 pray thanks', true], ['👋', '인사 wave', true], ['✌️', '브이 victory', true], ['🤞', '행운 crossed fingers', true], ['💪', '근육 힘 muscle', true], ['👌', '좋아 okay', true], ['🤝', '악수 handshake'], ['🧑', '사람 person', true], ['👩', '여자 woman', true], ['👨', '남자 man', true], ['👶', '아기 baby', true], ['🧑‍💻', '개발자 technologist'], ['🧑‍🎓', '학생 student'], ['🧑‍🚀', '우주비행사 astronaut']]),
    ...entries('nature', [['🐶', '강아지 dog'], ['🐱', '고양이 cat'], ['🐭', '쥐 mouse'], ['🐰', '토끼 rabbit'], ['🦊', '여우 fox'], ['🐻', '곰 bear'], ['🐼', '판다 panda'], ['🐨', '코알라 koala'], ['🦁', '사자 lion'], ['🐯', '호랑이 tiger'], ['🐸', '개구리 frog'], ['🦋', '나비 butterfly'], ['🐝', '벌 bee'], ['🐳', '고래 whale'], ['🌸', '벚꽃 cherry blossom'], ['🌹', '장미 rose'], ['🌻', '해바라기 sunflower'], ['🌿', '풀 herb'], ['🍀', '행운 클로버 clover'], ['🌳', '나무 tree']]),
    ...entries('food', [['🍎', '사과 apple'], ['🍊', '귤 orange'], ['🍋', '레몬 lemon'], ['🍌', '바나나 banana'], ['🍉', '수박 watermelon'], ['🍇', '포도 grapes'], ['🍓', '딸기 strawberry'], ['🍒', '체리 cherry'], ['🍑', '복숭아 peach'], ['🍕', '피자 pizza'], ['🍔', '햄버거 burger'], ['🍜', '국수 라면 noodles'], ['🍚', '밥 rice'], ['🍰', '케이크 cake'], ['🍫', '초콜릿 chocolate'], ['☕', '커피 coffee'], ['🍵', '차 tea'], ['🥤', '음료 drink']]),
    ...entries('travel', [['🚗', '자동차 car'], ['🚌', '버스 bus'], ['🚆', '기차 train'], ['✈️', '비행기 airplane'], ['🚀', '로켓 rocket'], ['🚲', '자전거 bicycle'], ['⛵', '배 sailboat'], ['🏠', '집 house'], ['🏫', '학교 school'], ['🏖️', '해변 beach'], ['🏔️', '산 mountain'], ['🌍', '지구 earth'], ['☀️', '태양 sun'], ['🌙', '달 moon'], ['⭐', '별 star'], ['🌈', '무지개 rainbow'], ['☁️', '구름 cloud'], ['❄️', '눈 snow']]),
    ...entries('objects', [['📚', '책 books'], ['📖', '펼친 책 open book'], ['✏️', '연필 pencil'], ['🖋️', '만년필 fountain pen'], ['📝', '메모 memo'], ['💡', '전구 아이디어 idea'], ['🔍', '검색 돋보기 search'], ['💻', '노트북 computer'], ['📱', '휴대폰 phone'], ['🎧', '헤드폰 headphones'], ['🎵', '음악 music'], ['🎬', '영화 movie'], ['📷', '카메라 camera'], ['🎁', '선물 gift'], ['🎈', '풍선 balloon'], ['🏆', '트로피 trophy'], ['⚽', '축구 soccer'], ['🎮', '게임 game']]),
    ...entries('hearts', [['❤️', '빨간 하트 red heart love'], ['🧡', '주황 하트 orange heart'], ['💛', '노란 하트 yellow heart'], ['💚', '초록 하트 green heart'], ['💙', '파란 하트 blue heart'], ['💜', '보라 하트 purple heart'], ['🖤', '검은 하트 black heart'], ['🤍', '흰 하트 white heart'], ['🤎', '갈색 하트 brown heart'], ['💔', '깨진 하트 broken heart'], ['💕', '두 하트 two hearts'], ['💖', '반짝 하트 sparkling heart'], ['✨', '반짝 sparkle'], ['🔥', '불 fire'], ['💯', '백점 hundred'], ['✅', '체크 check mark'], ['❌', '엑스 cross'], ['❗', '느낌표 exclamation'], ['❓', '물음표 question'], ['🎉', '축하 축포 celebration']]),
];
export const SKIN_TONES = ['', '🏻', '🏼', '🏽', '🏾', '🏿'];
const toneNames = ['', '밝은 피부색 light skin tone', '약간 밝은 피부색 medium-light skin tone', '중간 피부색 medium skin tone', '약간 어두운 피부색 medium-dark skin tone', '어두운 피부색 dark skin tone'];
const emojiAliases = { '🇰🇷': '한국 태극기 Korea KR', '🇺🇸': '성조기 USA US', '🇬🇧': '유니언잭 UK GB', '🇯🇵': '일장기 JP' };
const commonEmojiIndex = new Map(COMMON_EMOJI_CHARACTERS.map((entry, index) => [entry.value, { ...entry, index }]));
export const EMOJI_CHARACTERS = EMOJI_GROUPS.flatMap(group => group.characters.map(([value, name, keywords, variants = []]) => ({
    value, name, category: group.category, keywords: `${keywords} ${commonEmojiIndex.get(value)?.name || ''} ${emojiAliases[value] || ''}${group.category === 'flags' ? ' 국기 깃발' : ''}`, variants,
    tones: variants.length > 0,
    toneValues: Object.fromEntries(SKIN_TONES.slice(1).flatMap(tone => {
        const variant = variants.find(item => [...item].filter(character => SKIN_TONES.slice(1).includes(character)).every(character => character === tone));
        return variant ? [[tone, variant]] : [];
    })),
}))).sort((a, b) => (commonEmojiIndex.get(a.value)?.index ?? Number.MAX_SAFE_INTEGER) - (commonEmojiIndex.get(b.value)?.index ?? Number.MAX_SAFE_INTEGER));
export const ALL_EMOJI_CHARACTERS = EMOJI_CHARACTERS.flatMap(entry => [entry, ...entry.variants.map(value => ({
    value, category: entry.category, tones: false, keywords: entry.keywords,
    name: `${entry.name} · ${[...value].filter(character => SKIN_TONES.slice(1).includes(character)).map(character => toneNames[SKIN_TONES.indexOf(character)]).join(' · ')}`,
}))]);

export function characterValue(entry, tone = '') {
    return entry.tones ? entry.toneValues?.[tone] || entry.value : entry.value;
}

export function characterDisplay(entry, tone = '') {
    return entry.value === '\u3000' ? '␣' : entry.value === '\u00ad' ? 'SHY' : characterValue(entry, tone);
}

export function filterCharacters(catalog, query, category = 'all') {
    let needle = query.trim().toLocaleLowerCase();
    const key = needle.replace(/\s/g, '').match(/^([ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅊㅋㅌㅍㅎ])(?:\+?(?:한자|hanja))?$/)?.[1];
    const groupKey = category.startsWith('ime:') ? category.slice(4) : category === 'all' ? key : null;
    const group = catalog === SPECIAL_CHARACTERS && IME_SYMBOL_GROUPS.find(item => item.key === groupKey);
    if (group && key === group.key) needle = '';
    const index = group && new Map(catalog.map(entry => [entry.value, entry]));
    const candidates = group ? group.characters.map(([value]) => index.get(value)).filter(Boolean) : catalog;
    return candidates.filter(entry => (group || category === 'all' || (entry.categories || [entry.category]).includes(category)) &&
        `${entry.value} ${entry.name} ${entry.category} ${entry.keywords || ''} ${entry.variants?.join(' ') || ''} U+${entry.value.codePointAt(0).toString(16).padStart(4, '0')}`.toLocaleLowerCase().includes(needle));
}
