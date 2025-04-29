// generate-card.js
const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');
// 获取GitHub数据的示例
async function fetchGitHubData(username) {
  const fetch = (await import('node-fetch')).default; // 动态导入 node-fetch
  const response = await fetch(`https://api.github.com/users/${username}`);
  const data = await response.json();

  return {
    name: data.name,
    repos: data.public_repos,
    followers: data.followers,
    following: data.following,
    company: data.company,
    location: data.location,
    blog: data.blog,
    email: data.email,
    bio: data.bio,
    avatar_url: data.avatar_url,
    // 其他需要的数据
  };
}

async function generateAnimeJSCard() {
  const data = await fetchGitHubData('dodolalorc').catch(error => {
    console.error('Error fetching GitHub data:', error);
    return null; // 返回 null 以处理错误
  });

  if (!data) {
    throw new Error('Failed to fetch GitHub data. Cannot generate card.');
  }
  return `
    <svg width="600" height="350" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          @keyframes pulse {
            0% { opacity: 0.7; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.2); }
            100% { opacity: 0.7; transform: scale(1); }
          }
          @keyframes slide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        </style>
        <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#2d3747" />
          <stop offset="100%" stop-color="#1e293b" />
        </linearGradient>
      </defs>
      
      <!-- 卡片背景 -->
      <rect width="100%" height="100%" rx="15" fill="url(#gradient)" />
      
      <!-- 脉冲点 -->
      <circle cx="570" cy="40" r="5" fill="#4ade80" style="animation: pulse 1.5s infinite" />
      
      <!-- 头像 -->
      <clipPath id="avatarClip">
        <circle cx="540" cy="70" r="40" />
      </clipPath>
      <image href="${data.avatar_url}" x="500" y="30" width="80" height="80" clip-path="url(#avatarClip)" />
      
      <!-- 文本内容 -->
      <text x="30" y="60" font-family="Arial" font-size="24" font-weight="bold" fill="white">${data.bio}</text>
      <text x="30" y="90" font-family="Arial" font-size="16" fill="rgba(255,255,255,0.8)">Passionate about open source</text>
      
      <!-- 技能标签 -->
      <rect x="30" y="120" rx="10" ry="10" width="100" height="30" fill="rgba(255,255,255,0.1)" />
      <text x="80" y="140" font-family="Arial" font-size="14" text-anchor="middle" fill="white">JavaScript</text>
      
      <rect x="140" y="120" rx="10" ry="10" width="70" height="30" fill="rgba(255,255,255,0.1)" />
      <text x="175" y="140" font-family="Arial" font-size="14" text-anchor="middle" fill="white">Vue</text>
      
      <!-- 统计数据 -->
      <text x="100" y="250" font-family="Arial" font-size="28" text-anchor="middle" fill="white">${data.repos}</text>
      <text x="100" y="280" font-family="Arial" font-size="12" text-anchor="middle" fill="rgba(255,255,255,0.8)">Repositories</text>
      
      <!-- 动画边框 -->
      <rect x="0" y="345" width="100%" height="2" fill="#60a5fa">
        <animate attributeName="x" values="-600;600" dur="2s" repeatCount="indefinite" />
      </rect>
    </svg>
  `;
}

// 保存png文件
async function saveAsPng(svgContent, outputPath) {
  const canvas = createCanvas(600, 350);
  const ctx = canvas.getContext('2d');
  const svgBuffer = Buffer.from(svgContent);
  const image = await loadImage('data:image/svg+xml;base64,' + svgBuffer.toString('base64'));
  ctx.drawImage(image, 0, 0);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outputPath, buffer);
  console.log(`PNG card generated: ${outputPath}`);
}

// 保存SVG文件
(async () => {
  const svgContent = await generateAnimeJSCard();
  fs.writeFileSync('card.svg', svgContent);
  console.log('SVG card generated: card.svg');
})();