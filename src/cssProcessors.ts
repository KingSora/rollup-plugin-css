import * as fs from 'fs';
import * as url from 'url';
import type { ExistingRawSourceMap, ResolvedId, TransformPluginContext } from 'rollup';
import type { Syntax } from 'sass';
import type {
  CssProcessors,
  CssProcessorInfo,
  CssProcessorResult,
  RollupCssResolve,
  ResolveResult,
} from './types';

const sassSyntaxMap: Record<Syntax, RegExp> = {
  scss: /\.scss$/,
  indented: /\.sass$/,
  css: /\.css$/,
};

const getSassSyntax = (path: string): Syntax => {
  const result = Object.entries(sassSyntaxMap).find(
    ([syntax, regex]) => regex.test(path) && syntax
  );
  if (result) {
    return result[0] as Syntax;
  }
  throw new Error(`Couldn't determine syntax of "${path}".`);
};

const getDefaultResolveResult = (result: ResolvedId | null): ResolveResult => {
  if (result) {
    const { id, external } = result;
    return {
      path: id,
      external: !!external,
    };
  }
  return result;
};

export const preprocessors: CssProcessors = new Map<
  RegExp,
  (info: CssProcessorInfo) => CssProcessorResult | Promise<CssProcessorResult>
>([
  [
    /\.(s[ac]ss)$/,
    async (info) => {
      const { code, sourcemap, path, resolve } = info;
      const { default: sassCompiler } = (await import('sass')) || {};

      if (sassCompiler) {
        const { css, sourceMap } = await sassCompiler.compileStringAsync(code, {
          url: url.pathToFileURL(path),
          syntax: 'scss',
          sourceMap: sourcemap,
          importer: {
            canonicalize: (url) => new URL(url),
            async load(canonicalUrl) {
              const resolvedPath = await resolve(url.fileURLToPath(canonicalUrl));
              if (resolvedPath) {
                return {
                  contents: fs.readFileSync(resolvedPath).toString(),
                  syntax: getSassSyntax(resolvedPath),
                };
              }
              return null;
            },
          },
        });

        return { css, map: (sourceMap as ExistingRawSourceMap | undefined) || null };
      }
      throw new Error(
        'Please install the "sass" package to support ".scss" / ".sass" file compilation.'
      );
    },
  ],
  [
    /\.less$/,
    async (info) => {
      const { code, sourcemap, path } = info;
      const { default: lessCompiler } = (await import('less')) || {};

      if (lessCompiler) {
        const { css, map } = await lessCompiler.render(code, {
          filename: path,
          sourceMap: {
            outputSourceFiles: sourcemap,
          },
        });

        return {
          css,
          map,
        };
      }
      throw new Error(
        'Please install the "sass" package to support ".scss" / ".sass" file compilation.'
      );
    },
  ],
  [
    /\.(styl|stylus)$/,
    async (info) => {
      const { code, sourcemap, path } = info;
      const { default: stylusCompiler } = (await import('stylus')) || {};

      if (stylusCompiler) {
        stylusCompiler.render(code, {});
      }
      return { css: '', map: null };
    },
  ],
]);

export const runCssProcessors = async (
  cssProcessors: CssProcessors,
  code: string,
  sourcemap: boolean,
  id: string,
  resolve: RollupCssResolve,
  rollupPluginContext: TransformPluginContext
): Promise<CssProcessorResult> => {
  const info: CssProcessorInfo = {
    code,
    sourcemap,
    path: id,
    resolve: async (pathToResolve: string) => {
      const defaultResult = getDefaultResolveResult(
        await rollupPluginContext.resolve(pathToResolve)
      );
      const result =
        typeof resolve === 'function'
          ? await resolve(pathToResolve, false, defaultResult)
          : defaultResult;
      if (result) {
        const { path, external } = result;
        return external ? null : path;
      }
      return result;
    },
  };
  if (typeof cssProcessors === 'function') {
    const result = await cssProcessors(info);
    return result;
  } else {
    for (const entry of cssProcessors.entries()) {
      const [key, value] = entry;
      if (key.test(id)) {
        const result = await value(info);
        return result;
      }
    }
  }
  return { css: code, map: null };
};
