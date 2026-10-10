import assert from 'node:assert/strict';
import test from 'node:test';
import { parseKmasDetailHtml } from './kmasDetail.js';

const detailHtml = `
    <div class="detail-basic with-img">
        <div class="vd-image cd-marker-t1">
            <img src="/common/file/atchmnflDownload.ajax?fileImageId=cover&amp;type=webtoon" alt="나 혼자 부활한다">
        </div>
        <div class="vd-basic-con">
            <h3><strong>나 혼자 부활한다</strong></h3>
            <div class="dv-table w100p vd-table">
                <dl><dt>그림작가</dt><dd>스튜디오 크힛</dd></dl>
                <dl><dt>글작가</dt><dd><a>앵무새</a></dd></dl>
                <dl><dt>연재매체</dt><dd>카카오페이지</dd></dl>
                <dl><dt>연재기간</dt><dd>2024-08-14 ~ 연재 중</dd></dl>
                <dl><dt>대표장르</dt><dd>판타지</dd></dl>
                <dl><dt>서비스</dt><dd><a>웹툰 보러가기</a></dd></dl>
            </div>
        </div>
    </div>
    <div id="wbtn_episode_div"></div>
    <div class="detail-basic with-fold">
        <h3 class="on">작품 줄거리</h3>
        <div class="detail-con add-padd">
            『고유능력: 부활』
            <br/>
            <br/>&quot;뭐지?&quot; &amp; &#xBD80;활
            <br/>오늘도 나 혼자 부활한다!
        </div>
    </div>
    <div class="detail-basic with-fold">
        <h3 class="on">대표작가 정보</h3>
        <div class="detail-con"><div><h3>다른 작품</h3>
            <dl><dt>글작가</dt><dd>다른 작가</dd></dl>
            <img src="/wrong-cover.jpg">
        </div></div>
    </div>`;

test('한국웹툰 상세에서 작품 정보와 줄거리를 읽고 작가 정보 영역은 제외한다', () => {
    assert.deepEqual(parseKmasDetailHtml(detailHtml), {
        Title: '나 혼자 부활한다',
        Series: '나 혼자 부활한다',
        LocalizedSeries: '나 혼자 부활한다',
        Writer: '앵무새',
        Penciller: '스튜디오 크힛',
        Publisher: '카카오페이지',
        Summary: '『고유능력: 부활』\n\n"뭐지?" & 부활\n오늘도 나 혼자 부활한다!',
        Genre: '판타지',
        CoverUrl: 'https://www.kmas.or.kr/common/file/atchmnflDownload.ajax?fileImageId=cover&type=webtoon',
        PubDate: '2024-08-14',
        Year: '2024',
        Month: '8',
        Day: '14',
        Notes: '연재기간: 2024-08-14 ~ 연재 중',
    });
});

test('한국웹툰 상세의 누락 정보는 추측하지 않고 빈 값으로 둔다', () => {
    const html = `<div class='detail-basic with-img'><h3><strong>제목 &lt;외전&gt;</strong></h3></div>
        <div class='detail-basic with-fold'><h3>대표작가 정보</h3><div class='detail-con'>작가 소개</div></div>`;
    const result = parseKmasDetailHtml(html);
    assert.equal(result.Title, '제목 <외전>');
    for (const field of ['Writer', 'Penciller', 'Publisher', 'Genre', 'CoverUrl', 'Summary', 'PubDate', 'Year', 'Month', 'Day', 'Notes']) {
        assert.equal(result[field], '');
    }
});

test('한국웹툰 오류 페이지와 제목이 없는 상세는 빈 결과를 반환한다', () => {
    assert.deepEqual(parseKmasDetailHtml(), {});
    assert.deepEqual(parseKmasDetailHtml('<h3>접근 오류</h3><dl><dt>글작가</dt><dd>오류</dd></dl>'), {});
    assert.deepEqual(parseKmasDetailHtml('<div class="detail-basic with-img"><div>잘못된 응답</div></div>'), {});
    assert.deepEqual(parseKmasDetailHtml(`<script>const template = '<div class="detail-basic with-img"><h3>가짜 제목</h3></div>';</script>`), {});
});

test('한국웹툰 상세의 기본 표지와 유효하지 않은 날짜는 메타데이터에 넣지 않는다', () => {
    const html = detailHtml.replace('/common/file/atchmnflDownload.ajax?fileImageId=cover&amp;type=webtoon', '/htmlService/Images/Common/noimages.png')
        .replace('2024-08-14 ~ 연재 중', '2024-02-30 ~ 연재 중');
    const result = parseKmasDetailHtml(html);
    assert.equal(result.CoverUrl, '');
    assert.equal(result.PubDate, '');
    assert.equal(result.Year, '');
    assert.equal(result.Notes, '연재기간: 2024-02-30 ~ 연재 중');
    assert.equal(parseKmasDetailHtml(detailHtml.replace('/common/file/atchmnflDownload.ajax?fileImageId=cover&amp;type=webtoon', 'javascript:alert(1)')).CoverUrl, '');
});
