const isExtendedLengthPath = /^\\\\\?\\/;

export const normalizePathSlashes = (path: string) =>
  isExtendedLengthPath.test(path) ? path : path.replace(/\\/g, '/');
