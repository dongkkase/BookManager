import { googleTranslator } from './translators/googleTranslator';
import { aiTranslator } from './translators/aiTranslator';
import { getApiCache } from './apiCache';
import { SearchApiResult } from '../../shared/types/models';
import { getConfigService } from './configService';

export interface ApiSearchOptions {
  apiName: 'anilist' | 'google_books' | 'comic_vine' | 'aladin' | 'ridibooks';
  query: string;
  page?: number;
}

export interface ApiKeys {
  anilist?: string;
  google_books?: string;
  comic_vine?: string;
  aladin_ttbkey?: string;
  ridibooks?: string;
  openai?: string;
  gemini?: string;
}

export class ApiFetcher {
  private static instance: ApiFetcher | null = null;

  public static getInstance(): ApiFetcher {
    if (!ApiFetcher.instance) {
      ApiFetcher.instance = new ApiFetcher();
    }
    return ApiFetcher.instance;
  }

  // Korean to English translation using AI with Google fallback
  private async translateKoToEn(text: string, apiKeys?: ApiKeys): Promise<string> {
    if (!text) return text;

    // Try AI translation first
    if (apiKeys?.openai || apiKeys?.gemini) {
      try {
        const config = getConfigService().getConfig();
        const translated = await aiTranslator.translate(
          `다음 한국어 만화/코믹스 제목을 미국 Comic Vine이나 해외 DB에서 검색하기 가장 좋은 공식 영문 발매명(Official English Title) 딱 1개만 출력해. 부가 설명, 마침표, 특수기호 없이 오직 JSON의 value 값으로만 1개 출력할 것. 형식: {"title": "영문제목"} 입력: ${text}`,
          {
            apiKey: config.aiTranslator?.apiKey || apiKeys.openai || '',
            baseUrl: config.aiTranslator?.apiUrl || 'https://api.openai.com/v1',
            model: config.aiTranslator?.model || 'gpt-3.5-turbo',
          }
        );
        // Parse JSON response
        const match = translated.match(/"title"\s*:\s*"([^"]+)"/);
        if (match) {
          return match[1];
        }
        return translated;
      } catch {
        // Fall back to Google Translate
      }
    }

