import * as fs from 'fs';
import * as url from 'url';
import * as path from 'path';
import type { ExistingRawSourceMap, ResolvedId, TransformPluginContext } from 'rollup';
import type { Syntax } from 'sass';
import type {
  CssProcessors,
  CssProcessorInfo,
  CssProcessorResult,
  RollupCssResolve,
  ResolveResult,
  ResolveContext,
} from './types';
import { normalizePathSlashes } from './normalizePathSlashes';

const unkownImporterFilePlaceholder = '<unknown>';

const sassSyntaxMap: Record<Syntax, RegExp> = {
  scss: /\.scss$/,
  indented: /\.sass$/,
  css: /\.css$/,
};

const getSassSyntax = (filePath: string): Syntax => {
  const result = Object.entries(sassSyntaxMap).find(
    ([syntax, regex]) => regex.test(filePath) && syntax
  );
  if (result) {
    return result[0] as Syntax;
  }
  throw new Error(`Couldn't determine syntax of "${filePath}".`);
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

const travelPath = (pathToTravel: string, backwards?: boolean) => {
  const normalizedPath = normalizePathSlashes(pathToTravel);
  const pathSegments = normalizedPath.split('/');
  const finalPathSegments = backwards ? pathSegments.reverse() : pathSegments;
  const result = finalPathSegments
    .map((_, index) => {
      const segments = finalPathSegments.filter((_, i) => i <= index);
      return segments.length && path.join(...(backwards ? segments.reverse() : segments));
    })
    .filter(Boolean) as string[];
  return backwards ? result : result.reverse();
};

const resolvePaths = async (
  resolve: CssProcessorInfo['resolve'],
  importedPath: string,
  importer?: string | undefined
) => {
  let resolvedPath: string | null = null;
  const importedPathExists = fs.existsSync(importedPath);
  const pathsToResolve = [
    importedPath,
    ...(importedPathExists ? [] : travelPath(importedPath, true)),
  ];
  const resolvedImporter = importedPathExists
    ? importedPath
    : travelPath(importedPath).find((p) => fs.existsSync(p));
  const finalImporter =
    importer ||
    (importedPathExists || !resolvedImporter
      ? resolvedImporter
      : path.join(resolvedImporter, unkownImporterFilePlaceholder));

  for (let i = 0; i < pathsToResolve.length; i++) {
    const resolved = await resolve(pathsToResolve[i], finalImporter, '@import');

    if (resolved) {
      resolvedPath = resolved;
      break;
    }
  }
  return resolvedPath;
};

export const cssProcessors: CssProcessors = new Map<
  RegExp,
  (info: CssProcessorInfo) => CssProcessorResult | Promise<CssProcessorResult>
>([
  [
    /\.(s[ac]ss)$/,
    async (info) => {
      const { code, sourcemap, path: filePath, resolve } = info;
      const { default: sassCompiler } = (await import('sass').catch(() => null)) || {};

      if (sassCompiler) {
        try {
          const { css, sourceMap, loadedUrls } = await sassCompiler.compileStringAsync(code, {
            url: url.pathToFileURL(filePath),
            syntax: 'scss',
            sourceMap: sourcemap,
            importer: {
              canonicalize: (url) => new URL(url),
              async load(importedUrl) {
                const importedPath = url.fileURLToPath(importedUrl);
                const resolvedPath = await resolvePaths(resolve, importedPath);

                if (resolvedPath) {
                  return {
                    contents: fs.readFileSync(resolvedPath).toString(),
                    syntax: getSassSyntax(resolvedPath),
                  };
                }

                throw new Error(`Couldn't resolve "${path.basename(importedPath)}".`);
              },
            },
          });

          const watchFiles = loadedUrls.map((loadedUrl) => url.fileURLToPath(loadedUrl));

          return { css, map: (sourceMap as ExistingRawSourceMap | undefined) || null, watchFiles };
        } catch (error) {
          throw new Error(`Couldn't compile "${filePath}". (${error})`);
        }
      }
      throw new Error(
        'Please install the "sass" package to support ".scss" / ".sass" file compilation.'
      );
    },
  ],
  [
    /\.less$/,
    async (info) => {
      const { code, sourcemap, path: filePath, resolve } = info;
      const { default: lessCompiler } = (await import('less').catch(() => null)) || {};

      if (lessCompiler) {
        try {
          const { css, map, imports } = await lessCompiler.render(code, {
            filename: filePath,
            sourceMap: {
              outputSourceFiles: sourcemap,
            },
            plugins: [
              {
                install({ FileManager }, pluginManager) {
                  pluginManager.addFileManager(
                    new (class extends FileManager {
                      supports = () => true;
                      async loadFile(fileName: string, fileDir: string) {
                        const importedPath = path.resolve(fileDir, fileName);
                        const resolvedPath = await resolvePaths(
                          resolve,
                          importedPath,
                          path.resolve(fileDir, unkownImporterFilePlaceholder)
                        );

                        if (resolvedPath) {
                          return {
                            filename: resolvedPath,
                            contents: fs.readFileSync(resolvedPath).toString(),
                          };
                        }

                        throw new Error(`Couldn't resolve "${fileName}".`);
                      }
                    })()
                  );
                },
              },
            ],
          });

          return {
            css,
            map,
            watchFiles: imports,
          };
        } catch (error) {
          throw new Error(`Couldn't compile "${filePath}". (${error})`);
        }
      }
      throw new Error('Please install the "less" package to support ".less" file compilation.');
    },
  ],
  [
    /\.(styl|stylus)$/,
    async (info) => {
      const { code, sourcemap, path: filePath } = info;
      const { default: stylusCompiler } = (await import('stylus').catch(() => null)) || {};

      if (stylusCompiler) {
        try {
          const sourcemapObj = sourcemap
            ? {
                sourcemap: {
                  comment: false,
                  inline: false,
                },
              }
            : {};
          const renderer = stylusCompiler(code, {
            filename: filePath,
            // @ts-ignore
            ...sourcemapObj,
          });
          const css = renderer.render();
          const watchFiles = renderer.deps();
          // @ts-ignore
          const map = renderer.sourcemap as ExistingRawSourceMap | undefined;

          return {
            css,
            map,
            watchFiles,
          };
        } catch (error) {
          throw new Error(`Couldn't compile "${filePath}". (${error})`);
        }
      }
      throw new Error('Please install the "stylus" package to support ".styl" file compilation.');
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
    resolve: async (
      pathToResolve: string,
      importer: string | undefined,
      context: ResolveContext
    ) => {
      const defaultResult = getDefaultResolveResult(
        await rollupPluginContext.resolve(pathToResolve, importer)
      );
      const result =
        typeof resolve === 'function'
          ? await resolve(
              pathToResolve,
              importer ? path.dirname(importer) : importer,
              context,
              defaultResult
            )
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
