import path from 'path';

// difflib is not a built-in Node.js module, so we implement a simple similarity function
function getSimilarity(a, b) {
  a = String(a || '').normalize('NFC');
  b = String(b || '').normalize('NFC');
  const aComp = a.replace(/[\[\(].*?[\]\)]/g, '').replace(/[a-zA-Z]/g, '').replace(/\s/g, '');
  const bComp = b.replace(/[\[\(].*?[\]\)]/g, '').replace(/[a-zA-Z]/g, '').replace(/\s/g, '');
  if (!aComp || !bComp) {
    const aFallback = a.replace(/\s/g, '');
    const bFallback = b.replace(/\s/g, '');
    if (!aFallback || !bFallback) return 0.0;
    return sequenceMatcher(aFallback, bFallback);
  }
  return sequenceMatcher(aComp, bComp);
}

function sequenceMatcher(a, b) {
  if (!a && !b) return 1.0;
  if (!a || !b) return 0.0;

  function longestMatch(aStart, aEnd, bStart, bEnd) {
    let previous = new Array(bEnd - bStart + 1).fill(0);
    let best = { a: aStart, b: bStart, size: 0 };
    for (let aIndex = aStart; aIndex < aEnd; aIndex += 1) {
      const current = new Array(bEnd - bStart + 1).fill(0);
      for (let bIndex = bStart; bIndex < bEnd; bIndex += 1) {
        if (a[aIndex] !== b[bIndex]) continue;
        const relative = bIndex - bStart;
        current[relative + 1] = previous[relative] + 1;
        if (current[relative + 1] > best.size) {
          best = {
            a: aIndex - current[relative + 1] + 1,
            b: bIndex - current[relative + 1] + 1,
            size: current[relative + 1],
          };
        }
      }
      previous = current;
    }
    return best;
  }

  function matchingBlockSize(aStart, aEnd, bStart, bEnd) {
    const match = longestMatch(aStart, aEnd, bStart, bEnd);
    if (match.size === 0) return 0;
    return match.size
      + matchingBlockSize(aStart, match.a, bStart, match.b)
      + matchingBlockSize(match.a + match.size, aEnd, match.b + match.size, bEnd);
  }

  const matches = matchingBlockSize(0, a.length, 0, b.length);
  return (2.0 * matches) / (a.length + b.length);
}

function stripKoreanStructuralNumberTokens(text) {
    return String(text || '').replace(
        /(?:제\s*)?\d+(?:\.\d+)?\s*(?:부(?!터)|장|편)(?=$|[\s\]\),._-]|[가-힣])/g,
        ' '
    );
}

function stripImageProcessingSuffix(text) {
    const tokenPattern = '(?:waifu2x|noise\\d*|denoise\\d*|scale(?:[\\s_.-]*x?\\d+(?:[\\s_.-]\\d+)?)?|x\\d+(?:[\\s_.-]\\d+)?|upscale(?:d)?|resize(?:d)?|converted?|cleaned?|raw)';
    return String(text || '')
        .replace(new RegExp(`(\\d)${tokenPattern}(?=$|[\\s_.-]).*$`, 'i'), '$1')
        .replace(new RegExp(`(?:^|[\\s_.-])${tokenPattern}(?=$|[\\s_.-]).*$`, 'i'), ' ');
}

