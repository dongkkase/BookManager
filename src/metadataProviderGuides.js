export const METADATA_PROVIDER_GUIDES = {
    '리디북스': {
        text: {
            ko: 'API 키 없이 리디의 공개 도서 목록을 검색합니다. 소스를 활성화하고 적용한 뒤 제목이나 저자로 검색하세요. 서비스 변경이나 접근 제한으로 검색이 실패할 수 있습니다.',
            en: 'Search Ridi’s public book catalog without an API key. Enable this source, apply your settings, then search by title or author. Service changes or access restrictions may prevent searches.',
            ja: 'APIキーなしでリディの公開書籍一覧を検索します。このソースを有効にして設定を適用した後、タイトルや著者で検索してください。仕様変更やアクセス制限で検索できない場合があります。',
        },
        url: 'https://ridibooks.com/',
    },
    '문피아': {
        text: {
            ko: 'API 키 없이 문피아의 웹소설을 검색합니다. 소스를 활성화하고 적용한 뒤 작품명으로 검색하세요. 작품에 등록된 저자, 소개, 장르와 표지를 가져옵니다.',
            en: 'Search Munpia web novels without an API key. Enable this source, apply your settings, then search by title to retrieve the listed author, description, genres and cover.',
            ja: 'APIキーなしでムンピアのウェブ小説を検索します。このソースを有効にして設定を適用した後、作品名で検索すると、登録された著者、紹介文、ジャンル、表紙を取得できます。',
        },
        url: 'https://www.munpia.com/',
    },
    '한국웹툰': {
        text: {
            ko: 'API 키 없이 한국 웹툰의 공개 작품 정보를 검색합니다. 소스를 활성화하고 적용한 뒤 만화 검색에서 작품명을 입력하세요. 작품에 등록된 글·그림 작가, 소개와 표지를 가져옵니다.',
            en: 'Search public Korean webtoon information without an API key. Enable this source, apply your settings, then enter a title in comic search to retrieve the listed writers, artists, description and cover.',
            ja: 'APIキーなしで韓国ウェブトゥーンの公開作品情報を検索します。このソースを有効にして設定を適用した後、漫画検索で作品名を入力すると、登録された原作者、作画担当、紹介文、表紙を取得できます。',
        },
        url: 'https://www.kmas.or.kr/',
    },
    YES24: {
        text: {
            ko: '예스24 Developers에 로그인하고 API Key 신청에서 활용 목적과 설명을 입력해 키를 발급받으세요. 발급한 값을 API Key 입력란에 붙여 넣고 적용합니다. 발급한 키는 API Keys 페이지에서 다시 확인할 수 있습니다.',
            en: 'Sign in to YES24 Developers and request an API key, providing its purpose and description. Paste the issued value into the API Key field and apply. You can find existing keys on the API Keys page.',
            ja: 'YES24 Developersにログインし、API Key申請で利用目的と説明を入力してキーを取得してください。発行された値をAPI Key欄に貼り付けて適用します。発行済みのキーはAPI Keysページで確認できます。',
        },
        url: 'https://developers.yes24.com/docs/apikey',
        registrationUrl: 'https://developers.yes24.com/apply',
    },
    '알라딘': {
        text: {
            ko: '신규 TTBKey 발급은 종료되었습니다. 기존 키는 아래 링크에서 확인한 뒤 입력하고 적용하세요. 알라딘 OpenAPI 서비스는 2026년 10월 30일 종료 예정입니다.',
            en: 'New TTBKey issuance has ended. Use the link below to check an existing key, enter it, and apply. Aladin OpenAPI is scheduled to close on October 30, 2026.',
            ja: 'TTBKeyの新規発行は終了しました。下のリンクで既存のキーを確認し、入力して適用してください。Aladin OpenAPIは2026年10月30日に終了予定です。',
        },
        url: 'https://blog.aladin.co.kr/openapi/6695306',
        registrationUrl: 'https://www.aladin.co.kr/ttb/wblog_manage.aspx',
        registrationLabel: {
            ko: '기존 TTBKey 확인',
            en: 'View existing TTBKey',
            ja: '既存のTTBKeyを確認',
        },
    },
    'Google Books': {
        text: {
            ko: 'Google Cloud Console에서 프로젝트를 선택하고 Books API를 사용 설정하세요. 사용자 인증 정보에서 API 키를 만든 뒤 API Key 입력란에 붙여 넣고 적용합니다. 이 검색에는 OAuth 클라이언트 ID 대신 API 키를 사용합니다.',
            en: 'Select a project in Google Cloud Console and enable the Books API. Create an API key under Credentials, paste it into the API Key field, and apply. This search uses an API key, rather than an OAuth client ID.',
            ja: 'Google Cloud Consoleでプロジェクトを選択し、Books APIを有効にしてください。「認証情報」でAPIキーを作成し、API Key欄に貼り付けて適用します。この検索ではOAuthクライアントIDではなくAPIキーを使用します。',
        },
        url: 'https://developers.google.com/books/docs/v1/using#APIKey',
        registrationUrl: 'https://console.cloud.google.com/apis/credentials',
    },
    Anilist: {
        text: {
            ko: 'API 키 없이 AniList의 만화 정보를 검색합니다. 소스를 활성화하고 적용한 뒤 작품명으로 검색하세요. 등록된 제목, 작가, 장르, 평점과 표지를 가져옵니다.',
            en: 'Search AniList manga information without an API key. Enable this source, apply your settings, then search by title to retrieve listed titles, creators, genres, ratings and covers.',
            ja: 'APIキーなしでAniListの漫画情報を検索します。このソースを有効にして設定を適用した後、作品名で検索すると、登録されたタイトル、作者、ジャンル、評価、表紙を取得できます。',
        },
        url: 'https://anilist.co/',
    },
    Vine: {
        text: {
            ko: 'Comic Vine API 페이지에서 발급받은 API Key를 입력하고 적용하세요. 만화 시리즈(Volume)의 제목, 출판사, 소개와 표지를 검색합니다.',
            en: 'Enter the API key issued through the Comic Vine API page and apply. Searches retrieve comic volume titles, publishers, descriptions and covers.',
            ja: 'Comic Vine APIページで発行されたAPI Keyを入力して適用してください。漫画シリーズ（Volume）のタイトル、出版社、紹介文、表紙を検索します。',
        },
        url: 'https://comicvine.gamespot.com/api/',
        registrationUrl: 'https://comicvine.gamespot.com/api/',
    },
    Goodreads: {
        guideKey: 'metadata_provider_guide_goodreads',
        url: 'https://www.goodreads.com/',
    },
    Hardcover: {
        guideKey: 'metadata_provider_guide_hardcover',
        url: 'https://hardcover.app/account/api',
        registrationUrl: 'https://hardcover.app/account/api',
    },
    'Open Library': {
        guideKey: 'metadata_provider_guide_openlibrary',
        url: 'https://openlibrary.org/dev/docs/api/search',
    },
    iTunes: {
        guideKey: 'metadata_provider_guide_itunes',
        url: 'https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/Searching.html',
    },
    Kobo: {
        guideKey: 'metadata_provider_guide_kobo',
        url: 'https://www.kobo.com/',
    },
    LubimyCzytac: {
        guideKey: 'metadata_provider_guide_lubimyczytac',
        url: 'https://lubimyczytac.pl/',
    },
    RanobeDB: {
        guideKey: 'metadata_provider_guide_ranobedb',
        url: 'https://ranobedb.org/',
    },
    Amazon: {
        text: {
            ko: 'API 키 없이 Amazon.com의 공개 도서 목록을 검색합니다. 소스를 활성화하고 적용한 뒤 제목으로 검색하세요. 페이지 변경이나 접근 제한으로 검색이 실패할 수 있습니다.',
            en: 'Search Amazon.com’s public book catalog without an API key. Enable this source, apply your settings, then search by title. Page changes or access restrictions may prevent searches.',
            ja: 'APIキーなしでAmazon.comの公開書籍一覧を検索します。このソースを有効にして設定を適用した後、タイトルで検索してください。ページ変更やアクセス制限で検索できない場合があります。',
        },
        url: 'https://www.amazon.com/',
    },
    Audible: {
        guideKey: 'metadata_provider_guide_audible',
        url: 'https://www.audible.com/',
    },
    AudNexus: {
        guideKey: 'metadata_provider_guide_audnexus',
        url: 'https://audnex.us/',
    },
    'Libro.fm': {
        guideKey: 'metadata_provider_guide_librofm',
        url: 'https://libro.fm/',
    },
};
