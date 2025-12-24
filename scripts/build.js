/**
 * Sapling 构建脚本
 * 1. 生成不同尺寸的图标
 * 2. 打包 segmentit 为浏览器可用的独立文件
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

// ===== 打包 segmentit =====
async function bundleSegmentit() {
  console.log('正在打包 segmentit...');

  const vendorDir = path.join(__dirname, '..', 'vendor');
  if (!fs.existsSync(vendorDir)) {
    fs.mkdirSync(vendorDir, { recursive: true });
  }

  // 创建入口文件
  const entryContent = `
const Segmentit = require('segmentit');

// segmentit 的 CommonJS 导出是一个对象（包含 Segment 构造器、useDefault 等）
// 为了兼容旧代码：暴露 window.Segment 为「构造器」而不是整个导出对象
window.Segmentit = Segmentit;
window.Segment = (typeof Segmentit === 'function' && Segmentit)
  || (typeof Segmentit.Segment === 'function' && Segmentit.Segment)
  || (typeof Segmentit.default === 'function' && Segmentit.default);

// 兼容旧的 segment.useDefault() 调用方式
if (window.Segment && window.Segment.prototype && typeof window.Segment.prototype.useDefault !== 'function' && typeof Segmentit.useDefault === 'function') {
  window.Segment.prototype.useDefault = function() {
    Segmentit.useDefault(this);
    return this;
  };
}
`;

  const entryPath = path.join(__dirname, 'segmentit-entry.js');
  fs.writeFileSync(entryPath, entryContent);

  try {
    await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      outfile: path.join(vendorDir, 'segmentit.bundle.js'),
      minify: false,
      sourcemap: true,
    });

    console.log('✓ segmentit 已成功打包到 vendor/segmentit.bundle.js');

    // 清理临时入口文件
    fs.unlinkSync(entryPath);
  } catch (error) {
    console.error('✗ 打包 segmentit 失败:', error);
    process.exit(1);
  }
}

// ===== 打包 content.js =====
async function bundleContentScript() {
  console.log('正在打包 content.js...');

  const distDir = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, '..', 'js', 'content.js')],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      outfile: path.join(distDir, 'content.js'),
      minify: false,
      sourcemap: true,
      // 保留 IIFE 包装器以兼容 Chrome Extension
      banner: {
        js: '// Sapling Content Script (Bundled)\n',
      },
    });

    console.log('✓ content.js 已成功打包到 dist/content.js');
  } catch (error) {
    console.error('✗ 打包 content.js 失败:', error);
    process.exit(1);
  }
}

// ===== 打包 vocab-test-ui.js =====
async function bundleVocabTest() {
  console.log('正在打包 vocab-test-ui.js...');

  const distDir = path.join(__dirname, '..', 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, '..', 'js', 'vocab-test-ui.js')],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      outfile: path.join(distDir, 'vocab-test.js'),
      minify: false,
      sourcemap: true,
      banner: {
        js: '// Sapling Vocab Test UI (Bundled)\n',
      },
    });

    console.log('✓ vocab-test-ui.js 已成功打包到 dist/vocab-test.js');
  } catch (error) {
    console.error('✗ 打包 vocab-test-ui.js 失败:', error);
    process.exit(1);
  }
}

// ===== 主函数 =====
async function main() {
  await bundleSegmentit();
  await bundleContentScript();
  await bundleVocabTest();
  console.log('');
  console.log('✓ 构建完成！');
}

main().catch(error => {
  console.error('构建失败:', error);
  process.exit(1);
});
