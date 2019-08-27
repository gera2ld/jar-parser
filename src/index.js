import JSZip from 'jszip';
import { parseFile, resolveDeps } from './parser';

const byKey = key => (a, b) => {
  if (a[key] < b[key]) return -1;
  if (a[key] > b[key]) return 1;
  return 0;
};
const byName = byKey('name');

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
  interfaces.sort(byName);
  interfaces.forEach(item => item.payload.methods.sort(byName));
  classes.sort(byName);
  classes.forEach(item => item.payload.props.sort(byName));
  enums.sort(byName);
  return {
    interfaces,
    classes,
    enums,
    invalid,
    unresolved,
  };
}

export async function parseJar(blob) {
  const zip = await JSZip.loadAsync(blob);
  const fileObjects = zip.filter((relpath, { dir }) => !dir && relpath.endsWith('.java'));
  const files = await Promise.all(fileObjects.map(async (file) => {
    const source = await file.async('arraybuffer');
    const content = new TextDecoder('gbk').decode(source);
    return {
      name: file.name,
      content,
    };
  }));
  return parseFiles(files);
}
