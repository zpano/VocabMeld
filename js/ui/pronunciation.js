/**
 * VocabMeld 发音音频源
 */

function normalizeYoudaoType(type) {
  return Number(type) === 1 ? 1 : 2;
}

export function buildYoudaoDictVoiceUrl(word, type = 2) {
  const audio = String(word || '').trim();
  if (!audio) return '';
  const t = normalizeYoudaoType(type);
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(audio)}&type=${t}`;
}

function toGoogleTtsLangCode(lang) {
  const code = String(lang || '').trim();
  if (!code) return 'en';

  const map = {
    en: 'en',
    ja: 'ja',
    ko: 'ko',
    fr: 'fr',
    de: 'de',
    es: 'es',
    ru: 'ru',
    'zh-CN': 'zh',
    'zh-TW': 'zh'
  };

  if (map[code]) return map[code];
  const primary = code.split('-')[0];
  return map[primary] || primary || 'en';
}

export function buildGoogleTranslateTtsUrl(text, lang) {
  const q = String(text || '').trim();
  if (!q) return '';
  const tl = toGoogleTtsLangCode(lang);
  return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(q)}&tl=${encodeURIComponent(tl)}&client=tw-ob`;
}

export async function playAudioUrls(urls) {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  if (!list.length) throw new Error('No audio URLs');

  const result = await chrome.runtime.sendMessage({ action: 'playAudioUrls', urls: list }).catch((e) => {
    throw e;
  });

  if (result?.success) return;
  throw new Error(result?.message || 'Audio play failed');
}

export async function playYoudaoDictVoice(word, type = 2) {
  const primaryType = normalizeYoudaoType(type);
  const secondaryType = primaryType === 1 ? 2 : 1;

  const primaryUrl = buildYoudaoDictVoiceUrl(word, primaryType);
  const secondaryUrl = buildYoudaoDictVoiceUrl(word, secondaryType);

  await playAudioUrls([primaryUrl, secondaryUrl]);
}

export async function playGoogleTranslateTts(text, lang) {
  const url = buildGoogleTranslateTtsUrl(text, lang);
  await playAudioUrls([url]);
}
