import { createProject, validateProject, inspectProject, walkDocument, newId, projectError } from './model.js';

export const TEMPLATE_CHAPTER = 'c_template';
export const MAX_TEMPLATE_BYTES = 1024 * 1024;
export const MAX_TEMPLATE_LIBRARY_BYTES = 16 * 1024 * 1024;
export const MAX_CONTENT_TEMPLATES = 100;

const copy = value => structuredClone(value);
const text = value => ({ type: 'text', text: value });
const p = (value, attrs = {}) => ({ type: 'paragraph', attrs: { firstLineIndent: 0, ...attrs }, ...(value ? { content: [text(value)] } : {}) });
const h = (value, level = 1) => ({ type: 'heading', attrs: { level, firstLineIndent: 0 }, content: [text(value)] });
const list = values => ({ type: 'bulletList', content: values.map(value => ({ type: 'listItem', content: [p(value)] })) });
const row = (values, header = false) => ({ type: 'tableRow', content: values.map(value => ({ type: header ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [p(value)] })) });

export function builtinContentTemplates(language = 'ko') {
    const lang = language.startsWith('ja') ? 2 : language.startsWith('ko') ? 0 : 1;
    const t = (ko, en, ja) => [ko, en, ja][lang];
    const definitions = [
        ['title', t('표제지', 'Title page', '扉'), t('책 제목·부제·저자·출판사', 'Title, subtitle, author and publisher', '書名・副題・著者・出版社'), [
            { ...h(t('책 제목', 'Book title', '書名')), attrs: { level: 1, textAlign: 'center', firstLineIndent: 0 } },
            p(t('부제를 입력하세요', 'Enter a subtitle', '副題を入力'), { blockStyle: 'subtitle', textAlign: 'center' }),
            { type: 'horizontalRule' }, p(t('저자 이름', 'Author name', '著者名'), { textAlign: 'center' }), p(t('출판사', 'Publisher', '出版社'), { textAlign: 'center' }),
        ]],
        ['copyright', t('판권', 'Copyright page', '奥付'), t('발행 정보와 권리 안내', 'Publication details and rights', '発行情報と権利の案内'), [
            h(t('판권', 'Publication details', '奥付')), p(t('책 제목: [제목]', 'Title: [title]', '書名：[書名]')), p(t('지은이: [이름]', 'Author: [name]', '著者：[名前]')),
            p(t('발행처: [출판사]', 'Publisher: [publisher]', '発行元：[出版社]')), p(t('발행일: [날짜]', 'Published: [date]', '発行日：[日付]')), p('ISBN: [ISBN]'),
            { type: 'horizontalRule' }, p('© [year] [name]'), p(t('이 책의 이용 및 저작권 안내를 입력하세요.', 'Enter the permissions and copyright notice for this book.', '本書の利用条件と著作権表示を入力してください。'), { blockStyle: 'note' }),
        ]],
        ['preface', t('머리말', 'Preface', 'はじめに'), t('집필 취지·독자 안내·서명', 'Purpose, reader guidance and signature', '執筆の目的・読者への案内・署名'), [
            h(t('머리말', 'Preface', 'はじめに')), p(t('이 책을 쓰게 된 이야기를 들려주세요.', 'Tell the story behind this book.', 'この本を書くきっかけを紹介してください。'), { blockStyle: 'lead' }),
            p(t('독자에게 전하고 싶은 내용과 책을 읽는 방법을 적어보세요.', 'Describe what readers will discover and how to use the book.', '読者に伝えたいことと本の読み方を書いてください。')),
            p(t('[날짜] · [저자]', '[date] · [author]', '[日付]・[著者]'), { blockStyle: 'signature' }),
        ]],
        ['chapter', t('장 시작', 'Chapter opening', '章の始まり'), t('장 제목·도입문·소제목', 'Chapter title, introduction and section', '章題・導入文・小見出し'), [
            p('CHAPTER 01', { blockStyle: 'subtitle' }), h(t('장 제목', 'Chapter title', '章のタイトル')),
            p(t('이번 장을 소개하는 문장을 입력하세요.', 'Introduce this chapter in a few words.', 'この章を紹介する文章を入力してください。'), { blockStyle: 'lead' }),
            { type: 'horizontalRule' }, h(t('소제목', 'Section title', '小見出し'), 2), p(t('이곳에서 본문을 시작하세요.', 'Start writing here.', 'ここから本文を書き始めてください。')),
        ]],
        ['quote', t('인용문', 'Quotation', '引用'), t('인용문과 출처', 'Quotation and attribution', '引用文と出典'), [
            { type: 'blockquote', content: [p(t('인용할 문장을 입력하세요.', 'Enter a quotation.', '引用する文章を入力してください。'))] },
            p(t('— 저자, 작품명', '— Author, work', '— 著者、作品名'), { blockStyle: 'signature' }),
        ]],
        ['summary', t('핵심 정리', 'Key takeaways', '要点のまとめ'), t('요약과 실천 목록', 'Summary and action points', 'まとめと実践項目'), [
            h(t('핵심 정리', 'Key takeaways', '要点のまとめ'), 2), p(t('가장 중요한 내용을 한 문장으로 정리하세요.', 'Summarize the main idea in one sentence.', '最も大切な内容を一文でまとめてください。'), { blockStyle: 'note' }),
            list([t('첫 번째 핵심 내용', 'First takeaway', '一つ目の要点'), t('두 번째 핵심 내용', 'Second takeaway', '二つ目の要点'), t('실천해 볼 일', 'An action to try', '実践してみること')]),
        ]],
        ['comparison', t('비교표', 'Comparison table', '比較表'), t('항목별 두 대상 비교', 'Compare two options by criteria', '項目ごとに二つの対象を比較'), [
            h(t('한눈에 비교하기', 'Compare at a glance', 'ひと目で比較'), 2), { type: 'table', content: [
                row([t('항목', 'Criteria', '項目'), t('대상 A', 'Option A', '対象A'), t('대상 B', 'Option B', '対象B')], true),
                row([t('특징', 'Features', '特徴'), '…', '…']), row([t('장점', 'Strengths', '長所'), '…', '…']), row([t('고려할 점', 'Considerations', '検討事項'), '…', '…']),
            ] }, p(t('표의 출처 또는 설명을 입력하세요.', 'Enter the source or a description of the table.', '表の出典または説明を入力してください。'), { blockStyle: 'subtitle' }),
        ]],
        ['qa', t('질문과 답변', 'Questions and answers', '質問と回答'), t('질문·답변을 반복하는 구성', 'A reusable question and answer pair', '質問と回答を繰り返す構成'), [
            h(t('자주 묻는 질문', 'Frequently asked questions', 'よくある質問'), 2), h(t('Q. 질문을 입력하세요', 'Q. Enter a question', 'Q. 質問を入力してください'), 3),
            p(t('A. 답변을 입력하세요.', 'A. Enter an answer.', 'A. 回答を入力してください。')), { type: 'horizontalRule' },
        ]],
        ['author', t('저자 소개', 'About the author', '著者紹介'), t('약력·주요 작품·연락처', 'Biography, selected works and contact', '略歴・主な作品・連絡先'), [
            h(t('저자 소개', 'About the author', '著者紹介')), p(t('저자 이름', 'Author name', '著者名'), { blockStyle: 'lead' }),
            p(t('저자의 활동과 관심 분야를 소개하세요.', 'Introduce the author’s work and interests.', '著者の活動と関心のある分野を紹介してください。')),
            h(t('주요 작품', 'Selected works', '主な作品'), 2), list([t('작품명 · 발행 연도', 'Title · publication year', '作品名・発行年')]), p(t('웹사이트 또는 연락처', 'Website or contact', 'ウェブサイトまたは連絡先')),
        ]],
        ['references', t('참고문헌', 'References', '参考文献'), t('책·논문·웹 자료 출처', 'Books, papers and web sources', '書籍・論文・ウェブ資料の出典'), [
            h(t('참고문헌', 'References', '参考文献')), list([
                t('[저자] ([연도]). [도서명]. [출판사].', '[Author] ([year]). [Book title]. [Publisher].', '[著者]（[年]）。[書名]。[出版社]。'),
                t('[저자] ([연도]). [논문명]. [학술지], [권호], [쪽].', '[Author] ([year]). [Paper title]. [Journal], [volume], [pages].', '[著者]（[年]）。[論文名]。[学術誌]、[巻号]、[頁]。'),
                t('[작성자]. [웹 자료 제목]. [URL]. [접속일].', '[Author]. [Web page title]. [URL]. [Access date].', '[作成者]。[ウェブ資料の題名]。[URL]。[閲覧日]。'),
            ]),
        ]],
    ];
    return definitions.map(([id, name, description, content]) => ({ id: `builtin-${id}`, name, description, content: { type: 'doc', content }, assets: [], builtin: true }));
}