    // Fallback to Google Translate
    try {
      return await googleTranslator.translate(text, 'en', 'ko');
    } catch {
      return text;
    }
  }

  // Parse date string to year/month/day (Python 원본과 동일하게 3개 반환)
  private parseDate(dateStr: string): [string, string, string] {
    if (!dateStr) return ['', '', ''];
    // HTML 태그 제거
    const cleanStr = String(dateStr).replace(/<[^>]+>/g, '').trim();
    // 연-월-일 패턴
    const matchYMD = cleanStr.match(/(\d{4})[^\d]+(\d{1,2})[^\d]+(\d{1,2})/);
    if (matchYMD) return [matchYMD[1], String(parseInt(matchYMD[2])), String(parseInt(matchYMD[3]))];
    // 연-월 패턴
    const matchYM = cleanStr.match(/(\d{4})[^\d]+(\d{1,2})/);
    if (matchYM) return [matchYM[1], String(parseInt(matchYM[2])), ''];
    // 연도만
    const matchY = cleanStr.match(/(\d{4})/);
    if (matchY) return [matchY[1], '', ''];
    return ['', '', ''];
  }

  // Main search dispatcher with cache
  public async search(apiName: string, query: string, apiKeys?: ApiKeys, page: number = 1): Promise<SearchApiResult[]> {
    if (!query) return [];

    const cache = getApiCache();
    const cacheKey = `${apiName}_${query}_${page}`;

    // Check cache first
    const cached = cache.get('search_cache', cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // Cache corrupted, continue to fetch
      }
    }

    // Translate Korean query to English if needed
    let enQuery = query;
    const hasKorean = /[가-힣]/.test(query);
    if (hasKorean && (apiName === 'anilist' || apiName === 'google_books' || apiName === 'comic_vine')) {
      enQuery = await this.translateKoToEn(query, apiKeys);
    }

    // Dispatch to appropriate search method
    let results: SearchApiResult[] = [];
    switch (apiName) {
      case 'anilist':
        results = await this.searchAnilist(enQuery, page);
        break;
      case 'google_books':
        results = await this.searchGoogleBooks(enQuery, apiKeys?.google_books, page);
        break;
      case 'comic_vine':
        results = await this.searchComicVine(enQuery, apiKeys?.comic_vine, page);
        break;
      case 'aladin':
        results = await this.searchAladin(query, apiKeys?.aladin_ttbkey, page);
        break;
      case 'ridibooks':
        results = await this.searchRidiBooks(query, page);
        break;
      default:
        console.warn(`Unknown API: ${apiName}`);
    }

    // Cache results (TTL: 7 days)
    const ttlSeconds = 7 * 24 * 60 * 60;
    cache.set('search_cache', cacheKey, JSON.stringify(results), ttlSeconds);

    return results;
  }

  // AniList GraphQL Search
  private async searchAnilist(query: string, page: number = 1): Promise<SearchApiResult[]> {
    if (!query) return [];

    const queryString = `
      query ($search: String, $page: Int) {
        Page(page: $page, perPage: 20) {
          media(type: MANGA, search: $search) {
            id
            title {
              romaji
              english
              native
            }
            format
            status
            description
            chapters
            volumes
            averageScore
            genres
            tags {
              name
              rank
            }
            siteUrl
            coverImage {
              large
              medium
            }
            studios(isMain: true) {
              name
            }
          }
        }
      }
    `;

    try {
      const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          query: queryString,
          variables: { search: query, page },
        }),
      });

      if (!response.ok) {
        throw new Error(`AniList API error: ${response.status}`);
      }

      const data = await response.json();
      const results: SearchApiResult[] = [];

      if (data?.data?.Page?.media) {
        for (const item of data.data.Page.media) {
          const title = item.title?.english || item.title?.romaji || item.title?.native || '';
          const tags = item.tags?.map((t: { name: string }) => t.name).join(', ') || '';
          const genres = item.genres?.join(', ') || '';
          const studio = item.studios?.[0]?.name || '';

          results.push({
            b_id: String(item.id),
            Title: title,
            Writer: '',
            Publisher: studio,
            Summary: item.description?.replace(/<\/?[^>]+(>|$)/g, '') || '', // Strip HTML tags
            Series: '',
            Web: item.siteUrl || '',
            CoverUrl: item.coverImage?.large || item.coverImage?.medium || '',
            Tags: tags,
            Genre: genres,
            LocalizedSeries: '',
            Count: item.chapters?.toString() || item.volumes?.toString() || '',
            Rating: item.averageScore?.toString() || '',
          });
        }
      }

      return results;
    } catch (error) {
      console.error('AniList search error:', error);
      return [];
    }
  }

  // Google Books Search
  private async searchGoogleBooks(query: string, apiKey?: string, page: number = 1): Promise<SearchApiResult[]> {
    if (!apiKey || !query) return [];

    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=20&startIndex=${(page - 1) * 20}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Google Books API error: ${response.status}`);
      }

      const data = await response.json();
      const results: SearchApiResult[] = [];

      if (data?.items) {
        for (const item of data.items) {
          const volumeInfo = item.volumeInfo || {};
          const imageLinks = volumeInfo.imageLinks || {};
          const authors = volumeInfo.authors?.join(', ') || '';
          const publishers = volumeInfo.publisher || '';
          const categories = volumeInfo.categories?.join(', ') || '';

          results.push({
            b_id: item.id || '',
            Title: volumeInfo.title || '',
            Writer: authors,
            Publisher: publishers,
            Summary: volumeInfo.description || '',
            Series: volumeInfo.series?.toString() || '',
            Web: volumeInfo.infoLink || '',
            CoverUrl: imageLinks.extraLarge || imageLinks.large || imageLinks.medium || '',
            Tags: categories,
            Genre: categories,
            LocalizedSeries: '',
            Count: volumeInfo.pageCount?.toString() || '',
            Rating: volumeInfo.averageRating?.toString() || '',
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Google Books search error:', error);
      return [];
    }
  }

  // Comic Vine Search
  private async searchComicVine(query: string, apiKey?: string, page: number = 1): Promise<SearchApiResult[]> {
    if (!apiKey || !query) return [];

    const offset = (page - 1) * 20;
    const url = `https://comicvine.gamespot.com/api/search/?resources=comic,volume&query=${encodeURIComponent(query)}&api_key=${apiKey}&format=json&limit=20&offset=${offset}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Comic Vine API error: ${response.status}`);
      }

      const data = await response.json();
      const results: SearchApiResult[] = [];

      if (data?.results) {
        for (const item of data.results) {
          const image = item.image || {};
          const characters = item.characters?.map((c: { name: string }) => c.name).join(', ') || '';
          const teams = item.teams?.map((t: { name: string }) => t.name).join(', ') || '';
          const itemCreators = item.creators ?? [];
          const writers = itemCreators
            .filter((c: { role?: string }) => c.role?.includes('writer'))
            .map((c: { name: string }) => c.name)
            .join(', ');
          const pencillers = itemCreators
            .filter((c: { role?: string }) => c.role?.includes('penciller') || c.role?.includes('artist'))
            .map((c: { name: string }) => c.name)
            .join(', ');

          results.push({
            b_id: String(item.id) || '',
            Title: item.name || '',
            Writer: writers,
            Penciller: pencillers,
            Publisher: item.publisher?.name || '',
            Summary: item.description || '',
            Series: item.volume?.name || '',
            Web: item.siteUrl || '',
            CoverUrl: image?.super_url || image?.large_url || image?.medium_url || '',
            Tags: characters,
            Genre: teams,
            LocalizedSeries: '',
            Count: item.issue_count?.toString() || '',
            Rating: item.rating?.toString() || '',
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Comic Vine search error:', error);
      return [];
    }
  }

  // Aladin Book Search
  private async searchAladin(query: string, ttbkey?: string, page: number = 1): Promise<SearchApiResult[]> {
    if (!ttbkey || !query) return [];

    const url = `https://www.aladin.co.kr/ttb_api/OnlineShopping.asp?ttbkey=${ttbkey}&Query=${encodeURIComponent(query)}&QueryMethod=Title&MaxResults=20&Start=${(page - 1) * 20 + 1}&Output=JSon&Version=20131111`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Aladin API error: ${response.status}`);
      }

      const data = await response.json();
      const results: SearchApiResult[] = [];

      if (data?.item) {
        for (const item of data.item) {
          const author = item.author || '';
          const publisher = item.publisher || '';
          const genre = item.genre || '';

          results.push({
            b_id: item.itemID || '',
            Title: item.title || '',
            Writer: author,
            Publisher: publisher,
            Summary: item.description || '',
            Series: '',
            Web: item.juniusItemUrl || '',
            CoverUrl: item.juniusCover || '',
            Tags: genre,
            Genre: genre,
            LocalizedSeries: '',
            Count: '',
            Rating: '',
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Aladin search error:', error);
      return [];
    }
  }

  // RidiBooks Search
  private async searchRidiBooks(query: string, page: number = 1): Promise<SearchApiResult[]> {
    if (!query) return [];

    const url = `https://ridibooks.com/apps/search/search?keyword=${encodeURIComponent(query)}&page=${page}&pageSize=20&sortOrder=0&target=r`;

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        throw new Error(`RidiBooks API error: ${response.status}`);
      }

      const data = await response.json();
      const results: SearchApiResult[] = [];

      if (data?.result?.document) {
        for (const item of data.result.document) {
          const author = item.author?.join(', ') || '';
          const publisher = item.publisherName || '';
          const categories = item.category?.map((c: { name: string }) => c.name).join(', ') || '';

          results.push({
            b_id: item.bId || '',
            Title: item.title || '',
            Writer: author,
            Publisher: publisher,
            Summary: item.description || '',
            Series: '',
            Web: `https://ridibooks.com/books/${item.bId}`,
            CoverUrl: item.coverImageUrl || '',
            Tags: categories,
            Genre: categories,
            LocalizedSeries: '',
            Count: '',
            Rating: item.rating?.toString() || '',
          });
        }
      }

      return results;
    } catch (error) {
      console.error('RidiBooks search error:', error);
      return [];
    }
  }

  // Get RidiBooks publish date
  public async getRidiPublishDate(bId: string): Promise<string> {
    if (!bId) return '';

    const cache = getApiCache();

    // Check cache first
    const cached = cache.get('ridi_date_cache', bId);
    if (cached) {
      return cached;
    }

    const url = `https://ridibooks.com/books/${bId}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });

      if (!response.ok) {
        throw new Error(`RidiBooks fetch error: ${response.status}`);
      }

      const html = await response.text();

      // Extract publish date from HTML
      const match = html.match(/pubDate["\s]+value=["'](\d{4}-\d{2}-\d{2})["']/);
      if (match) {
        const date = match[1];
        // Cache for 30 days
        cache.set('ridi_date_cache', bId, date, 30 * 24 * 60 * 60);
        return date;
      }

      return '';
    } catch (error) {
      console.error('RidiBooks publish date error:', error);
      return '';
    }
  }
}

export function getApiFetcher(): ApiFetcher {
  return ApiFetcher.getInstance();
}
