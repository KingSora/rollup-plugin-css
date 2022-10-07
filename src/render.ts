import * as path from 'path';
import { template } from 'dot';
import { normalizePathSlashes } from './normalizePathSlashes';
import type { OutputAsset, OutputBundle } from 'rollup';
import type { EmittedCssFileMeta, EmittedAssetFileMeta } from './output';
import type { RollupCssAssets } from './types';

export const templateInterpolatePrefix = '^<<^';
export const templateInterpolateSuffix = '^>>^';
export const templateInterpolateSymbol = '=';

const renderCssFile = async (source: string, substitutions: Record<string, string>) =>
  new Promise<string>((resolve, reject) => {
    try {
      const result = template(source, {
        delimiters: { start: templateInterpolatePrefix, end: templateInterpolateSuffix },
        strip: false,
        argName: Object.keys(substitutions),
      })(substitutions);
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });

export const renderCssFiles = (
  emittedCssFilesMeta: EmittedCssFileMeta[],
  emittedAssetsMeta: EmittedAssetFileMeta[],
  bundle: OutputBundle,
  options: RollupCssAssets
) => {
  const bundleEntries = Object.entries(bundle);
  const bundleAssets = bundleEntries
    .filter(([_, { type }]) => type === 'asset')
    .map(([, asset]) => asset) as OutputAsset[];

  return Promise.all(
    emittedCssFilesMeta
      .map((cssMeta) => {
        const {
          id: cssFileId,
          emitName: cssName,
          emitFileName: cssFileName,
          emitDefaultName: cssDefaultName,
          substitutions,
        } = cssMeta;
        const bundleAsset = bundleAssets.find(
          (bundleAsset) => bundleAsset.fileName === cssFileName
        );

        if (bundleAsset) {
          const { publicPath, url } = options;
          const { source } = bundleAsset;
          const computedSubstitutions = (
            substitutions
              .map(([placeholder, substitute]) => {
                const assetMeta = emittedAssetsMeta.find(({ id }) => id === substitute);

                if (assetMeta) {
                  const {
                    id: assetFileId,
                    emitName: assetName,
                    emitFileName: assetFileName,
                    emitDefaultName: assetDefaultName,
                  } = assetMeta;
                  const resolvedUrl = normalizePathSlashes(
                    path.relative(path.dirname(cssFileName), assetFileName)
                  );
                  const publicPathUrl = `${publicPath || ''}${resolvedUrl}`;
                  const finalUrl =
                    typeof url === 'function'
                      ? url(
                          {
                            assetFileMeta: {
                              inputPath: normalizePathSlashes(assetFileId),
                              output: {
                                name: assetName,
                                fileName: assetFileName,
                                defaultName: assetDefaultName,
                              },
                            },
                            cssFileMeta: {
                              inputPath: normalizePathSlashes(cssFileId),
                              output: {
                                name: cssName,
                                fileName: cssFileName,
                                defaultName: cssDefaultName,
                              },
                            },
                            publicPath,
                          },
                          resolvedUrl
                        )
                      : publicPathUrl;

                  return [placeholder, finalUrl];
                }
              })
              .filter(Boolean) as [placeholder: string, substitute: string][]
          ).reduce((obj, [placeholder, substitute]) => {
            obj[placeholder] = substitute;
            return obj;
          }, {} as Record<string, string>);

          return renderCssFile(
            typeof source === 'string' ? source : source.toString(),
            computedSubstitutions
          )
            .catch((error: Error) => {
              throw new Error(
                `Couldn't find all asset files used by the file "${cssFileName}". (${error})`
              );
            })
            .then((substitutedSource) => {
              bundleAsset.source = substitutedSource;
            });
        }
      })
      .filter(Boolean) as Promise<void>[]
  );
};
