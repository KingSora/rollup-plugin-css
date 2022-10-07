import * as fs from 'fs';
import esbuild from 'esbuild';
import { normalizePathSlashes } from './normalizePathSlashes';
import {
  templateInterpolatePrefix,
  templateInterpolateSuffix,
  templateInterpolateSymbol,
} from './render';
import type { BuildOptions, StdinOptions, ImportKind } from 'esbuild';
import type { ResolvedId, SourceMapInput, TransformPluginContext } from 'rollup';
import type {
  RollupCssAssets,
  RollupCssResolve,
  AssetsInline,
  ResolveContext,
  ResolveResult,
  CssInputItem,
} from './types';

interface EsbuildUserForcedOptions {
  sourcemap: boolean;
  minify: boolean;
}

const processedImportKinds: ImportKind[] = ['url-token', 'import-rule'];

const getIsInlined = (path: string, inlineOption: AssetsInline): boolean => {
  const isFunction = typeof inlineOption === 'function';
  const isRegExp = inlineOption instanceof RegExp;
  const isArray = Array.isArray(inlineOption);

  if (isFunction) {
    return inlineOption(path);
  }

  if (isRegExp) {
    return inlineOption.test(path);
  }

  if (isArray) {
    return !!inlineOption.find((regexOrFn) =>
      typeof regexOrFn === 'function' ? regexOrFn(path) : regexOrFn.test(path)
    );
  }

  return !!inlineOption;
};

const getResolveContext = (kind: ImportKind): ResolveContext =>
  kind === 'import-rule' ? '@import' : 'url';

const isExternalUrl = (path: string) => {
  try {
    const { protocol } = new URL(path);
    return protocol === 'http:' || protocol === 'https:' || protocol === 'data:';
  } catch {
    return false;
  }
};

const normalizeRollupResolveId = (
  resolvedId: ResolvedId | null,
  pathToResolve: string,
  resolveContext: ResolveContext
): ResolveResult => {
  if (resolvedId) {
    const { id, external } = resolvedId;
    return {
      path: normalizePathSlashes(id),
      external: !!external,
    };
  }
  if (resolveContext === 'url') {
    // absolute paths are considered external
    if (pathToResolve.startsWith('/')) {
      return {
        path: normalizePathSlashes(pathToResolve),
        external: true,
      };
    }
    // ids are considered external
    if (pathToResolve.startsWith('#')) {
      return {
        path: pathToResolve,
        external: true,
      };
    }
    // http: || https: || data: urls are considered external
    if (isExternalUrl(pathToResolve)) {
      return {
        path: pathToResolve,
        external: true,
      };
    }
  }

  return null;
};

export const runEsbuild = async (
  userOptions: BuildOptions,
  stdin: StdinOptions,
  forcedOptions: EsbuildUserForcedOptions,
  assetOptions: RollupCssAssets,
  resolve: RollupCssResolve,
  rollupPluginContext: TransformPluginContext
) => {
  const inputs: CssInputItem[] = [];
  const { sourcemap, minify } = forcedOptions;
  const { inline } = assetOptions;
  const buildResult = await esbuild.build({
    ...userOptions,
    sourcemap: sourcemap ? 'external' : false,
    outfile: stdin.sourcefile,
    minify,
    stdin,
    bundle: true,
    write: false,
    metafile: true,
    plugins: [
      {
        name: 'resolve-file-assets',
        setup(build) {
          build.onResolve(
            { filter: /.*/, namespace: 'file' },
            async ({ path: pathToResolve, importer, kind }) => {
              if (processedImportKinds.includes(kind)) {
                if (isExternalUrl(pathToResolve)) {
                  return null;
                }

                const resolveContext = getResolveContext(kind);
                const rollupResult = await rollupPluginContext.resolve(pathToResolve, importer);
                const normalizedRollupResult = normalizeRollupResolveId(
                  rollupResult,
                  pathToResolve,
                  resolveContext
                );
                const result =
                  typeof resolve === 'function'
                    ? await resolve(pathToResolve, resolveContext, normalizedRollupResult)
                    : normalizedRollupResult;

                if (result) {
                  const { path, external } = result;

                  const inputItem: CssInputItem = {
                    path,
                    external,
                  };

                  inputs.push(inputItem);

                  // non external url tokens are always referenced assets
                  // those assets are resolved here and the absolute path to the input asset with a prefix & suffix is placed here as a placeholder
                  // later when we know the output paths we replace this with the correct relative output path
                  if (!external && kind === 'url-token') {
                    const isInlined = (inputItem.inlined = getIsInlined(path, inline));

                    if (isInlined) {
                      return {
                        path,
                        namespace: 'dataurl',
                      };
                    }

                    const placeholder = (inputItem.placeholder = `_${Buffer.from(path).toString(
                      'base64url'
                    )}`);

                    // watching for asset changes
                    rollupPluginContext.addWatchFile(path);

                    return {
                      path: `${templateInterpolatePrefix}${templateInterpolateSymbol}${placeholder}${templateInterpolateSuffix}`,
                      external: true, // mark all assets as external so esbuild is not running any loaders
                    };
                  }

                  // import rules are inline replacements which can be done right away
                  return {
                    path,
                    external,
                  };
                }
              }

              return null;
            }
          );

          build.onLoad({ filter: /.*/, namespace: 'dataurl' }, async ({ path }) => ({
            contents: await fs.promises.readFile(path),
            loader: 'dataurl',
          }));
        },
      },
    ],
  });

  const { metafile, outputFiles, warnings, errors } = buildResult;

  if (errors && errors.length) {
    errors.forEach(({ text }) => {
      rollupPluginContext.error(text);
    });
  }

  if (warnings && warnings.length) {
    warnings.forEach(({ text }) => {
      rollupPluginContext.warn(text);
    });
  }

  const { outputs } = metafile!;
  const outputEntries = Object.entries(outputs);

  if (outputEntries.length > 2) {
    rollupPluginContext.error(`The generated esbuild output is incorrect.`);
  }

  const css = outputFiles.find(({ path: outputPath }) => {
    const entry = outputEntries.find(([_, { entryPoint }]) => !!entryPoint);
    return entry && normalizePathSlashes(outputPath).endsWith(normalizePathSlashes(entry[0]));
  });
  const map = outputFiles.find(({ path: outputPath }) => {
    const entry = outputEntries.find(([_, { entryPoint }]) => !entryPoint);
    return entry && normalizePathSlashes(outputPath).endsWith(normalizePathSlashes(entry[0]));
  });

  if (!css) {
    rollupPluginContext.error(`The esbuild generated css output wasn't found.`);
  }
  if (sourcemap && !map) {
    rollupPluginContext.error(`The esbuild generated css sourcemap wasn't found.`);
  }

  let parsedMap: SourceMapInput = null;
  try {
    parsedMap = map?.text ? JSON.parse(map.text) : null;
  } catch {}

  return {
    inputs,
    css: css.text,
    map: parsedMap,
  };
};
