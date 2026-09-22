import { getCurrentLanguage } from '../../../utils/i18n';

const messages = {
    resize: ['크기 조절', 'Resize', 'サイズ変更'], crop: ['자르기', 'Crop', '切り抜き'], effects: ['효과', 'Effects', '効果'], masks: ['모자이크', 'Mosaic', 'モザイク'], border: ['테두리', 'Border', '枠線'],
    width: ['너비 (px)', 'Width (px)', '幅 (px)'], height: ['높이 (px)', 'Height (px)', '高さ (px)'], lockRatio: ['가로·세로 비율 유지', 'Keep aspect ratio', '縦横比を固定'],
    reset: ['재설정', 'Reset', 'リセット'], resetAll: ['모두 재설정', 'Reset all', 'すべてリセット'], original: ['원본', 'Original', '元の画像'], free: ['자유', 'Free', '自由'],
    rotate: ['90° 회전', 'Rotate 90°', '90°回転'], flipX: ['좌우 반전', 'Flip horizontally', '左右反転'], flipY: ['상하 반전', 'Flip vertically', '上下反転'],
    cropHint: ['사진 위를 드래그하거나 모서리를 움직여 자를 영역을 지정하세요.', 'Drag on the image or move a corner to select the crop.', '画像上をドラッグするか角を動かし、切り抜く範囲を指定します。'],
    cropX: ['가로 위치 (%)', 'Horizontal position (%)', '横位置 (%)'], cropY: ['세로 위치 (%)', 'Vertical position (%)', '縦位置 (%)'], cropWidth: ['자르기 너비 (%)', 'Crop width (%)', '切り抜き幅 (%)'], cropHeight: ['자르기 높이 (%)', 'Crop height (%)', '切り抜き高さ (%)'],
    filters: ['필터', 'Filters', 'フィルター'], adjustments: ['보정', 'Adjustments', '補正'],
    brightness: ['밝기', 'Brightness', '明るさ'], contrast: ['대비', 'Contrast', 'コントラスト'], saturation: ['채도', 'Saturation', '彩度'], temperature: ['색온도', 'Temperature', '色温度'], vignette: ['비네팅', 'Vignette', '周辺光量'],
    mosaic: ['모자이크', 'Mosaic', 'モザイク'], blur: ['블러', 'Blur', 'ぼかし'], ellipse: ['원형', 'Circle', '円形'], rectangle: ['사각형', 'Rectangle', '四角形'], strength: ['강도', 'Strength', '強さ'],
    maskHint: ['사진 위를 드래그해 영역을 추가하세요. 영역을 선택하면 모양·방식·강도를 바꿀 수 있습니다.', 'Drag on the image to add an area. Select an area to change its shape, effect or strength.', '画像上をドラッグして範囲を追加します。範囲を選択して形・効果・強さを変更できます。'],
    region: ['영역', 'Area', '範囲'], addRegion: ['중앙에 영역 추가', 'Add area at center', '中央に範囲を追加'], deleteRegion: ['선택 영역 삭제', 'Delete selected area', '選択範囲を削除'], clearRegions: ['전체 삭제', 'Delete all areas', 'すべて削除'],
    regionX: ['영역 가로 위치 (%)', 'Area horizontal position (%)', '範囲の横位置 (%)'], regionY: ['영역 세로 위치 (%)', 'Area vertical position (%)', '範囲の縦位置 (%)'], regionWidth: ['영역 너비 (%)', 'Area width (%)', '範囲の幅 (%)'], regionHeight: ['영역 높이 (%)', 'Area height (%)', '範囲の高さ (%)'],
    regionLimit: ['한 이미지에 최대 100개 영역을 추가할 수 있습니다.', 'You can add up to 100 areas per image.', '1枚の画像に最大100個の範囲を追加できます。'],
    color: ['테두리 색상', 'Border color', '枠線の色'], thickness: ['두께', 'Thickness', '太さ'], radius: ['모서리 둥글기', 'Corner radius', '角の丸み'],
    preview: ['편집 결과 미리보기', 'Edited image preview', '編集結果のプレビュー'], source: ['원본 보기', 'Show original', '元の画像を表示'],
    keepOriginal: ['원본을 유지하고 편집한 이미지를 새 자료로 추가합니다.', 'Keep the original and add the edited image as a new asset.', '元の画像を保持し、編集結果を新しい素材として追加します。'],
    limits: ['최대 8,192px · 3,200만 화소 · 20MB', 'Up to 8,192 px · 32 megapixels · 20 MB', '最大8,192px・3,200万画素・20MB'],
    loading: ['이미지를 준비하는 중…', 'Preparing image…', '画像を準備中…'], rendering: ['미리보기 갱신 중…', 'Updating preview…', 'プレビュー更新中…'],
    originalDimensions: ['원본 크기', 'Original size', '元のサイズ'], outputDimensions: ['결과 크기', 'Output size', '出力サイズ'],
    soft: ['부드러운', 'Soft', 'ソフト'], clean: ['깨끗한', 'Clean', 'クリア'], sunset: ['노을', 'Sunset', '夕暮れ'], warm: ['따스한', 'Warm', 'ウォーム'], glow: ['빛나는', 'Glow', '輝き'], moonlight: ['달빛', 'Moonlight', '月光'], champagne: ['샴페인', 'Champagne', 'シャンパン'], vivid: ['선명', 'Vivid', '鮮やか'], calm: ['단아함', 'Calm', '穏やか'], everyday: ['일상', 'Everyday', '日常'], faded: ['아련한', 'Faded', '淡い'], sweet: ['달콤', 'Sweet', 'スイート'], grayscale: ['그레이', 'Grayscale', 'グレー'], elegant: ['우아함', 'Elegant', '優雅'], cozy: ['따뜻함', 'Cozy', 'ぬくもり'], radiant: ['화사', 'Radiant', '華やか'], cotton: ['솜사탕', 'Cotton candy', '綿あめ'], memories: ['회상', 'Memories', '回想'], film: ['필름', 'Film', 'フィルム'], autumn: ['가을날', 'Autumn', '秋'], romantic: ['로맨틱', 'Romantic', 'ロマンチック'],
    none: ['없음', 'None', 'なし'], white: ['흰 여백', 'White frame', '白い余白'], rounded: ['둥근 모서리', 'Rounded', '丸角'], outline: ['얇은 선', 'Outline', '輪郭線'], double: ['이중 선', 'Double line', '二重線'], shadow: ['그림자', 'Shadow', '影'], 'rough-dark': ['거친 검정', 'Dark rough edge', '黒いラフ枠'], 'rough-white': ['거친 흰색', 'White rough edge', '白いラフ枠'],
};

export function imageEditText(key) {
    const index = { ko: 0, en: 1, ja: 2 }[getCurrentLanguage()] ?? 0;
    return messages[key]?.[index] || key;
}
