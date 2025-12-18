/**
 * VocabMeld 构建脚本
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

// ===== 图标生成 =====

const iconSizes = [16, 32, 48, 128];
const iconsDir = path.join(__dirname, '..', 'icons');

// 检查图标目录
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// 创建 HTML 文件用于生成图标
const generateIconsHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Generate VocabMeld Icons</title>
  <style>
    body { font-family: sans-serif; padding: 20px; background: #1e293b; color: white; }
    .icon-grid { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 20px; }
    .icon-item { text-align: center; }
    canvas { background: transparent; border: 1px solid #334155; border-radius: 8px; }
    button { margin-top: 10px; padding: 10px 20px; cursor: pointer; }
    .download-links { margin-top: 20px; }
    .download-links a { color: #818cf8; margin-right: 15px; }
  </style>
</head>
<body>
  <h1>VocabMeld Icon Generator</h1>
  <p>点击按钮生成并下载图标文件</p>
  
  <div class="icon-grid" id="iconGrid"></div>
  
  <button onclick="downloadAll()">下载所有图标</button>
  <div class="download-links" id="downloadLinks"></div>

  <script>
    const sizes = [16, 32, 48, 128];
    const iconGrid = document.getElementById('iconGrid');
    const downloadLinks = document.getElementById('downloadLinks');
    
    function drawIcon(ctx, size) {
      const scale = size / 128;
      
      // 渐变背景
      const gradient = ctx.createLinearGradient(0, 0, size, size);
      gradient.addColorStop(0, '#6366f1');
      gradient.addColorStop(0.5, '#8b5cf6');
      gradient.addColorStop(1, '#a855f7');
      
      // 绘制圆形背景
      ctx.beginPath();
      ctx.arc(size/2, size/2, size/2 - 2*scale, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
      
      // 内部光晕
      ctx.beginPath();
      ctx.arc(size/2, size/2, size/2 - 10*scale, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 2 * scale;
      ctx.stroke();
      
      // 绘制 V 字母
      ctx.strokeStyle = '#fef3c7';
      ctx.lineWidth = 6 * scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      
      ctx.beginPath();
      ctx.moveTo(28 * scale, 30 * scale);
      ctx.lineTo(48 * scale, 80 * scale);
      ctx.lineTo(64 * scale, 55 * scale);
      ctx.lineTo(80 * scale, 80 * scale);
      ctx.lineTo(100 * scale, 30 * scale);
      ctx.stroke();
      
      // 绘制 M 字母
      ctx.lineWidth = 4 * scale;
      ctx.beginPath();
      ctx.moveTo(44 * scale, 95 * scale);
      ctx.lineTo(44 * scale, 78 * scale);
      ctx.lineTo(58 * scale, 88 * scale);
      ctx.lineTo(72 * scale, 78 * scale);
      ctx.lineTo(72 * scale, 95 * scale);
      ctx.stroke();
      
      // 星点装饰
      ctx.fillStyle = '#fef3c7';
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      ctx.arc(98 * scale, 25 * scale, 3 * scale, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(25 * scale, 45 * scale, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(100 * scale, 65 * scale, 2.5 * scale, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.globalAlpha = 1;
    }
    
    // 生成所有尺寸的图标
    sizes.forEach(size => {
      const item = document.createElement('div');
      item.className = 'icon-item';
      
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      canvas.id = 'icon' + size;
      
      const ctx = canvas.getContext('2d');
      drawIcon(ctx, size);
      
      const label = document.createElement('p');
      label.textContent = size + 'x' + size;
      
      item.appendChild(canvas);
      item.appendChild(label);
      iconGrid.appendChild(item);
    });
    
    function downloadAll() {
      sizes.forEach(size => {
        const canvas = document.getElementById('icon' + size);
        const link = document.createElement('a');
        link.download = 'icon' + size + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
      });
    }
  </script>
</body>
</html>`;

fs.writeFileSync(path.join(iconsDir, 'generate_icons.html'), generateIconsHtml);

console.log('VocabMeld Build Script');
console.log('======================');
console.log('');
console.log('图标生成器已创建: icons/generate_icons.html');
console.log('请在浏览器中打开该文件并下载生成的图标。');
console.log('');
console.log('或者使用现有的 SVG 图标作为基础。');
console.log('');

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
        js: '// VocabMeld Content Script (Bundled)\n',
      },
    });

    console.log('✓ content.js 已成功打包到 dist/content.js');
  } catch (error) {
    console.error('✗ 打包 content.js 失败:', error);
    process.exit(1);
  }
}

// ===== 主函数 =====
async function main() {
  await bundleSegmentit();
  await bundleContentScript();
  console.log('');
  console.log('✓ 构建完成！');
}

main().catch(error => {
  console.error('构建失败:', error);
  process.exit(1);
});
