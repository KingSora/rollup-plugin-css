import type { BuildOptions } from 'esbuild';
import type {
  SourceMapInput,
  TransformResult as RollupTransformResult,
  OutputChunk,
  PluginContext,
} from 'rollup';
import type { FilterPattern } from '@rollup/pluginutils';

type RollupTransformResultObj = Exclude<RollupTransformResult, string | null | void>;

export interface RollupCssOptions {
  /** Custom options for esbuild. */
  esbuild: BuildOptions;
  /** Include pattern for files which shall be processed by this plugin. */
  include: FilterPattern;
  /** Exclude pattern for files which shall not be processed by this plugin. */
  exclude: FilterPattern;
  /** Options for the css output behavior. */
  output: RollupCssOutput;
  /** Options for the assets output behavior. */
  assets: RollupCssAssets;
  /** Options for transformations. */
  transform: RollupCssTransform;
  /** Customizes the resolution algorithm for "url()" tokens and "@import" rules. */
  resolve: RollupCssResolve;
}

export type RollupCssOutput = {
  /** Customize how css for chunks is outputted. */
  cssForChunks: CssForChunks;
  /** Whether to output css files as assets. */
  cssAsAssets: boolean;
  /** Whether to output sourcemap files for the outputted css. */
  sourcemap: boolean;
  /** Whether to minify the css code. */
  minify: boolean;
};

/**
 * Can be either a string for quick assigning a strategy without customization or a object which makes customizations possible.
 * If it is a empty object, "false", "null" or "undefined" no output takes place.
 */
export type CssForChunks =
  | keyof CssForChunksStrategy
  | CssForChunksStrategy
  | false
  | null
  | undefined;

/** An object which makes it possible to use and customize both "cssForChunks" strategies. */
export type CssForChunksStrategy = {
  /** Activate, deactivate or customize the extraction process. Omitting this prop equals to false. */
  extract?: CssForChunksExtract;
  /** Activate, deactivate or customize the injection process. Omitting this prop equals to false. */
  inject?: CssForChunksInject;
};

export type CssForChunksExtract =
  /** Whether to use the extract option. With true css will be extracted for chunks in the default way, with false no extractions take place. */
  | boolean
  /** A function which customized the extraction process. */
  | ((
      chunk: OutputChunk,
      cssDependencies: CssForChunksExtractDependency[],
      defaultResult: Required<CssForChunksExtractResult>
    ) => CssForChunksExtractResult | boolean | null | undefined);

/** The result of a CssForChunk extraction. */
export type CssForChunksExtractResult = {
  /** The name of the css file. */
  name: string;
  /** The source of the css file. If omitted the default source (concatenate css code) is used. */
  source?: string;
  /** The used inputs of the css file. Of omited the default inputs (all) are used. */
  inputs?: CssInputItem[];
};

/** A css dependency of a chunk. */
export interface CssForChunksExtractDependency {
  /** The input css file path. */
  inputFile: string;
  /** The output asset css file path. Available if css is extracted as an asset. */
  assetFile: string | null;
  /** Whether the css originates from a dynamic chunk. */
  dynamicOrigin: boolean;
  /** The inputs of this css dependency. */
  inputs: CssInputItem[];
  /** The css code of this css dependency. */
  css: string;
  /** The sourcemap of this css dependency. */
  map: SourceMapInput;
}

export type CssForChunksInject =
  | boolean
  | ((chunk: string, cssInfo: string, suggestedCode: {}) => string); // result should be outputable into css files

export type RollupCssAssets = {
  /** Customizes whether the input directory of the asset shall be preserved in the output structure. */
  preserveDir: AssetsPreserveDir;
  /** A path which is prepend to the assets path. */
  publicPath: string | null;
  /** Customizes which assets should be inlined as dataurls. */
  inline: AssetsInline;
  /** Customizes the output file name of the asset. */
  file: AssetFile;
  /** Customizes the the content of the "url()" token in the outputted css file. */
  url: AssetUrl;
};

export type AssetsPreserveDir =
  /**
   * Customizes for which files the directory shall be preserved.
   * @param outputName The output name of the asset. This is not the final output file name, its the name before rollup substitutes it with the "output.assetFileNames" option.
   * @param inputFile The original input path of the asset.
   * @returns true if the directory should be preserved, false otherwise.
   */
  | ((outputName: string, inputPath: string) => boolean)
  /** The directory will be preserved only for assets used in css files. */
  | 'asset'
  /** The directory will be preserved only for css asset files. */
  | 'css'
  /** With true the directory will be preserved for all assets, with false it won't. */
  | boolean;

export type AssetsInline =
  /** An RegExp or function to customize the inline process. */
  | AssetsInlineCustom
  /** An array of RegExps or functions to customize the inline process. */
  | AssetsInlineCustom[]
  /** With true all assets are inlined. With false no assets are inlined. */
  | boolean;

export type AssetsInlineCustom =
  /** A function which gets the assets input path and returns a boolean which indicates whether the asset will be inlined or not. */
  | ((inputPath: string) => boolean)
  /** A RegExp which matches against the assets input path. If it matches the asset will be inlined. */
  | RegExp;

