import { defineConfig } from 'vite';

// 상대 경로 base: GitHub Pages(/song/)와 Vercel(/) 양쪽에서 그대로 동작
export default defineConfig({
  base: './',
});
