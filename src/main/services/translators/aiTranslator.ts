import http from 'http';
import https from 'https';
import { getApiCache } from '../apiCache';

export interface AiTranslatorConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export class AiTranslator {
  private readonly cache = getApiCache();

  public async translate(
    text: string,
    config?: AiTranslatorConfig
  ): Promise<string> {
    if (!text || !config?.apiKey) return text;

    const cacheKey = `trans_${text}_${config.baseUrl}_${config.model}`;
    const cached = this.cache.get('trans_cache', cacheKey);
    if (cached) return cached;

    const baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    const model = config.model || 'gpt-3.5-turbo';

    const prompt = `{
  "title": "${text}"
}`;

    try {
      const result = await this.requestChatCompletion(
        baseUrl,
        config.apiKey,
        model,
        `다음 한국어 만화/코믹스 제목을 미국 Comic Vine이나 해외 DB에서 검색하기 가장 좋은 공식 영문 발매명(Official English Title) 딱 1개만 출력해. 부가 설명, 마침표, 특수기호 없이 오직 JSON의 value 값으로만 1개 출력할 것. 형식: {"title": "영문제목"} 입력: ${text}`
      );

      if (result) {
        this.cache.set('trans_cache', cacheKey, result, 30);
        return result;
      }
    } catch {
      // Fall through to return original text
    }

    return text;
  }

  private async requestChatCompletion(
    baseUrl: string,
    apiKey: string,
    model: string,
    prompt: string
  ): Promise<string | null> {
    const url = new URL('/chat/completions', baseUrl);
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '너는 정확한 번역가입니다. 요청된 형식으로만 답변하세요.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 100,
      temperature: 0.1,
    });

    return new Promise((resolve) => {
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 15000,
      };

      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const content = json?.choices?.[0]?.message?.content;
            if (content) {
              const match = content.match(/"title"\s*:\s*"([^"]+)"/);
              if (match) {
                resolve(match[1]);
                return;
              }
              resolve(content.trim());
            }
            resolve(null);
          } catch {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.write(body);
      req.end();
    });
  }
}

export const aiTranslator = new AiTranslator();