export function cleanDisplayTitle(text) {
  let cleaned = String(text).normalize('NFC');
  cleaned = cleaned.replace(
    /[\[\(](번외편?|외전|스핀오프|특별편?|단편|합본)[\]\)]/g,
    ' $1 '
  );
  cleaned = cleaned.replace(/[\[\(].*?[\]\)]/g, ' ');
  cleaned = cleaned.replace(/\.(zip|cbz|cbr|rar|7z)$/i, '');
  cleaned = cleaned.replace(/\d{4}-\d{2}-\d{2}/g, '');
  cleaned = cleaned.replace(/\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g, '');
  cleaned = cleaned.replace(/업로드\s*$/g, '');
  cleaned = cleaned.replace(/\+\s*\d+\s*$/g, '');

  // --- [수정된 부분] 작가명 제거 로직 분리 ---
  // '원작, 그림, 지음' 등은 공백이 없어도(예: 홍길동그림) 제거하지만
  // '글'은 단어 끝에 흔하게 쓰이므로 앞에 반드시 공백이 1개 이상(\s+) 있을 때만 제거합니다.
  cleaned = cleaned.replace(
    /(?:\s|^)[가-힣a-zA-Z]+\s*(?:원작|그림|지음|작화|스토리|번역)(?=\s|$)/g,
    ' '
  );
  cleaned = cleaned.replace(
    /(?:\s|^)[가-힣a-zA-Z]+\s+글(?=\s|$)/g,
    ' '
  );
  // ----------------------------------------

  cleaned = cleaned.replace(/\d{3,4}\s*px/gi, ' ');
  cleaned = cleaned.replace(
    /\d+(?:\.\d+)?\s*[~-]\s*\d+(?:\.\d+)?\s*(?:권|화|장|편|부)?/g,
    ' '
  );
  cleaned = cleaned.replace(/(?:제\s*)?\d+(?:\.\d+)?\s*(?:권|화)/g, ' ');
  cleaned = cleaned.replace(/[-_+,]+/g, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

export function extractCoreTitle(text) {
  let cleaned = cleanDisplayTitle(String(text).normalize('NFC'));
  const delimiterRegex = /(\d{3,4}\s*px|\d+\s*(?:권|화|부(?!터))?\s*[~-]\s*\d+|\d+\s*(?:권|화|화씩)|완결|\s완(\s|$))/i;
  const match = cleaned.match(delimiterRegex);
  if (match && match.index > 0) {
    cleaned = cleaned.slice(0, match.index);
  }

  cleaned = cleaned.replace(/e-?book|e북|完/gi, '');
  cleaned = cleaned.replace(/지원\s사격|지원사격|완결은\s무료/g, '');
  cleaned = cleaned.replace(/\s외\s\d+편/g, '');
  cleaned = cleaned.replace(
    /19\)|19금|19\+|15\)|15금|15\+|N새글|고화질|저화질|무료|워터마크없음|워터마크|고화질판|저화질판|단권|연재본|화질보정|확인불가/g,
    ''
  );
  cleaned = cleaned.replace(
    /스캔 단면|스캔단면|스캔 양면|스캔양면|스캔본|스캔판|단편 만화|단편만화|단편(?!선)|단행본/g,
    ''
  );
  cleaned = cleaned.replace(/번외편?|외전|스핀오프|특별편?|합본/g, '');
  cleaned = cleaned.replace(/권\~/gi, '');
  cleaned = cleaned.replace(/\d+\s*[~-]\s*\d+/g, ' ');
  cleaned = cleaned.replace(/[：:—\-\/,]/g, ' ');
  cleaned = cleaned.replace(/\d+\s*(?:권|화)/g, ' ');
  cleaned = cleaned.replace(/완결[!?.~]*/g, ' ');
  cleaned = cleaned.replace(/\s+(완|화|권)[!?.~]*(?=\s|$)/g, ' ');
  cleaned = cleaned.replace(/\<\s\>/g, '');
  cleaned = cleaned.replace(/[-_+]+/g, ' ');
  return cleaned.replace(/\s+/g, ' ').trim();
}

export function isGarbageFolderName(text) {
  text = String(text || '').normalize('NFC');
  const textLower = text.toLowerCase();
  if (textLower.includes('gigafile') || textLower.includes('down')) {
    return true;
  }
  if (text.length > 20 && /^[a-zA-Z0-9\-_]+$/.test(text)) {
    return true;
  }
  if (text.length > 15 && /^[a-fA-F0-9\-_]+$/.test(text)) {
    return true;
  }
  const stripped = text.replace(/[\[\(].*?[\]\)]/g, '').trim();
  if (/^\d+$/.test(stripped)) {
    return true;
  }
  return false;
}

