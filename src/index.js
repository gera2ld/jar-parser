import JSZip from 'jszip';
import { parseFile, resolveDeps } from './parser';

export function parseFiles(files) {
  const items = files.map(parseFile);
  const invalid = items.filter(({ type }) => !type);
  const valid = items.filter(({ type }) => type);
  const unresolved = resolveDeps(valid);
  const interfaces = [];
  const classes = [];
  const enums = [];
  const mapping = {
    interface: interfaces,
    class: classes,
    enum: enums,
  };
  for (const item of valid) {
    mapping[item.type].push(item);
  }
  return {
    interfaces,
    classes,
    enums,
    invalid,
    unresolved,
  };
}

export async function parseJar(blob, encoding) {
  const zip = await JSZip.loadAsync(blob);
  const fileObjects = zip.filter((relpath, { dir }) => !dir && relpath.endsWith('.java'));
  const files = await Promise.all(fileObjects.map(async (file) => {
    let fileEncoding = typeof encoding === 'function' ? await encoding(file) : encoding;
    fileEncoding = fileEncoding || 'utf8';
    const source = await file.async('arraybuffer');
    const content = new TextDecoder(fileEncoding).decode(source);
    return {
      name: file.name,
      content,
    };
  }));
  return parseFiles(files);
}
