import { getDep, initContext } from './util';

function trackFunction(fn) {
  let count = 0;
  const tracked = (...args) => {
    count += 1;
    return fn(...args);
  };
  tracked.count = () => count;
  return tracked;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function scanTypes(context, typeStr) {
  let lastTypes;
  let types = [];
  const scanBaseTypes = string => {
    if (!/^(?:\x02t|[\w\s,?])+$/.test(string)) {
      throw new Error(`Invalid base type string "${string}" in "${typeStr}"`);
    }
    const baseTypes = string.split(',')
    .map(item => {
      item = item.trim();
      if (item === '\x02t') {
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
    return '\x02t';
  };
  let string = typeStr.trim();
  while (string.includes('<')) {
    lastTypes = types;
    types = [];
    const tracked = trackFunction(replacer);
    string = string.replace(/(\x02t)|(\w+)\s*<([^<>]+)>/g, tracked).trim();
    assert(tracked.count(), `Invalid type string "${string}" in "${typeStr}"`);
  }
  lastTypes = types;
  types = scanBaseTypes(string);
  return types;
}

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
    string = string.replace(/^\s*([\w\s<>,?]*?[\w>])(?:\s+|\s*(\.\.\.)\s*)(\w+)\s*(?:,|$)/, tracked).trim();
    assert(tracked.count(), `Invalid param string "${string}" in "${paramStr}"`);
  }
  return params;
}

export function parseFile(file) {
  const context = initContext(file);
  let { content } = file;
  const comments = [];
  content = content.replace(/\x02/g, '');

  // extract comments
  content = content.replace(/\/\*([\s\S]*?)\*\//g, (_m, block) => {
    block = block
    .split('\n')
    .map(row => row.replace(/^\s*\*\s?|\s*$/g, ''))
    .join('\n')
    .trim();
    comments.push(block);
    return '\x02c';
  });
  const getComment = offset => {
    let index = -1;
    let cOffset = -1;
    while (true) {
      cOffset = content.indexOf('\x02c', cOffset + 1);
      if (cOffset < 0 || cOffset > offset) break;
      index += 1;
    }
    return comments[index];
  };

  // extract package name
  content = content.replace(/(\x02.)|(?:^|\n)\s*package\s+([\w.]+)\s*;/g, (m, g1, name, offset) => {
    if (g1) return g1;
    if (context.package) return m;
    context.package = {
      name,
      comment: getComment(offset),
    };
    return '\x02P';
  });

  // extract imports
  content = content.replace(/(\x02.)|(?:^|\n)\s*import\s+([\w.]+)(\.\*)?\s*;/g, (_m, g1, name, wild) => {
    if (g1) return g1;
    if (wild) {
      context.deps.wild.push(`${name}.`);
    } else {
      const basename = name.split('.').pop();
      context.deps.exact[basename] = name;
    }
    return '\x02i';
  });

  // parse classes
  content = content.replace(/(\x02.)|(?:^|\n)\s*public\s+(interface|enum|(?:abstract\s+)?class)\s+([\w\s,<>]+?)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?\s*\{/g, (m, g1, type, name, extendsName, implementsNames, offset) => {
    if (g1) return g1;
    if (context.type) return m;
    if (type === 'interface') {
      context.type = 'interface';
      context.payload = {
        name,
        fullName: `${context.package.name}.${name}`,
        comment: getComment(offset),
        methods: [],
        content: file.content,
      };
      context.payload.dep = getDep(context, context.payload);
      return '\x02I';
    }
    if (type === 'enum') {
      context.type = 'enum';
      context.payload = {
        name,
        fullName: `${context.package.name}.${name}`,
        items: [],
        fields: [],
        content: file.content,
        comment: getComment(offset),
      };
      context.payload.dep = getDep(context, context.payload);
      return '\x02E';
    }
    context.type = 'class';
    const extend = extendsName && getDep(context, { name: extendsName });
    const implement = implementsNames && implementsNames
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(implementsName => getDep(context, { name: implementsName }));
    const dep = scanTypes(context, name)[0];
    dep.fullName = `${context.package.name}.${dep.name}`;
    context.payload = {
      name: dep.name,
      dep,
      extend,
      implement,
      fullName: dep.fullName,
      props: [],
      content: file.content,
      comment: getComment(offset),
    };
    return '\x02C';
  });

  // parse interface
  if (context.type === 'interface') {
    try {
      content = content.replace(/(\x02.)|(?:^|\n)\s*(?:(?:private|public|static|final)\s+)?([\w\s<>,]+?) (\w+)\(\s*([\s\S]*?)\s*\)\s*(?:;|throws\s)/g, (_m, g1, typeStr, name, paramStr, offset) => {
        if (g1) return g1;
        context.payload.methods.push({
          name,
          type: scanTypes(context, typeStr)[0],
          params: scanParams(context, paramStr),
          comment: getComment(offset),
        });
        return '\x02m';
      });
    } catch (err) {
      context.error = err;
    }
  }

  // parse class
  if (context.type === 'class') {
    try {
      content = content.replace(/(\x02.)|((?:(?:private|public|static|final)\s+)+)([\w\s<>,]+?)\s+(\w+)\s*[=;]/g, (m, g1, keyword, typeStr, name, offset) => {
        if (g1) return g1;
        if (keyword.includes('static')) return m;
        context.payload.props.push({
          name,
          type: scanTypes(context, typeStr)[0],
          comment: getComment(offset),
        });
        return '\x02p';
      });
    } catch (err) {
      context.error = err;
    }
  }

  // parse enum
  if (context.type === 'enum') {
    try {
      const start = content.indexOf('\x02E');
      const end = content.indexOf(';', start);
      const enumContent = content.slice(start, end);
      enumContent.replace(/(\x02.)|(\w+)\(([^()]+)\)(?:,|\s*$)/g, (_m, g1, name, paramStr, offset) => {
        if (g1) return g1;
        context.payload.items.push({
          name,
          params: paramStr.split(',').map(item => item.trim()),
          comment: getComment(start + offset),
        });
        return '\x02e';
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
