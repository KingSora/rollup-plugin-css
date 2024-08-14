import * as path from 'path';
import { builtInProcessors } from './builtInCssProcessors';
import type { ResolvedId, TransformPluginContext } from 'rollup';
import type { BuiltInProcessors } from './builtInCssProcessors';
import type {
  RollupCssProcessors,
  CssProcessorInfo,
  CssProcessorResult,
  RollupCssResolve,
  ResolveResult,
  ResolveContext,
  CssProcessorCustom,
} from './types';

type BuiltInProcessorOptions = Omit<RollupCssProcessors, 'custom'>;

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

const runBuiltInProcessor = async <S extends keyof BuiltInProcessorOptions>(
  filePath: string,
  baseInfo: CssProcessorInfo,
  latestResult: CssProcessorResult | null,
  processor: BuiltInProcessors[S],
  processorOption: BuiltInProcessorOptions[S]
) => {
  if (processorOption) {
    const [regex, option] = Array.isArray(processorOption) ? processorOption : [processorOption];
    if (regex.test(filePath)) {
      return await processor({ ...baseInfo, map: latestResult?.map }, option);
    }
  }
};

export const runCssProcessors = async (
  filePath: string,
  inputCss: string,
  sourcemap: boolean,
  builtInProcessorOptions: BuiltInProcessorOptions,
  customProcessor: CssProcessorCustom,
  resolve: RollupCssResolve,
  rollupPluginContext: TransformPluginContext
) => {
  let latestResult: CssProcessorResult | null = null;
  let data: Record<string, any> = {};
  const watchFiles: string[] = [];
  const collectResult = (result: CssProcessorResult | undefined) => {
    if (result) {
      data = { ...data, ...(result.data || {}) };
      watchFiles.push(...(result.watchFiles || []));
      return result;
    }
    return latestResult;
  };
  const baseInfo: CssProcessorInfo = {
    css: inputCss,
    sourcemap,
    path: filePath,
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

  for (let processorName of Object.keys(
    builtInProcessorOptions
  ) as (keyof BuiltInProcessorOptions)[]) {
    latestResult = collectResult(
      await runBuiltInProcessor(
        filePath,
        baseInfo,
        latestResult,
        builtInProcessors[processorName],
        builtInProcessorOptions[processorName]
      )
    );
  }

  if (customProcessor) {
    if (typeof customProcessor === 'function') {
      latestResult = collectResult(await customProcessor({ ...baseInfo, map: latestResult?.map }));
    } else {
      for (let [regex, processor] of customProcessor.entries()) {
        if (regex.test(filePath)) {
          latestResult = collectResult(await processor({ ...baseInfo, map: latestResult?.map }));
        }
      }
    }
  }

  const { css, map } = latestResult || {};

  return {
    css: css || inputCss,
    map,
    data,
    watchFiles,
  };
};
