/**
 * TOON 格式编解码工具模块
 * 提供 TOON 格式检测、解码和统一的内容解码接口
 */

/**
 * 从 AI 响应中提取纯净的 TOON 内容
 * AI 可能在 TOON 内容前输出废话，如 "Here is the TOON format:"
 *
 * @param {string} content - 原始响应内容
 * @returns {string} 提取的 TOON 内容（或原始内容）
 */
function extractToonContent(content) {
  const lines = content.split('\n');

  // 查找 TOON header 行: [N]{fields}:
  const headerIndex = lines.findIndex(line => /^\[\d+\]\{[^}]+\}:/.test(line.trim()));

  if (headerIndex === -1) {
    return content;
  }

  // 从 header 行开始提取
  const toonLines = [lines[headerIndex]];

  // 提取后续的数据行（以 2 个空格开头）
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('  ') && line.trim()) {
      toonLines.push(line);
    } else if (line.trim() === '') {
      // 跳过空行
      continue;
    } else {
      // 遇到非数据行，停止
      break;
    }
  }

  return toonLines.join('\n');
}

/**
 * 检测内容是否为 TOON 格式
 * @param {string} content - 待检测的内容
 * @returns {boolean} 是否为 TOON 格式
 */
export function isToonFormat(content) {
  if (typeof window.TOON === 'undefined' || typeof window.TOON.isToonFormat !== 'function') {
    // TOON 库未加载，使用简化检测
    return false;
  }

  // 先提取可能的 TOON 内容再检测
  const extracted = extractToonContent(content);
  return window.TOON.isToonFormat(extracted);
}

/**
 * 修正 TOON 格式的行数声明
 * AI 返回的 TOON 格式中，头部声明的行数可能与实际数据行数不匹配
 *
 * @param {string} toonContent - TOON 格式内容
 * @returns {{ fixed: string, actualCount: number, declaredCount: number }} 修正结果
 */
function fixToonRowCount(toonContent) {
  // 统计数据行（以 2 个空格开头的非空行）
  const lines = toonContent.split('\n');
  const dataLines = lines.filter(line => line.startsWith('  ') && line.trim());
  const actualCount = dataLines.length;

  // 提取头部声明的行数
  const headerMatch = toonContent.match(/^\[(\d+)\](\{[^}]+\}:)/m);
  if (!headerMatch) {
    return { fixed: toonContent, actualCount, declaredCount: actualCount };
  }

  const declaredCount = parseInt(headerMatch[1], 10);

  // 如果行数不匹配，修正头部
  if (declaredCount !== actualCount) {
    const fixed = toonContent.replace(
      /^\[(\d+)\](\{[^}]+\}:)/m,
      `[${actualCount}]$2`
    );
    return { fixed, actualCount, declaredCount };
  }

  return { fixed: toonContent, actualCount, declaredCount };
}

/**
 * 解码 TOON 格式内容
 * @param {string} toonContent - TOON 格式的内容
 * @returns {string} JSON 字符串
 * @throws {Error} 解码失败时抛出异常
 */
export function decodeToon(toonContent) {
  if (typeof window.TOON === 'undefined' || typeof window.TOON.decode !== 'function') {
    throw new Error('TOON 库未加载');
  }

  // 预处理：提取纯净的 TOON 内容（去除 AI 可能输出的前置废话）
  const cleanContent = extractToonContent(toonContent);

  try {
    // 调用 TOON.decode() 解码为 JavaScript 对象
    const decoded = window.TOON.decode(cleanContent);

    // 转换为 JSON 字符串供现有解析器使用
    return JSON.stringify(decoded);
  } catch (error) {
    const { fixed, actualCount, declaredCount } = fixToonRowCount(cleanContent);
    try {
        const decoded = window.TOON.decode(fixed);
        return JSON.stringify(decoded);
    } catch (retryError) {
        throw new Error(`TOON 解码失败 (修正后仍失败): ${retryError.message}`);
    }
  }
}

/**
 * 统一的内容解码接口
 * 根据 outputFormat 配置和内容格式自动选择解码方式
 *
 * @param {string} content - 待解码的内容
 * @param {string} outputFormat - 输出格式配置 ('standard' | 'toon')
 * @returns {string} 解码后的 JSON 字符串（或原始内容）
 */
export function decodeContent(content, outputFormat) {
  if (!content || typeof content !== 'string') {
    return content;
  }

  // 如果用户启用了 TOON 格式
  if (outputFormat === 'toon') {
    // 检测是否为 TOON 格式
    if (isToonFormat(content)) {
      try {
        const decodedJson = decodeToon(content);
        console.debug('[TOON] 成功解码 TOON 格式响应');
        return decodedJson;
      } catch (error) {
        console.error('[TOON] 解码失败:', error.message);
        // 解析失败，返回原始内容让调用者处理
        return content;
      }
    }
  }

  // 标准格式或 TOON 检测失败，直接返回内容
  return content;
}
