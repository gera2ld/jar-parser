import { getDep, initContext } from './util';

const CONTROL_CHAR = '\x02';
const RE_CONTROL_CHAR = new RegExp(CONTROL_CHAR, 'g');
const CONTROL_COMMENT = `${CONTROL_CHAR}c`;
const CONTROL_PACKAGE = `${CONTROL_CHAR}P`;
const CONTROL_IMPORT = `${CONTROL_CHAR}i`;
const CONTROL_INTERFACE = `${CONTROL_CHAR}I`;
const CONTROL_ENUM = `${CONTROL_CHAR}E`;
const CONTROL_CLASS = `${CONTROL_CHAR}C`;
const CONTROL_METHOD = `${CONTROL_CHAR}m`;
const CONTROL_PROPERTY = `${CONTROL_CHAR}p`;
const CONTROL_ENUM_ITEM = `${CONTROL_CHAR}e`;
const BASE_TYPE_CHARS = '\\w\\s,?';

function trackFunction(fn, when) {
  let count = 0;
  const tracked = (...args) => {
    if (!when || when(...args)) count += 1;
    return fn(...args);
  };
  tracked.count = () => count;
  return tracked;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const RE_SUB_TYPE = new RegExp('<[^<>]+>', 'g');
export function scanDefinition(context, defStr) {
  let mask = defStr;
  const replacer = m => ' '.repeat(m.length);
  while (mask.includes('<')) {
    const tracked = trackFunction(replacer);
    mask = mask.replace(RE_SUB_TYPE, tracked);
    assert(tracked.count(), `Invalid definition string "${defStr}"`);
  }
  let implementsStr;
  let extendsStr;
  mask.replace(/\simplements\s/, (m, offset) => {
    implementsStr = defStr.slice(offset + m.length);
    defStr = defStr.slice(0, offset);
  });
  mask.replace(/\sextends\s/, (m, offset) => {
    extendsStr = defStr.slice(offset + m.length);
    defStr = defStr.slice(0, offset);
  });
  const nameDep = scanTypes(context, defStr)[0];
  const extendDep = extendsStr && scanTypes(context, extendsStr)[0];
  const implementDeps = implementsStr && scanTypes(context, implementsStr);
  return { nameDep, extendDep, implementDeps };
}

const RE_BASE_TYPE = new RegExp(`^(?:${CONTROL_CHAR}t|[${BASE_TYPE_CHARS}])+$`);
const RE_DESCENDANT_TYPE = new RegExp(`(${CONTROL_CHAR}t)|(\\w+)\\s*<([^<>]+)>`, 'g');
export function scanTypes(context, typeStr) {
  let lastTypes;
  let types = [];
  const scanBaseTypes = string => {
    if (!RE_BASE_TYPE.test(string)) {
      throw new Error(`Invalid base type string "${string}" in "${typeStr}"`);
    }
    const baseTypes = string.split(',')
    .map(item => {
      item = item.trim();
      if (item === `${CONTROL_CHAR}t`) {
        return lastTypes.shift();
      }
      return getDep(context, {
        name: item,
        t: [],
      });
    });
    return baseTypes;
  };
  const replacer = (_m, p, name, nested) => {
    if (p) {
      types.push(lastTypes.shift());
    } else {
      const data = getDep(context, {
        name,
        t: scanBaseTypes(nested),
      });
      types.push(data);
    }
    return `${CONTROL_CHAR}t`;
  };
  let string = typeStr.trim();
  while (string.includes('<')) {
    lastTypes = types;
    types = [];
    const tracked = trackFunction(replacer, (_m, p) => !p);
    string = string.replace(RE_DESCENDANT_TYPE, tracked).trim();
    assert(tracked.count(), `Invalid type string "${string}" in "${typeStr}"`);
  }
  lastTypes = types;
  types = scanBaseTypes(string);
  return types;
}

const RE_PARAM = new RegExp(`^\\s*([${BASE_TYPE_CHARS}<>]*?[\\w>])(?:\\s+|\\s*(\\.\\.\\.)\\s*)(\\w+)\\s*(?:,|$)`);
export function scanParams(context, paramStr) {
  const params = [];
  let string = paramStr.trim();
  const replacer = (_m, typeStr, variable, name) => {
    params.push({
      name: (variable || '') + name,
      type: scanTypes(context, typeStr)[0],
    });
    return '';
  };
  while (string) {
    const tracked = trackFunction(replacer);
    string = string.replace(RE_PARAM, tracked).trim();
    assert(tracked.count(), `Invalid param string "${string}" in "${paramStr}"`);
  }
  return params;
}

const RE_PACKAGE = new RegExp(`(${CONTROL_CHAR}.)|(?:^|\\n)\\s*package\\s+([\\w.]+)\\s*;`, 'g');
const RE_IMPORTS = new RegExp(`(${CONTROL_CHAR}.)|(?:^|\\n)\\s*import\\s+([\\w.]+)(\\.\\*)?\\s*;`, 'g');
const RE_CLASS_OPEN = new RegExp(`(${CONTROL_CHAR}.)|(?:^|\\n)\\s*public\\s+(interface|enum|(?:abstract\\s+)?class)\\s+([${BASE_TYPE_CHARS}<>]+?)\\s*\\{`, 'g');
const RE_METHOD = new RegExp(`(${CONTROL_CHAR}.)|(?:^|\\n)\\s*(?:(?:private|public|static|final)\\s+)?([${BASE_TYPE_CHARS}<>]+?)\\s(\\w+)\\(\\s*([\\s\\S]*?)\\s*\\)\\s*(?:;|throws\\s)`, 'g');
const RE_PROPERTY = new RegExp(`(${CONTROL_CHAR}.)|((?:(?:private|public|static|final)\\s+)+)([${BASE_TYPE_CHARS}<>]+?)\\s+(\\w+)\\s*[=;]`, 'g');
const RE_ENUM = new RegExp(`(${CONTROL_CHAR}.)|(\\w+)\\(([^()]+)\\)(?:,|\\s*$)`, 'g');
export function parseFile(file) {
  const context = initContext(file);
  let { content } = file;
  const comments = [];
  content = content.replace(RE_CONTROL_CHAR, '');

  // extract comments
  content = content.replace(/\/\*([\s\S]*?)\*\//g, (_m, block) => {
    block = block
    .split('\n')
    .map(row => row.replace(/^\s*\*\s?|\s*$/g, ''))
    .join('\n')
    .trim();
    comments.push(block);
    return CONTROL_COMMENT;
  });
  const getComment = offset => {
    let index = -1;
    let cOffset = -1;
    while (true) {
      cOffset = content.indexOf(CONTROL_COMMENT, cOffset + 1);
      if (cOffset < 0 || cOffset > offset) break;
      index += 1;
    }
    return comments[index];
  };

  // extract package name
  content = content.replace(RE_PACKAGE, (m, g1, name, offset) => {
    if (g1) return g1;
    if (context.package) return m;
    context.package = {
      name,
      comment: getComment(offset),
    };
    return CONTROL_PACKAGE;
  });

  // extract imports
  content = content.replace(RE_IMPORTS, (_m, g1, name, wild) => {
    if (g1) return g1;
    if (wild) {
      context.deps.wild.push(`${name}.`);
    } else {
      const basename = name.split('.').pop();
      context.deps.exact[basename] = name;
    }
    return CONTROL_IMPORT;
  });

  // parse classes
  content = content.replace(RE_CLASS_OPEN, (m, g1, type, defStr, offset) => {
    if (g1) return g1;
    if (context.type) return m;
    const { nameDep, extendDep, implementDeps } = scanDefinition(context, defStr);
    nameDep.fullName = `${context.package.name}.${nameDep.name}`;
    if (type === 'interface') {
      context.type = 'interface';
      context.payload = {
        name: nameDep.name,
        fullName: nameDep.fullName,
        comment: getComment(offset),
        methods: [],
        content: file.content,
      };
      context.payload.dep = getDep(context, context.payload);
      return CONTROL_INTERFACE;
    }
    if (type === 'enum') {
      context.type = 'enum';
      context.payload = {
        name: nameDep.name,
        fullName: nameDep.fullName,
        items: [],
        fields: [],
        content: file.content,
        comment: getComment(offset),
      };
      context.payload.dep = getDep(context, context.payload);
      return CONTROL_ENUM;
    }
    context.type = 'class';
    context.payload = {
      name: nameDep.name,
      dep: nameDep,
      extend: extendDep,
      implement: implementDeps,
      fullName: nameDep.fullName,
      props: [],
      content: file.content,
      comment: getComment(offset),
    };
    return CONTROL_CLASS;
  });

  // parse interface
  if (context.type === 'interface') {
    try {
      content = content.replace(RE_METHOD, (_m, g1, typeStr, name, paramStr, offset) => {
        if (g1) return g1;
        context.payload.methods.push({
          name,
          type: scanTypes(context, typeStr)[0],
          params: scanParams(context, paramStr),
          comment: getComment(offset),
        });
        return CONTROL_METHOD;
      });
    } catch (err) {
      context.error = err;
    }
  }

  // parse class
  if (context.type === 'class') {
    try {
      content = content.replace(RE_PROPERTY, (m, g1, keyword, typeStr, name, offset) => {
        if (g1) return g1;
        if (keyword.includes('static')) return m;
        context.payload.props.push({
          name,
          type: scanTypes(context, typeStr)[0],
          comment: getComment(offset),
        });
        return CONTROL_PROPERTY;
      });
    } catch (err) {
      context.error = err;
    }
  }

  // parse enum
  if (context.type === 'enum') {
    try {
      const start = content.indexOf(CONTROL_ENUM);
      const end = content.indexOf(';', start);
      const enumContent = content.slice(start, end);
      enumContent.replace(RE_ENUM, (_m, g1, name, paramStr, offset) => {
        if (g1) return g1;
        context.payload.items.push({
          name,
          params: paramStr.split(',').map(item => item.trim()),
          comment: getComment(start + offset),
        });
        return CONTROL_ENUM_ITEM;
      });
      const restContent = content.slice(end + 1);
      const matches = restContent.match(new RegExp(`${context.payload.name}\\s*\\((.*?)\\)\\s*\\{`));
      if (matches) {
        const fields = scanParams(context, matches[1]);
        context.payload.fields = fields;
      }
    } catch (err) {
      context.error = err;
    }
  }

  return context;
}
