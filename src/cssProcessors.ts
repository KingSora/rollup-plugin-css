import type { CssProcessors, CssProcessorResult } from './types';

export const preprocessors: CssProcessors = new Map([
  [
    /\.scss$/,
    async () => {
      return { css: '', map: null };
    },
  ],
  [
    /\.sass$/,
    async () => {
      return { css: '', map: null };
    },
  ],
  [
    /\.(styl|stylus)$/,
    async () => {
      return { css: '', map: null };
    },
  ],
]);

export const runCssProcessors = async (
  cssProcessors: CssProcessors,
  code: string,
  id: string
): Promise<CssProcessorResult> => {
  if (typeof cssProcessors === 'function') {
    const result = await cssProcessors(code, id);
    return result;
  } else {
    for (const entry of cssProcessors.entries()) {
      const [key, value] = entry;
      if (key.test(id)) {
        const result = await value(code);
        return result;
      }
    }
  }
  return { css: code, map: null };
};
