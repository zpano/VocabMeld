/**
 * Sapling 发音音频源
 */

import { playAudioUrl } from '../services/audio-service.js';

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

  // 只播放第一个 URL，不再 fallback
  await playAudioUrl(list[0]);
}

export async function playYoudaoDictVoice(word, type = 2) {
  const url = buildYoudaoDictVoiceUrl(word, type);
  await playAudioUrls([url]);
}

export async function playGoogleTranslateTts(text, lang) {
  const url = buildGoogleTranslateTtsUrl(text, lang);
  await playAudioUrls([url]);
}
