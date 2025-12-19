/**
 * Sapling AI Prompts Module
 * 统一管理所有 AI 提示词模板
 */

/**
 * 构建词汇选择提示词（用于自动翻译段落）
 * @param {object} params - 参数对象
 * @param {string} params.sourceLang - 源语言
 * @param {string} params.targetLang - 目标语言
 * @param {string} params.nativeLanguage - 用户母语
 * @param {string} params.learningLanguage - 用户学习语言
 * @param {number} params.aiTargetCount - AI 应返回的目标词汇数
 * @param {number} params.aiMaxCount - AI 最多返回的词汇数
 * @returns {string} 完整的提示词
 */
export function buildVocabularySelectionPrompt({
  sourceLang,
  targetLang,
  nativeLanguage,
  learningLanguage,
  aiTargetCount,
  aiMaxCount
}) {
  // 判断学习语言的词汇在哪个字段
  const isLearningFromSource = sourceLang === learningLanguage;
  const learningWordField = isLearningFromSource ? 'original' : 'translation';

  return `You are a professional language learning assistant. Your task is to analyze text and select valuable words for translation to help users learn new vocabulary.

## Your Mission:
Select ${aiTargetCount}-${aiMaxCount} words with high learning value from the provided text.

## Translation Context:
- Source language: ${sourceLang}
- Target language: ${targetLang}
- User's native language: ${nativeLanguage}
- User's learning language: ${learningLanguage}
- **The word user is learning will be in the "${learningWordField}" field**

## Selection Rules (MUST FOLLOW):
1. Select ONLY ${aiTargetCount}-${aiMaxCount} words total
2. NEVER translate: proper nouns, person names, place names, brand names, numbers, code snippets, URLs
3. SKIP: words already in the target language
4. Prioritize: common useful vocabulary with mixed difficulty levels
5. Translation style: context-aware, single best meaning (not multiple definitions)
6. **CRITICAL PHONETIC RULE**: The "phonetic" field MUST be the pronunciation of the "${learningWordField}" field (the ${learningLanguage} word), NOT the ${isLearningFromSource ? targetLang : sourceLang} word!

${getCommonSections(nativeLanguage, learningLanguage, isLearningFromSource)}

## Example Output (JSON ONLY):
${isLearningFromSource ? `[
  {
    "original": "affiliated",
    "translation": "隶属的",
    "phonetic": "/əˈfɪlieɪtɪd/",
    "difficulty": "B2",
    "partOfSpeech": "adjective",
    "shortDefinition": "officially connected or associated with an organization",
    "example": "The hospital is affiliated with the university medical school."
  },
  {
    "original": "technology",
    "translation": "技术",
    "phonetic": "/tekˈnɒlədʒi/",
    "difficulty": "A2",
    "partOfSpeech": "noun",
    "shortDefinition": "the application of scientific knowledge for practical purposes",
    "example": "Modern technology has transformed the way we communicate."
  }
]` : `[
  {
    "original": "艺术家",
    "translation": "artist",
    "phonetic": "/ˈɑːtɪst/",
    "difficulty": "B2",
    "partOfSpeech": "noun",
    "shortDefinition": "a person who creates art, especially paintings or drawings",
    "example": "The artist spent years perfecting her technique."
  },
  {
    "original": "技术",
    "translation": "technology",
    "phonetic": "/tekˈnɒlədʒi/",
    "difficulty": "A2",
    "partOfSpeech": "noun",
    "shortDefinition": "the application of scientific knowledge for practical purposes",
    "example": "Technology continues to advance at a rapid pace."
  }
]`}`;
}

/**
 * 构建特定单词翻译提示词（用于记忆列表）
 * @param {object} params - 参数对象
 * @param {string} params.sourceLang - 源语言
 * @param {string} params.targetLang - 目标语言
 * @param {string} params.nativeLanguage - 用户母语
 * @param {string} params.learningLanguage - 用户学习语言
 * @returns {string} 完整的提示词
 */
export function buildSpecificWordsPrompt({
  sourceLang,
  targetLang,
  nativeLanguage,
  learningLanguage
}) {
  // 判断学习语言的词汇在哪个字段
  const isLearningFromSource = sourceLang === learningLanguage;
  const learningWordField = isLearningFromSource ? 'original' : 'translation';

  return `You are a language learning assistant. Translate the specific words provided by the user.

## Rules:
1. Translate every provided word; do not skip any
2. If a word is in ${sourceLang}, translate it to ${targetLang}; otherwise translate it the other way
3. **CRITICAL PHONETIC RULE**: The "phonetic" field MUST be the pronunciation of the "${learningWordField}" field (the ${learningLanguage} word), NOT the ${isLearningFromSource ? targetLang : sourceLang} word!

${getCommonSections(nativeLanguage, learningLanguage, isLearningFromSource)}

## Example Output (JSON ONLY):
${isLearningFromSource ? `[
  {
    "original": "affiliated",
    "translation": "隶属的",
    "phonetic": "/əˈfɪlieɪtɪd/",
    "difficulty": "B2",
    "partOfSpeech": "adjective",
    "shortDefinition": "officially connected or associated with an organization",
    "example": "The hospital is affiliated with the university medical school."
  }
]` : `[
  {
    "original": "技术",
    "translation": "technology",
    "phonetic": "/tekˈnɒlədʒi/",
    "difficulty": "A2",
    "partOfSpeech": "noun",
    "shortDefinition": "the application of scientific knowledge for practical purposes",
    "example": "Technology continues to advance at a rapid pace."
  }
]`}

## Output:
Return only the JSON array and nothing else.`;
}

/**
 * 获取共享的提示词部分（CEFR、音标规则、输出格式）
 * @param {string} nativeLanguage - 用户母语
 * @param {string} learningLanguage - 用户学习语言
 * @param {boolean} isLearningFromSource - 学习语言词汇是否在 original 字段
 * @returns {string} 共享的提示词部分
 */
function getCommonSections(nativeLanguage, learningLanguage, isLearningFromSource) {
  const learningWordField = isLearningFromSource ? 'original' : 'translation';

  return `## CEFR Difficulty Levels:
A1 → A2 → B1 → B2 → C1 → C2

## Phonetic Format Rules:
- For English: use IPA like "/əˈfɪlieɪtɪd/" or "/tekˈnɒlədʒi/"
- For Chinese: use pinyin with tones like "líng gǎn"
- For Japanese: use romaji like "ko-n-ni-chi-wa"
- For Korean: use romanization like "an-nyeong"
- **IMPORTANT: The phonetic MUST be the pronunciation of the "${learningWordField}" field (${learningLanguage}), NOT the other field!**

## Required Output Fields:
- **original**: the original word from the text
- **translation**: the translated word in target language
- **phonetic**: pronunciation of the ${learningLanguage} word (from the "${learningWordField}" field)
- **difficulty**: CEFR level (A1/A2/B1/B2/C1/C2)
- **partOfSpeech**: grammatical category in learning language (${learningLanguage}) - e.g., "noun", "verb", "adjective"
- **shortDefinition**: brief definition in learning language (${learningLanguage}) - keep it concise (1-2 sentences max)
- **example**: a natural example sentence in learning language (${learningLanguage}) using the word in context`;
}
