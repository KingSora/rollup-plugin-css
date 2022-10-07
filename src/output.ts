import * as fs from 'fs';
import * as path from 'path';
import { normalizePathSlashes } from './normalizePathSlashes';
import { pluginName } from './pluginName';
import type { OutputBundle, OutputChunk, PluginContext, RenderedModule } from 'rollup';
import type {
  PluginMeta,
  RollupCssAssets,
  CssForChunksExtract,
  CssForChunksExtractResult,
  CssInputItem,
  CssForChunksExtractDependency,
} from './types';

export interface EmittedAssetFileMeta {
  id: string;
  emitName: string;
  emitFileName: string;
  emitDefaultName: string;
}

export interface EmittedCssFileMeta extends EmittedAssetFileMeta {
  substitutions: [placeholder: string, id: string][];
}

// ported from https://github.com/substack/node-commondir
const commonDir = (files: string[]) => {
  if (files.length === 0) return '/';
  if (files.length === 1) return path.dirname(files[0]);
  const commonSegments = files.slice(1).reduce((commonSegments, file) => {
    const pathSegements = file.split(/\/+|\\+/);
    let i;
    for (
      i = 0;
      commonSegments[i] === pathSegements[i] &&
      i < Math.min(commonSegments.length, pathSegements.length);
      i++
    );
    return commonSegments.slice(0, i);
  }, files[0].split(/\/+|\\+/));
  // Windows correctly handles paths with forward-slashes
  return commonSegments.length > 1 ? commonSegments.join('/') : '/';
};

const getPreserveDir = (
  preserveDir: RollupCssAssets['preserveDir'],
  emitName: string,
  id: string,
  isCss: boolean
): boolean => {
  if (typeof preserveDir === 'function') {
    return preserveDir(emitName, id);
  }
  if (typeof preserveDir === 'string') {
    return (preserveDir === 'css' && isCss) || (preserveDir === 'asset' && !isCss);
  }
  return preserveDir;
};

const getPluginMetas = (moduleIds: string[], rollupPluginContext: PluginContext) =>
  moduleIds
    .map((id) => rollupPluginContext.getModuleInfo(id)?.meta?.[pluginName])
    .filter(Boolean) as PluginMeta[];

const getCssDynamicOrigin = (
  modulesMeta: PluginMeta[],
  dynamicModulesMeta: PluginMeta[],
  meta: PluginMeta
): boolean => !modulesMeta.includes(meta) && dynamicModulesMeta.includes(meta);

const getChunkModules = (chunks: [string, OutputChunk][], chunk: OutputChunk) => {
  const { modules, dynamicImports } = chunk;

  // gets all deduplicated modules of all dynamic imports
  const dynamicChunksModules = dynamicImports
    .map((dynamicImport) => {
      const [dynamicChunk] = chunks
        .map(([chunkName, chunkInfo]) => (dynamicImport === chunkName ? chunkInfo : null))
        .filter(Boolean) as OutputChunk[];

      return dynamicChunk?.modules;
    })
    .filter(Boolean)
    .reduce(
      (obj, dynamicChunkModules) => ({ ...obj, ...dynamicChunkModules }), // order important!
      {} as {
        [id: string]: RenderedModule;
      }
    );

  // all deduplicated modules imported in this chunk
  return [modules, dynamicChunksModules]; // order important!
};

const getAssetName = (
  outputBasePath: string,
  id: string,
  isCss: boolean,
  { preserveDir, file }: RollupCssAssets
) => {
  const fullName = normalizePathSlashes(path.relative(outputBasePath || '', id));
  const suggestedName = getPreserveDir(preserveDir, fullName, id, isCss)
    ? fullName
    : path.basename(fullName);

  return typeof file === 'function' ? file(id, suggestedName, isCss) : suggestedName;
};

const getSubstitutions = (inputs: CssInputItem[]) =>
  inputs
    .map(({ placeholder, path: inputFilePath }) => placeholder && [placeholder, inputFilePath])
    .filter(Boolean) as [placeholder: string, id: string][];