export type AssetFile =
  /**
   * Customizes the output file name of the asset or null if the asset shouldn't be outputted.
   * @param inputPath The input file path of the asset.
   * @param defaultName The default output name.
   * @param isCssFile Whether this asset is a css file.
   * @returns A output name or null if the file shouldn't be outputted.
   */
  | ((inputPath: string, defaultName: string, isCssFile: boolean) => string | null)
  /** With true all assets are outputted, with false no assets are outputted. */
  | boolean;

export type AssetUrl =
  /**
   * Customizes the content of the "url()" token in the outputted css file.
   * @param urlInfo Information which could be necessary to build the "url()" token content.
   * @param defaultUrl The default url.
   * @returns The content of the "url()" token in the outputted css file.
   */
  | ((urlInfo: AssetUrlInfo, defaultUrl: string) => string)
  /** The default url is used. */
  | null;

/** Information used to build the "url()" token content in a output css file. */
export interface AssetUrlInfo {
  /** Information about the asset used in the "url()" token. */
  assetFileMeta: AssetOutputMeta;
  /** Information about the css in which the asset was used. */
  cssFileMeta: AssetOutputMeta;
  /** The public path option for convenience. */
  publicPath: string | null;
}

/** Describes an asset file which was successfully outputted.  */
export interface AssetOutputMeta {
  /** The input path of the asset. */
  inputPath: string;
  output: {
    /** The name of the asset before it was substituted by rollup with the "output.assetFileNames" option. */
    name: string;
    /** The outputted file name of the asset after it was substituted by rollup with the "output.assetFileNames" option.*/
    fileName: string;
    /** The default name which would've been picked without any customizations to the "name" by the "file" option. */
    defaultName: string;
  };
}

export type RollupCssTransform = {
  /** Customizes css-processor to transform css code. */
  cssProcessors: CssProcessors;
  /** Customizes the js transform. */
  result: Transform;
};

export interface CssProcessorInfo {
  code: string;
  path: string;
  sourcemap: boolean;
  resolve: (
    path: string,
    importer: string | undefined,
    context: ResolveContext
  ) => Promise<string | null>;
}

export type CssProcessors =
  | ((info: CssProcessorInfo) => CssProcessorResult | Promise<CssProcessorResult>)
  | Map<RegExp, (info: CssProcessorInfo) => CssProcessorResult | Promise<CssProcessorResult>>;

export type CssProcessorResult = {
  css: string;
  map?: SourceMapInput | undefined;
  watchFiles?: string[];
  data?: Record<string, string>;
};

export type TransformResult = {
  code?: RollupTransformResultObj['code'];
  map?: RollupTransformResultObj['map'];
  ast?: RollupTransformResultObj['ast'];
  moduleSideEffects?: RollupTransformResultObj['moduleSideEffects'];
  meta?: Record<string, any>;
};

export type Transform =
  | ((info: CssProcessorResult) => TransformResult | Promise<TransformResult>)
  | TransformResult;

export type RollupCssResolve =
  /**
   * Customizes the resolution algorithm for all.
   * @param path The path to resolve.
   * @param importer The importer of the path.
   * NOTE: Sometimes the path ends with "<unknown>"" as the file name, in this case only the directory is known and not the full filename.
   * This has been done so you still get the correct directory with the path.dirname function.
   * @param context The context of this resolution.
   * @param defaultResult The default result.
   * @return An object which describes the resolved result.
   */
  | ((
      path: string,
      importer: string | undefined,
      context: ResolveContext,
      defaultResult: ResolveResult
    ) => Promise<ResolveResult> | ResolveResult)
  /**
   * The default result is used.
   * The plugin uses the resultion algorithm of rollup and all its plugins.
   * That means if you can import all your assets in the same way as you javascript.
   * If you are using e.g. "@rollup/plugin-node-resolve" all those rules also apply inside your css.
   */
  | null;

/**
 * The context of a resolution.
 * - "url": if the path to resolve is used in an "url()" token
 * - "@import": if the path to resolve is used in an "@import" rule (includes "@use" and "@forward" rules from sass)
 */
export type ResolveContext = 'url' | '@import';

/**
 * Describes the result of a resolution.
 * If null the path couldn't be resolved.
 */
export type ResolveResult = {
  /** The resolved path. */
  path: string;
  /** Whether the path should be considered external. */
  external: boolean;
} | null;

/**
 * Represents a css input file.
 * Input files are "dependencies" of the css file like:
 * - assets used in a "url()"" token
 * - other css files imported with the "@import" rule
 */
export interface CssInputItem {
  /** The path to the input file. */
  path: string;
  /** Whether this input file is considered external. */
  external: boolean;
  /** Whether this input file is inlined in the css file as a dataurl.  */
  inlined?: boolean;
  /** The generated placeholder for this input file. (Is substituted with the correct output file path) */
  placeholder?: string;
}

export interface PluginMeta {
  inputs: CssInputItem[];
  id: string;
  css: string;
  map: SourceMapInput;
}
