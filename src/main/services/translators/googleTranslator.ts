import https from 'https';

export class GoogleTranslator {
  private readonly userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  public async translate(text: string, targetLang: string = 'en', sourceLang: string = 'ko'): Promise<string> {
    if (!text) return text;

    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;

    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': this.userAgent,
        },
        timeout: 10000,
      };

      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            const translated = json[0]
              .map((item: any) => (item && item[0] ? item[0] : ''))
              .join('');
            resolve(translated || text);
          } catch {
            resolve(text);
          }
        });
      });

      req.on('error', () => resolve(text));
      req.on('timeout', () => {
        req.destroy();
        resolve(text);
      });

      req.end();
    });
  }
}

export const googleTranslator = new GoogleTranslator();