export function resolveTitles(filepath, innerName = '') {
  const resolvedPath = path.resolve(String(filepath || '')).normalize('NFC');
  const p = {
    stem: path.basename(resolvedPath, path.extname(resolvedPath)),
    parent: { name: path.dirname(resolvedPath) ? path.basename(path.dirname(resolvedPath)) : '' },
    parents: (() => {
      const dir = path.dirname(resolvedPath);
      const parents = [];
      let current = dir;
      const root = path.parse(current).root;
      while (current && current !== root) {
        const parentName = path.basename(current);
        if (parentName) parents.push({ name: parentName });
        const next = path.dirname(current);
        if (!next || next === current) break;
        current = next;
      }
      return parents;
    })()
  };

  const fileStem = p.stem;
  const parentName = p.parent.name;
  const grandparentName = p.parents.length > 1 ? p.parents[1].name : '';

  const fileDisp = cleanDisplayTitle(fileStem);
  let fileCore = extractCoreTitle(fileStem);
  if (!fileCore) {
    fileCore = fileStem;
  }

  const parentDisp = cleanDisplayTitle(parentName);
  const parentCore = extractCoreTitle(parentName);
  const grandparentDisp = cleanDisplayTitle(grandparentName);
  const grandparentCore = extractCoreTitle(grandparentName);

  const genericFolders = [
    'temp',
    'downloads',
    '다운로드',
    '새 폴더',
    '새폴더',
    'new folder',
    'tmp',
    'desktop',
    '바탕 화면',
    '바탕화면',
  ];

  if (isGarbageFolderName(fileStem) || !/[가-힣a-zA-Z]/.test(fileStem)) {
    let innerDisp = '';
    let innerCore = '';
    if (
      innerName &&
      !isGarbageFolderName(innerName) &&
      /[가-힣a-zA-Z]/.test(innerName)
    ) {
      innerDisp = cleanDisplayTitle(innerName);
      innerCore = extractCoreTitle(innerName);
    }

    const parentIsGeneric =
      parentName.toLowerCase() === genericFolders.find((f) => f.toLowerCase() === parentName.toLowerCase()) ||
      parentDisp.toLowerCase() === genericFolders.find((f) => f.toLowerCase() === parentDisp.toLowerCase()) ||
      isGarbageFolderName(parentName);

    if (!parentIsGeneric && innerCore) {
      if (
        parentCore.replace(/\s/g, '') === innerCore.replace(/\s/g, '') ||
        getSimilarity(parentCore, innerCore) >= 0.4
      ) {
        return [parentDisp, parentCore];
      } else {
        return [innerDisp, innerCore];
      }
    }

    if (innerCore) {
      return [innerDisp, innerCore];
    }
    if (!parentIsGeneric) {
      return [parentDisp, parentCore];
    }
    if (
      grandparentName &&
      grandparentName.toLowerCase() !== genericFolders.find((f) => f.toLowerCase() === grandparentName.toLowerCase()) &&
      !isGarbageFolderName(grandparentName)
    ) {
      return [grandparentDisp, grandparentCore];
    }

    return ['제목없음', '제목없음'];
  }

  if (parentCore && getSimilarity(fileCore, parentCore) >= 0.5) {
    return [parentDisp, parentCore];
  }
  if (grandparentCore && getSimilarity(fileCore, grandparentCore) >= 0.5) {
    return [grandparentDisp, grandparentCore];
  }

  if (parentCore && !/[가-힣a-zA-Z]/.test(fileCore)) {
    if (isGarbageFolderName(parentName) && grandparentName) {
      return [grandparentDisp, grandparentCore];
    }
    return [parentDisp, parentCore];
  }

  return [fileDisp, fileCore];
}

export function fixEncoding(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Mac OS 자음/모음 분리(NFD) -> 윈도우용(NFC) 병합
  text = text.normalize('NFC');

  // 흔히 발생하는 인코딩 깨짐 패턴
  const encodingsToTest = [
    ['cp437', 'cp949'],
    ['latin1', 'cp949'],
    ['cp850', 'cp949'],
    ['mac_roman', 'cp949'],
  ];

  for (const [encFrom, encTo] of encodingsToTest) {
    try {
      const fixed = Buffer.from(text, encFrom).toString(encTo);
      // 정상적으로 변환되었고, 변환된 문자열에 완벽한 한글이 포함되어 있다면 복구 성공
      if (fixed !== text && /[가-힣]/.test(fixed)) {
        return fixed;
      }
    } catch (e) {
      continue;
    }
  }

  return text;
}