export function templateAssetIds(content) {
    const ids = new Set();
    walkDocument(content, node => {
        if (['image', 'audio'].includes(node.type)) ids.add(node.attrs.assetId);
        for (const mark of node.marks || []) if (mark.type === 'textStyle' && mark.attrs?.fontFamily?.startsWith('font-')) ids.add(mark.attrs.fontFamily.slice(5));
    });
    return ids;
}

export function remapTemplateAssets(content, mapping) {
    const result = copy(content);
    walkDocument(result, node => {
        if (['image', 'audio'].includes(node.type) && mapping.has(node.attrs.assetId)) node.attrs.assetId = mapping.get(node.attrs.assetId);
        for (const mark of node.marks || []) {
            const font = mark.type === 'textStyle' && mark.attrs?.fontFamily;
            if (typeof font === 'string' && font.startsWith('font-') && mapping.has(font.slice(5))) mark.attrs.fontFamily = `font-${mapping.get(font.slice(5))}`;
        }
    });
    return result;
}

// Only links whose destination travels with the template remain chapter links.
export function prepareTemplateContent(content, sourceChapterId = TEMPLATE_CHAPTER, destinationChapterId = TEMPLATE_CHAPTER) {
    const result = copy(content);
    const ids = new Map();
    let removedLinks = 0;
    walkDocument(result, node => {
        if (node.attrs?.id) { const id = newId(); ids.set(node.attrs.id, id); node.attrs.id = id; }
    });
    walkDocument(result, node => {
        if (!node.marks) return;
        node.marks = node.marks.filter(mark => {
            if (mark.type !== 'link' || !mark.attrs?.href?.startsWith('epub:')) return true;
            const [chapter, anchor] = mark.attrs.href.slice(5).split('#');
            if (chapter !== sourceChapterId || !anchor || !ids.has(anchor)) { removedLinks += 1; return false; }
            mark.attrs.href = `epub:${destinationChapterId}#${ids.get(anchor)}`;
            return true;
        });
    });
    return { content: result, removedLinks };
}

export function validateContentTemplate(item, checkReferences = true) {
    if (!item || typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 80 || typeof item.description !== 'string' || item.description.length > 240 ||
        (item.id != null && !/^tpl_[a-f0-9-]{36}$/.test(item.id)) || !Array.isArray(item.assets) || item.assets.length > 100) throw projectError('TEMPLATE_INVALID');
    if (new TextEncoder().encode(JSON.stringify(item.content)).length > MAX_TEMPLATE_BYTES) throw projectError('TEMPLATE_TOO_LARGE');
    const project = createProject('blank', 'en');
    project.chapters = [{ ...project.chapters[0], id: TEMPLATE_CHAPTER, content: item.content }];
    project.assets = item.assets;
    validateProject(project);
    const error = checkReferences && inspectProject(project).find(issue => issue.severity === 'error');
    if (error) throw projectError(error.code);
    return { ...(item.id ? { id: item.id } : {}), name: item.name.trim(), description: item.description.trim(), content: copy(item.content), assets: copy(item.assets) };
}
