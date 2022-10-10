import * as path from 'path';
import {
  sassProcessor,
  lessProcessor,
  stylusProcessor,
  cssModulesProcessor,
} from './builtInCssProcessors';
import type { ResolvedId, TransformPluginContext } from 'rollup';
import type {
  RollupCssProcessors,
  CssProcessorInfo,
  CssProcessorResult,
  RollupCssResolve,
  ResolveResult,
  ResolveContext,
  CssProcessor,
  CssProcessorCustom,
} from './types';

interface BuiltInProcessors {
  sass: RollupCssProcessors['sass'];
  less: RollupCssProcessors['less'];
  stylus: RollupCssProcessors['stylus'];
  cssModules: RollupCssProcessors['cssModules'];
}

const optionToTuple = <T extends Record<string, any>>(option: CssProcessor<T>) =>
  Array.isArray(option) ? option : ([option, {} as T] as [regex: RegExp, options: T]);

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

const builtInprocessorsMap: Record<
  keyof BuiltInProcessors,
  (
    info: CssProcessorInfo,
    options: Record<string, any>
  ) => CssProcessorResult | Promise<CssProcessorResult>
> = {
  sass: sassProcessor,
  less: lessProcessor,
  stylus: stylusProcessor,
  cssModules: cssModulesProcessor,
};

export const runCssProcessors = async (
  builtInProcessors: BuiltInProcessors,
  customProcessor: CssProcessorCustom,
  css: string,
  sourcemap: boolean,
  filePath: string,
  resolve: RollupCssResolve,
  rollupPluginContext: TransformPluginContext
): Promise<CssProcessorResult> => {
  const baseInfo: CssProcessorInfo = {
    css,
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
  let lastResult: CssProcessorResult | null = null;

  for (const builtInProcessor of Object.entries(builtInProcessors) as [
    keyof BuiltInProcessors,
    CssProcessor<any>
  ][]) {
    const [name, processorOption] = builtInProcessor;
    const processor = builtInprocessorsMap[name];
    if (processorOption) {
      const [regexp, options] = optionToTuple(processorOption);

      if (regexp.test(filePath)) {
        lastResult = await processor(
          { ...baseInfo, map: (lastResult as CssProcessorResult | null)?.map },
          options
        );
      }
    }
  }

  if (customProcessor) {
    lastResult = await customProcessor({ ...baseInfo, map: lastResult?.map });
  }

  return { ...lastResult, css: lastResult?.css || css };
};