export function formatLeafName(parentCore, leafName, index, totalItems, lang = 'ko') {
  parentCore = String(parentCore || '').normalize('NFC');
  const pad = Math.max(2, String(totalItems).length);
  let leafClean = String(leafName)
    .normalize('NFC')
    .replace(/\.(zip|cbz|cbr|rar|7z)$/i, '')
    .trim();

  function padMatch(val) {
    if (val.includes('~') || val.includes('-')) {
      const sep = val.includes('~') ? '~' : '-';
      const parts = val.split(sep);
      return `${parts[0].trim().padStart(pad, '0')}${sep}${parts[1].trim().padStart(pad, '0')}`;
    }
    if (val.includes('.')) {
      return `${val.split('.')[0].padStart(pad, '0')}.${val.split('.')[1]}`;
    }
    return val.padStart(pad, '0');
  }

  const isHash =
    leafClean.length > 25 && /^[a-fA-F0-9\-_]+$/.test(leafClean);

  if (isHash || !/[가-힣a-zA-Z]/.test(leafClean)) {
    let cleanForNums = leafClean.replace(/[\[\(].*?[\]\)]/g, '');
    cleanForNums = cleanForNums.replace(
      /\d+(?:\.\d+)?\s*(?:px|p|pt|mb|gb|kb|k)(?![a-zA-Z])/gi,
      ''
    );
    cleanForNums = stripImageProcessingSuffix(cleanForNums);
    const nums = cleanForNums.match(/\d+(?:\.\d+)?/g) || [];
    let base = reSub('^[_\-\s]+', '', parentCore);

    if (nums.length > 0 && !isHash) {
      const targetNum = nums[nums.length - 1];
      const paddedNum = padMatch(targetNum);
      return lang === 'en'
        ? `${base} v${paddedNum}`.trim()
        : `${base} ${paddedNum}권`.trim();
    }
    return base.trim();
  }

  const cleanNoBrackets = leafClean.replace(/[\[\(].*?[\]\)]/g, '');
  let cleanForNums = cleanNoBrackets.replace(
    /\d+(?:\.\d+)?\s*(?:px|p|pt|mb|gb|kb|k)(?![a-zA-Z])/gi,
    ''
  );
  let volMatch = leafClean.match(
    /(?:제\s*)?(\d+(?:\.\d+)?(?:\s*[~-]\s*\d+(?:\.\d+)?)?)\s*(권|화)(?![가-힣])/i
  );
  if (!volMatch) {
    const prefixedMatch = leafClean.match(
      /\b(v|vol\.?|volume|c|ch\.?|chapter)\s*(\d+(?:\.\d+)?(?:\s*[~-]\s*\d+(?:\.\d+)?)?)/i
    );
    if (prefixedMatch) {
      volMatch = [
        prefixedMatch[0],
        prefixedMatch[2],
        /^(?:c|ch\.?|chapter)$/i.test(prefixedMatch[1]) ? '화' : '권',
      ];
    }
  }

  let targetNum = null;
  let targetUnit = null;
  if (volMatch) {
    targetNum = volMatch[1];
    targetUnit = volMatch[2];
  } else {
    cleanForNums = stripKoreanStructuralNumberTokens(cleanForNums);
    cleanForNums = stripImageProcessingSuffix(cleanForNums);
    const nums = cleanForNums.match(/\d+(?:\.\d+)?/g) || [];
    if (nums.length > 0) {
      targetNum = nums[nums.length - 1];
    } else {
      const leafCleanNoPx = leafClean.replace(
        /\d+(?:\.\d+)?\s*(?:px|p|pt|mb|gb|kb|k)(?![a-zA-Z])/gi,
        ''
      );
      const allNums = stripImageProcessingSuffix(stripKoreanStructuralNumberTokens(leafCleanNoPx)).match(/\d+(?:\.\d+)?/g) || [];
      if (allNums.length > 0) {
        targetNum = allNums[allNums.length - 1];
      }
    }
  }

  let specialSuffix = '';
  if (/프롤로그|prologue/i.test(leafClean)) {
    specialSuffix = lang === 'en' ? ' Prologue' : ' 프롤로그';
  } else if (/에필로그|epilogue/i.test(leafClean)) {
    specialSuffix = lang === 'en' ? ' Epilogue' : ' 에필로그';
  } else if (/특별편|special|특장판/i.test(leafClean)) {
    specialSuffix = lang === 'en' ? ' Special' : ' 특별편';
  } else if (/외전|side\s*story|번외/i.test(leafClean)) {
    specialSuffix = lang === 'en' ? ' Side Story' : ' 외전';
  } else if (/단편(?!선)|short/i.test(leafClean)) {
    specialSuffix = lang === 'en' ? ' Short Story' : ' 단편';
  } else if (/한정판|limited/i.test(leafClean)) {
    specialSuffix = lang === 'en' ? ' Limited Edition' : ' 한정판';
  }

  let baseName = reSub('^[_\-\s]+', '', parentCore);

  if (!targetNum) {
    if (specialSuffix) {
      if (specialSuffix === ' 단편' || specialSuffix === ' Short Story') {
        return baseName.trim();
      } else {
        return `${baseName}${specialSuffix}`.trim();
      }
    } else {
      return baseName.trim();
    }
  }

  const paddedNum = padMatch(targetNum);

  let remNumStr = targetNum;
  if (remNumStr.includes('~')) {
    remNumStr = remNumStr.split('~')[0];
  }
  if (remNumStr.includes('-')) {
    remNumStr = remNumStr.split('-')[0];
  }

  let valStr;
  if (remNumStr.includes('.')) {
    valStr = String(parseFloat(remNumStr));
    if (valStr.includes('.')) {
      valStr = valStr.replace(/\.?0+$/, '');
    }
  } else if (/^\d+$/.test(remNumStr)) {
    valStr = String(parseInt(remNumStr, 10));
  } else {
    valStr = remNumStr;
  }

  // [수정] leaf가 제목+숫자 패턴인 경우 parent_core를 base_name으로 사용
  const leafCoreCheck = extractCoreTitle(leafClean);
  const parentCoreCheck = extractCoreTitle(parentCore);
  if (
    leafCoreCheck &&
    parentCoreCheck &&
    getSimilarity(leafCoreCheck, parentCoreCheck) >= 0.5
  ) {
    baseName = reSub('^[_\-\s]+', '', parentCore);
  } else {
    if (
      leafCoreCheck &&
      /[가-힣a-zA-Z]/.test(leafCoreCheck) &&
      !/^(제|v|vol|ch|chapter|part|권|화|장|편|부)\.?\s*\d*$/i.test(leafCoreCheck)
    ) {
      baseName = leafCoreCheck;
    }

    const pattern = new RegExp(
      '(.*?)[\\s\\-_]+0*' + escapeRegex(valStr) + '(?:\\.0+)?$',
      'i'
    );
    const match = baseName.match(pattern);
    if (match) {
      const baseNameCandidate = match[1].trim();
      if (baseNameCandidate) {
        baseName = baseNameCandidate;
      }
    }
  }

  if (!targetUnit) {
    targetUnit = lang === 'ko' ? '권' : 'v';
  }

  let unitStr;
  if (lang === 'en') {
    if (targetUnit === '부') {
      unitStr = `Part ${paddedNum}`;
    } else if (targetUnit === '화') {
      unitStr = `Ch ${paddedNum}`;
    } else {
      unitStr = `v${paddedNum}`;
    }
  } else {
    unitStr = ['권', '화', '장', '편', '부'].includes(targetUnit)
      ? `${paddedNum}${targetUnit}`
      : `${paddedNum}권`;
  }

  if (specialSuffix) {
    return `${baseName} ${unitStr}${specialSuffix}`.trim();
  } else {
    return `${baseName} ${unitStr}`.trim();
  }
}

// Helper: re.sub equivalent for simple patterns
function reSub(pattern, replacement, str) {
  const regex = new RegExp(pattern, 'g');
  return str.replace(regex, replacement);
}

// Helper: escape regex special characters
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
