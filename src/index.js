import JSZip from 'jszip';
import { parseFile } from './parser-v3';

export * from './parser-v3';
export * from './util';

export function resolveDeps(contexts) {
  const registeredSet = new Set();
  const unresolved = new Set();
  // register all
  for (const context of contexts) {
    for (const item of context.deps.items) {
      if (item.fullName) {
        registeredSet.add(item.fullName);
      }
    }
  }
  // resolve explicitly imported
  for (const context of contexts) {
    for (const prefix of context.deps.wild) {
      for (const item of registeredSet) {
        if (item.startsWith(prefix)) {
          const name = item.slice(prefix.length);
          context.deps.exact[name] = item;
        }
      }
    }
  }
  // resolve implicitly imported
  for (const context of contexts) {
    for (const dep of context.deps.items) {
      if (!dep.fullName) dep.fullName = context.deps.exact[dep.name];
      if (!dep.fullName) {
        const fullName = `${context.package.name}.${dep.name}`;
        if (registeredSet.has(fullName)) dep.fullName = fullName;
      }
      if (!dep.fullName) {
        unresolved.add(dep.name);
      }
    }
  }
  return unresolved;
}

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

export async function loadFilesFromJar(blob, encoding) {
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
  return files;
}

export async function parseJar(blobs, encoding) {
  if (!Array.isArray(blobs)) {
    blobs = [blobs];
  }
  const files = (await Promise.all(blobs.map(blob => loadFilesFromJar(blob, encoding)))).flat();
  return parseFiles(files);
}
