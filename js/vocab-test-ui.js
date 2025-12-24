/**
 * Sapling 词汇量测试 UI 逻辑
 */

import { VocabTest, CEFR_DESCRIPTIONS } from './services/vocab-test.js';
import { storage } from './core/storage/StorageService.js';

// DOM 元素
const welcomeScreen = document.getElementById('welcomeScreen');
const testScreen = document.getElementById('testScreen');
const resultScreen = document.getElementById('resultScreen');
const loadingScreen = document.getElementById('loadingScreen');

const startTestBtn = document.getElementById('startTestBtn');
const skipTestBtn = document.getElementById('skipTestBtn');
const knowBtn = document.getElementById('knowBtn');
const dontKnowBtn = document.getElementById('dontKnowBtn');
const finishBtn = document.getElementById('finishBtn');

const progressText = document.getElementById('progressText');
const progressFill = document.getElementById('progressFill');
const levelBadge = document.getElementById('levelBadge');
const wordDisplay = document.getElementById('wordDisplay');
const exampleDisplay = document.getElementById('exampleDisplay');
const resultLevel = document.getElementById('resultLevel');
const resultDescription = document.getElementById('resultDescription');
const statsDisplay = document.getElementById('statsDisplay');

// 测试实例
let vocabTest = null;

/**
 * 初始化
 */
document.addEventListener('DOMContentLoaded', () => {
  // 检查是否已经完成过测试
  storage.remote.get(['vocabTestCompleted', 'difficultyLevel'], (result) => {
    if (result.vocabTestCompleted) {
      // 已完成测试，关闭窗口或跳转到设置页面
      window.location.href = 'options.html';
    }
  });

  // 绑定事件
  startTestBtn.addEventListener('click', startTest);
  skipTestBtn.addEventListener('click', skipTest);
  knowBtn.addEventListener('click', () => answerWord(true));
  dontKnowBtn.addEventListener('click', () => answerWord(false));
  finishBtn.addEventListener('click', finishTest);
});

/**
 * 开始测试
 */
async function startTest() {
  vocabTest = new VocabTest();
  
  // 显示加载界面
  showScreen('loading');
  loadingScreen.querySelector('p').textContent = '正在加载单词表...';
  
  try {
    // 初始化测试（加载单词表）
    await vocabTest.initialize();
    
    // 开始测试
    showScreen('test');
    showNextWord();
  } catch (error) {
    console.error('[Sapling] Failed to start vocab test:', error);
    alert('加载单词表失败，请刷新页面重试');
  }
}

/**
 * 跳过测试（使用默认 B1 等级）
 */
async function skipTest() {
  const confirmed = confirm('跳过测试将使用默认的 B1 (进阶级) 难度等级。您确定要跳过吗？');
  if (!confirmed) return;

  showScreen('loading');

  await storage.remote.setAsync({
    difficultyLevel: 'B1',
    vocabTestCompleted: true,
    vocabTestSkipped: true
  });

  setTimeout(() => {
    window.location.href = 'options.html';
  }, 500);
}

/**
 * 回答当前单词
 */
function answerWord(known) {
  const result = vocabTest.answerCurrent(known);
  
  if (result.completed) {
    // 测试完成，显示结果
    showResult(result.level);
  } else {
    // 继续测试
    showNextWord();
  }
}

/**
 * 显示下一个单词
 */
function showNextWord() {
  const word = vocabTest.getCurrentWord();
  if (!word) return;

  // 更新进度
  const progress = word.progress;
  progressText.textContent = `正在测试: ${word.level} 级别 (${progress.current}/${progress.total})`;
  progressFill.style.width = `${progress.percentage}%`;

  // 更新单词显示
  const description = CEFR_DESCRIPTIONS[word.level];
  levelBadge.textContent = `${word.level} - ${description.title.split(' ')[1].replace(/[()]/g, '')}`;
  wordDisplay.textContent = word.word;
  
  // 如果有例句则显示，否则隐藏
  if (word.example && word.example.trim()) {
    exampleDisplay.textContent = word.example;
    exampleDisplay.style.display = 'block';
  } else {
    exampleDisplay.style.display = 'none';
  }

  // 添加动画效果
  wordDisplay.style.opacity = '0';
  exampleDisplay.style.opacity = '0';
  setTimeout(() => {
    wordDisplay.style.opacity = '1';
    if (word.example && word.example.trim()) {
      exampleDisplay.style.opacity = '1';
    }
  }, 100);
}

/**
 * 显示测试结果
 */
function showResult(level) {
  const description = CEFR_DESCRIPTIONS[level];
  const stats = vocabTest.getStats();

  // 更新结果显示
  resultLevel.textContent = level;
  resultDescription.innerHTML = `
    <h3>${description.title}</h3>
    <p>${description.description}</p>
    <p><strong>词汇量:</strong> ${description.vocabulary}</p>
  `;

  // 生成统计信息
  const levels = Object.keys(stats.knownCount);
  let statsHTML = '';
  
  for (const levelKey of levels) {
    const known = stats.knownCount[levelKey];
    const total = stats.totalWords[levelKey];
    
    if (total > 0) {
      const percentage = Math.round((known / total) * 100);
      statsHTML += `
        <div class="stat-item">
          <div class="stat-label">${levelKey} 级别</div>
          <div class="stat-value">${known}/${total}</div>
          <div class="stat-label">${percentage}% 认识</div>
        </div>
      `;
    }
  }
  
  statsDisplay.innerHTML = statsHTML;

  // 显示结果界面
  showScreen('result');

  // 自动保存结果（但不关闭窗口，等待用户确认）
  storage.remote.set({
    difficultyLevel: level,
    vocabTestResult: {
      level: level,
      stats: stats,
      timestamp: Date.now()
    }
  }, () => {});
}

/**
 * 完成测试
 */
async function finishTest() {
  showScreen('loading');

  // 标记测试已完成
  await storage.remote.setAsync({
    vocabTestCompleted: true
  });

  // 延迟跳转到设置页面
  setTimeout(() => {
    window.location.href = 'options.html';
  }, 500);
}

/**
 * 切换显示的界面
 */
function showScreen(screen) {
  welcomeScreen.style.display = 'none';
  testScreen.style.display = 'none';
  resultScreen.style.display = 'none';
  loadingScreen.style.display = 'none';

  switch (screen) {
    case 'welcome':
      welcomeScreen.style.display = 'block';
      break;
    case 'test':
      testScreen.style.display = 'block';
      break;
    case 'result':
      resultScreen.style.display = 'block';
      break;
    case 'loading':
      loadingScreen.style.display = 'block';
      break;
  }
}

// 为单词和例句添加过渡动画
wordDisplay.style.transition = 'opacity 0.3s ease';
exampleDisplay.style.transition = 'opacity 0.3s ease';

