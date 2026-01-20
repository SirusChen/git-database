import { defineConfig } from "vite";
import { resolve } from "path";
import { copyFileSync, mkdirSync, existsSync, watch } from "fs";
import { readdirSync, statSync } from "fs";

function copyPublicFiles() {
  const publicDir = resolve(__dirname, "public");
  const distDir = resolve(__dirname, "dist");
  
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  if (existsSync(publicDir)) {
    const files = readdirSync(publicDir);
    files.forEach((file) => {
      const srcPath = resolve(publicDir, file);
      const destPath = resolve(distDir, file);
      const stat = statSync(srcPath);
      
      if (stat.isFile()) {
        copyFileSync(srcPath, destPath);
        console.log(`✓ Copied: ${file}`);
      }
    });
  }
}

export default defineConfig(({ command }) => {
  const isDev = command === "serve";
  
  return {
    base: "./",
    build: {
      outDir: "dist",
      rollupOptions: {
        input: {
          panel: resolve(__dirname, "panel.html"),
        },
      },
      watch: isDev ? {} : null, // 开发模式下启用 watch
    },
    plugins: [
      {
        name: "copy-public",
        buildStart() {
          copyPublicFiles();
        },
        buildEnd() {
          // 确保在构建结束后再次复制，避免被覆盖
          copyPublicFiles();
        },
        configureServer() {
          // 开发模式下，启动时先构建一次
          return () => {
            // 监听 public 目录变化
            const publicDir = resolve(__dirname, "public");
            if (existsSync(publicDir)) {
              watch(publicDir, { recursive: true }, (eventType, filename) => {
                if (filename) {
                  copyPublicFiles();
                }
              });
            }
          };
        },
      },
    ],
  };
});
