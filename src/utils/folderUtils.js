/**
 * Folder Tab Utilities
 * Ported from Python's tab_folder.py and core.parser
 */

// 정밀도 개선 핵심 정규식
const RE_TRASH_1 = /(?:\b(1080p|720p|480p|1440p|4k|2k|x264|x265)\b)/ig;
const RE_TRASH_2 = /(?:\[19\d{2}\]|\[20\d{2}\]|\(19\d{2}\)|\(20\d{2}\))/g;

export function extractCoreTitle(name) {
  if (!name) return "";
  let cleanName = name.replace(RE_TRASH_1, "");
  cleanName = cleanName.replace(RE_TRASH_2, "");
  // 파이썬의 핵심 로직 중 대괄호, 괄호 등 제거 (간소화)
  cleanName = cleanName.replace(/\[.*?\]|\(.*?\)/g, "");
  // 뒤에 붙은 숫자/화수/권수 등 제거
  cleanName = cleanName.replace(/(?:\b(?:vol|v|권|화|장|편|부|제|chapter|ch|#)\s*\.?\s*\d+(?:\.\d+)?(?:[~\-]\d+(?:\.\d+)?)?).*$/ig, "");
  // 맨 뒤에 숫자로 끝나는 패턴 제거 (ex: 나루토 14 -> 나루토)
  cleanName = cleanName.replace(/\s*\d+(?:\.\d+)?\s*$/g, "");
  // 특수문자 정리
  cleanName = cleanName.replace(/[\\/:*?"<>|]/g, "_");
  return cleanName.trim();
}

export function extractVolNumbers(name, seriesName = "") {
  let cleanName = name.replace(RE_TRASH_1, "");
  cleanName = cleanName.replace(RE_TRASH_2, "");

  // 1. 001화~009화 같은 패턴
  const rangeRegex1 = /(\d+(?:\.\d+)?)\s*(권|화|장|편|부)\s*[~-]\s*(\d+(?:\.\d+)?)\s*(권|화|장|편|부)/i;
  const match1 = cleanName.match(rangeRegex1);
  if (match1) {
    const start = Math.floor(parseFloat(match1[1]));
    const end = Math.floor(parseFloat(match1[3]));
    if (start <= end && end - start < 150) {
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
  }

  let numStr = "";

  // 2. 일반적인 패턴 (단위가 뒤에 있는 경우: 13권, 13~14권)
  const volRegex = /(?:제|v|vol\.?\s*)?(\d+(?:\.\d+)?(?:\s*[~-]\s*\d+(?:\.\d+)?)?)\s*(권|화|장|편|부)/i;
  const volMatch = cleanName.match(volRegex);
  
  if (volMatch) {
    numStr = volMatch[1];
  } else {
    // 단위가 앞에 있는 경우: vol 13, 제 13, ch 13
    const preRegex = /(?:vol|v|권|화|제|chapter|ch|#)\s*\.?\s*(\d+(?:\.\d+)?(?:\s*[~-]\s*\d+(?:\.\d+)?)?)/i;
    const preMatch = cleanName.match(preRegex);
    if (preMatch) {
      numStr = preMatch[1];
    } else {
      // 3. 단위가 없는 경우 마지막 숫자 그룹 추출
      let cleanForNums = cleanName.replace(/\[.*?\]|\(.*?\)/g, "");
      if (seriesName) {
        // 시리즈명 제거 (간소화)
        const safeSeries = seriesName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').split(/\s+/).join('\\s*');
        const seriesRegex = new RegExp(safeSeries, 'i');
        cleanForNums = cleanForNums.replace(seriesRegex, "");
      }
      const digitsRegex = /\d+(?:\.\d+)?(?:\s*[~-]\s*\d+(?:\.\d+)?)?(?![가-힣a-zA-Z])/g;
      const matches = cleanForNums.match(digitsRegex);
      if (matches && matches.length > 0) {
        numStr = matches[matches.length - 1];
      } else {
        return [];
      }
    }
  }

  if (numStr.includes("~") || numStr.includes("-")) {
    const parts = numStr.split(/\s*[~-]\s*/);
    if (parts.length >= 2) {
      const start = Math.floor(parseFloat(parts[0]));
      const end = Math.floor(parseFloat(parts[1]));
      if (!isNaN(start) && !isNaN(end) && start <= end && end - start < 150) {
        return Array.from({ length: end - start + 1 }, (_, i) => start + i);
      } else if (!isNaN(start)) {
        return [start];
      }
    }
  }

  const singleNum = Math.floor(parseFloat(numStr));
  return isNaN(singleNum) ? [] : [singleNum];
}