const emitFile = (
  id: string,
  name: { name: string } | { fileName: string },
  source: string,
  rollupPluginContext: PluginContext
): EmittedAssetFileMeta => {
  const emitId = rollupPluginContext.emitFile({
    type: 'asset',
    source,
    ...name,
  });
  const emitFileName = rollupPluginContext.getFileName(emitId);
  const finalName = (name as { name: string }).name || (name as { fileName: string }).fileName;

  return {
    id,
    emitName: finalName,
    emitDefaultName: finalName,
    emitFileName,
  };
};

export const getOutputBasePath = (moduleIds: string[]) => commonDir(moduleIds);

export const emitAssetFiles = async (
  outputBasePath: string,
  ids: string[],
  assetOptions: RollupCssAssets,
  rollupPluginContext: PluginContext
) =>
  Promise.all(
    ids
      .map((id) => {
        const name = getAssetName(outputBasePath, id, false, assetOptions);
        return name
          ? fs.promises
              .readFile(id)
              .then((source) => emitFile(id, { name }, source.toString(), rollupPluginContext))
          : null;
      })
      .filter(Boolean) as Promise<EmittedAssetFileMeta>[]
  );

export const emitAssetCssFiles = (
  outputBasePath: string,
  assetOptions: RollupCssAssets,
  rollupPluginContext: PluginContext
): EmittedCssFileMeta[] => {
  const moduleIds = Array.from(rollupPluginContext.getModuleIds());
  const pluginMetas = getPluginMetas(moduleIds, rollupPluginContext);

  return pluginMetas
    .map(({ id, css, inputs }) => {
      const name = getAssetName(outputBasePath, id, true, assetOptions);
      return name
        ? {
            ...emitFile(id, { name }, css, rollupPluginContext),
            substitutions: getSubstitutions(inputs),
          }
        : null;
    })
    .filter(Boolean) as EmittedCssFileMeta[];
};

export const emitChunkCssFiles = (
  bundle: OutputBundle,
  assetCssFiles: EmittedCssFileMeta[],
  extract: CssForChunksExtract,
  rollupPluginContext: PluginContext
): EmittedCssFileMeta[] => {
  const chunks = Object.entries(bundle).filter(([_, { type }]) => type === 'chunk') as [
    string,
    OutputChunk
  ][];
  return chunks
    .map(([_, chunk]) => {
      const { name: chunkName, fileName: chunkFileName } = chunk;
      const [modules, dynamicModules] = getChunkModules(chunks, chunk);
      const chunkModules = { ...modules, ...dynamicModules }; // order important!
      const chunkPluginMetas = getPluginMetas(Object.keys(chunkModules), rollupPluginContext);
      const suggestedResult: Required<CssForChunksExtractResult> = {
        name: `${chunkName}.css`,
        source: chunkPluginMetas.map(({ css }) => css).join('\r\n'),
        inputs: chunkPluginMetas.map(({ inputs }) => inputs).flat(),
      };
      const getCssDependencies = (): CssForChunksExtractDependency[] => {
        const moduleMetas = getPluginMetas(Object.keys(modules), rollupPluginContext);
        const dynamicModuleMetas = getPluginMetas(Object.keys(dynamicModules), rollupPluginContext);
        return chunkPluginMetas.map((meta) => ({
          inputFile: meta.id,
          assetFile: assetCssFiles.find(({ id }) => id === meta.id)?.emitFileName || null,
          inputs: meta.inputs,
          css: meta.css,
          map: meta.map,
          dynamicOrigin: getCssDynamicOrigin(moduleMetas, dynamicModuleMetas, meta),
        }));
      };
      console.log(getCssDependencies());
      const getExtractInfo = (): Required<CssForChunksExtractResult> => {
        const result =
          typeof extract === 'function'
            ? extract(chunk, getCssDependencies(), suggestedResult) || {
                name: '',
                source: '',
                inputs: [],
              }
            : suggestedResult;
        if (result === true) {
          return suggestedResult;
        }
        const {
          name,
          source = suggestedResult.source,
          inputs: usedInputs = suggestedResult.inputs,
        } = result;
        return {
          name,
          source,
          inputs: usedInputs,
        };
      };

      const { name: fileName, source, inputs: usedInputs } = getExtractInfo();

      return source.length
        ? {
            ...emitFile(chunkFileName, { fileName }, source, rollupPluginContext),
            substitutions: getSubstitutions(usedInputs),
          }
        : null;
    })
    .filter(Boolean) as EmittedCssFileMeta[];
};
