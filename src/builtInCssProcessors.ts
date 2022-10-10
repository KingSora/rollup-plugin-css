import * as fs from 'fs';
import * as url from 'url';
import * as path from 'path';
import { normalizePathSlashes } from './normalizePathSlashes';
import type { ExistingRawSourceMap } from 'rollup';
import type { RenderOptions } from 'stylus';
import type { Syntax, Options as SassOptions } from 'sass';
import type PostcssModulesPlugin from 'postcss-modules';
import type { CssProcessorInfo, CssProcessorResult } from './types';

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

const travelPath = (pathToTravel: string, backwards?: boolean) => {
  const normalizedPath = normalizePathSlashes(pathToTravel);
  const pathSegments = normalizedPath.split('/');
  const finalPathSegments = backwards ? pathSegments.reverse() : pathSegments;
  const result = finalPathSegments
    .map((_, index) => {
      const segments = finalPathSegments.filter((_, i) => i <= index);
      return (
        segments.length &&
        normalizePathSlashes(path.join(...(backwards ? segments.reverse() : segments)))
      );
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

export const sassProcessor = async (
  info: CssProcessorInfo,
  options: SassOptions<'async'>
): Promise<CssProcessorResult> => {
  const { css: code, sourcemap, path: filePath, resolve } = info;
  const { default: sassCompiler } = (await import('sass').catch(() => null)) || {};

  if (sassCompiler) {
    try {
      const {
        css,
        sourceMap: rawSourcemap,
        loadedUrls,
      } = await sassCompiler.compileStringAsync(code, {
        ...options,
        url: url.pathToFileURL(filePath),
        syntax: 'scss',
        sourceMap: sourcemap,
        sourceMapIncludeSources: true,
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

      const map = rawSourcemap ? JSON.stringify(rawSourcemap) : undefined;
      const watchFiles = loadedUrls.map((loadedUrl) => url.fileURLToPath(loadedUrl));

      return { css, map, watchFiles };
    } catch (error) {
      throw new Error(`Sass: Couldn't compile "${filePath}". (${error})`);
    }
  }
  throw new Error(
    'Please install the "sass" package to support ".scss" / ".sass" file compilation.'
  );
};

export const lessProcessor = async (
  info: CssProcessorInfo,
  options: Record<string, any>
): Promise<CssProcessorResult> => {
  const { css: code, sourcemap, path: filePath, resolve } = info;
  const { default: lessCompiler } = (await import('less').catch(() => null)) || {};

  if (lessCompiler) {
    try {
      const { css, map, imports } = await lessCompiler.render(code, {
        ...options,
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
      throw new Error(`Less: Couldn't compile "${filePath}". (${error})`);
    }
  }
  throw new Error('Please install the "less" package to support ".less" file compilation.');
};

export const stylusProcessor = async (
  info: CssProcessorInfo,
  options: RenderOptions
): Promise<CssProcessorResult> => {
  const { css: code, sourcemap, path: filePath } = info;
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
        ...options,
        filename: filePath,
        // @ts-ignore
        ...sourcemapObj,
      });
      // @ts-ignore
      const rawSourcemap = renderer.sourcemap as ExistingRawSourceMap | undefined;
      const css = renderer.render();
      const map = rawSourcemap ? JSON.stringify(rawSourcemap) : undefined;
      const watchFiles = renderer.deps();

      return {
        css,
        map,
        watchFiles,
      };
    } catch (error) {
      throw new Error(`Stylus: Couldn't compile "${filePath}". (${error})`);
    }
  }
  throw new Error('Please install the "stylus" package to support ".styl" file compilation.');
};

export const cssModulesProcessor = async (
  info: CssProcessorInfo,
  options: Parameters<PostcssModulesPlugin>[0]
): Promise<CssProcessorResult> => {
  const { css: code, map: prevSourcemap, sourcemap, path: filePath } = info;
  const { default: postcss } = (await import('postcss').catch(() => null)) || {};
  const { default: postcssModules } = (await import('postcss-modules').catch(() => null)) || {};

  if (postcss && postcssModules) {
    try {
      const { css, map: rawSourcemapObj } = await postcss([postcssModules(options)]).process(code, {
        from: filePath,
        map: sourcemap
          ? {
              inline: false,
              annotation: false,
              absolute: true,
              sourcesContent: true,
              prev: prevSourcemap,
            }
          : undefined,
      });

      const rawSourcemap = rawSourcemapObj.toJSON();
      const map = rawSourcemap ? JSON.stringify(rawSourcemap) : undefined;

      return {
        css,
        map,
      };
    } catch (error) {
      throw new Error(`Css Modules: Couldn't compile "${filePath}". (${error})`);
    }
  }
  throw new Error(
    'Please install the "postcss" and "postcss-modules" package to support css modules compilation.'
  );
};
