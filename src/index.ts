import * as path from 'path';
import { createFilter } from '@rollup/pluginutils';
import { pluginName } from './pluginName';
import { normalizePathSlashes } from './normalizePathSlashes';
import { runEsbuild } from './esbuild';
import { runCssProcessors, cssProcessors } from './cssProcessors';
import { getOutputBasePath, emitAssetCssFiles, emitAssetFiles, emitChunkCssFiles } from './output';
import { renderCssFiles } from './render';
import type { Plugin, RenderedChunk } from 'rollup';
import type {
  PluginMeta,
  RollupCssOptions,
  CssForChunks,
  CssForChunksExtract,
  CssForChunksInject,
} from './types';

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends Record<string, unknown> ? DeepPartial<T[P]> : T[P];
};

export const defaultOptions: RollupCssOptions = {
  esbuild: {},
  include: /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)$/,
  exclude: null,
  output: {
    cssForChunks: 'extract',
    cssAsAssets: true,
    sourcemap: true,
    minify: false,
  },
  assets: {
    preserveDir: false,
    publicPath: null,
    inline: false,
    file: true,
    url: null,
  },
  transform: {
    cssProcessors: cssProcessors,
    result: {
      code: `export default undefined`,
      map: { mappings: '' },
    }, // if css modules ? 'export default JSON' : ''
  },
  resolve: null,
};

const getCssForChunksOptions = (
  cssForChunks: CssForChunks
): [extract: CssForChunksExtract, inject: CssForChunksInject] => {
  if (cssForChunks === 'extract') {
    return [true, false];
  }
  if (cssForChunks === 'inject') {
    return [false, true];
  }
  if (typeof cssForChunks === 'object') {
    return [cssForChunks?.extract ?? false, cssForChunks?.inject ?? false];
  }

  return [false, false];
};

export const RollupCss = ({
  esbuild: esbuildOptions = defaultOptions.esbuild,
  include = defaultOptions.include,
  exclude = defaultOptions.exclude,
  output: {
    cssForChunks = defaultOptions.output.cssForChunks,
    cssAsAssets = defaultOptions.output.cssAsAssets,
    sourcemap = defaultOptions.output.sourcemap,
    minify = defaultOptions.output.minify,
  } = {},
  assets: {
    preserveDir = defaultOptions.assets.preserveDir,
    publicPath = defaultOptions.assets.publicPath,
    inline = defaultOptions.assets.inline,
    file = defaultOptions.assets.file,
    url = defaultOptions.assets.url,
  } = {},
  transform: {
    cssProcessors: preprocessors = defaultOptions.transform.cssProcessors,
    result: transformResult = defaultOptions.transform.result,
  } = {},
  resolve = defaultOptions.resolve,
}: DeepPartial<RollupCssOptions> = {}): Plugin => {
  const filter = createFilter(include, exclude);
  const assetOptions = { preserveDir, publicPath, inline, file, url };
  const [extract, inject] = getCssForChunksOptions(cssForChunks);
  const importMap = new Map<string, string>();

  const plugin: Plugin = {
    name: pluginName,

    async resolveId(source, importer, options) {
      const id = importMap.get(source);

      if (id) {
        return {
          id: source.replace('\0', ''),
          external: true,
        };
      }
    },

    async transform(code, id) {
      if (!filter(id)) {
        return;
      }
      const normalizedId = normalizePathSlashes(id);

      // 1. cssProcessors
      const { css: cssProcessorCss, map: cssProcessorMap } = await runCssProcessors(
        preprocessors,
        code,
        sourcemap,
        normalizedId,
        resolve,
        this
      );

      // 2. postcss

      // 3. css-modules

      // 4. esbuild
      const { css, map, inputs } = await runEsbuild(
        esbuildOptions,
        {
          contents: cssProcessorCss,
          resolveDir: path.dirname(normalizedId),
          sourcefile: path.basename(normalizedId),
          loader: 'css',
        },
        {
          sourcemap,
          minify,
        },
        assetOptions,
        resolve,
        this
      );

      // 5. transformation
      const {
        code: transformedCode,
        map: transformedMap,
        meta,
        moduleSideEffects,
      } = typeof transformResult === 'function'
        ? await transformResult({ css, map })
        : transformResult;

      //const token = `\0^<<^=${Buffer.from(id).toString('base64url')}^>>^`;
      //importMap.set(token, id);

      return {
        // code: `export { default } from ${JSON.stringify(token)}`,
        code: `export default {}`,
        map: transformedMap,
        meta: {
          [pluginName]: {
            ...(meta || {}),
            id: normalizedId,
            css,
            map,
            inputs,
          } as PluginMeta,
        },
        moduleSideEffects: moduleSideEffects ?? 'no-treeshake',
      };
    },
    async renderChunk(code: string, chunk: RenderedChunk) {
      return null;
    },
    async generateBundle(_, bundle) {
      const outputBasePath = getOutputBasePath(Array.from(this.getModuleIds()));

      // 1. build asset css files
      const emittedAssetCssFilesMeta = cssAsAssets
        ? emitAssetCssFiles(outputBasePath, assetOptions, this)
        : [];

      // 2. build chunk css files
      const emittedChunkCssFilesMeta = extract
        ? emitChunkCssFiles(bundle, emittedAssetCssFilesMeta, extract, this)
        : [];

      // 3. build (only used) asset files
      const emittedCssFilesMeta = [...emittedAssetCssFilesMeta, ...emittedChunkCssFilesMeta];
      const outputAssetFilesMeta = await emitAssetFiles(
        outputBasePath,
        emittedCssFilesMeta
          .map(({ substitutions }) => (substitutions || []).map(([, id]) => id))
          .flat(),
        assetOptions,
        this
      );

      // 4. render files (substitute placeholders)
      await renderCssFiles(emittedCssFilesMeta, outputAssetFilesMeta, bundle, assetOptions).catch(
        (error: Error) => {
          this.error(error);
        }
      );
    },
  };

  return plugin;
};
