// apps/desktop/src/renderer/utils/TikzRenderEngine.ts
import { tikz } from 'tikzjax';

export class TikzRenderEngine {
  private static cache = new Map<string, string>();

  public static async renderToSvg(tikzCode: string): Promise<string> {
    const cleanCode = tikzCode.trim();
    if (this.cache.has(cleanCode)) return this.cache.get(cleanCode)!;

    try {
      const texDocument = `
        \\documentclass[tikz,border=2pt]{standalone}
        \\usepackage{amsmath,amssymb,bm}
        \\usepackage[circuitikz]{circuitikz}
        \\begin{document}
        ${cleanCode}
        \\end{document}
      `;

      const svgOutput = await tikz.default(texDocument, { showConsole: false, tidy: true });
      this.cache.set(cleanCode, svgOutput);
      return svgOutput;
    } catch (err) {
      console.error('[TikzRenderEngine] 描画エラー:', err);
      return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="60"><rect width="100%" height="100%" fill="#fee2e2"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#dc2626">⚠️ TikZ 描画エラー</text></svg>`;
    }
  }

  public static clearCache(): void {
    this.cache.clear();
  }
}
