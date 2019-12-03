import { getDep, initContext } from './util';

export function skipEmptyLines(context, lines, offset) {
  while (offset < lines.length && !lines[offset]) offset += 1;
  return { offset };
}

export function skipBlank(context, line, offset) {
  while (line[offset] === ' ') offset += 1;
  return { offset };
}

export function skipChar(context, line, offset, char) {
  ({ offset } = skipBlank(context, line, offset));
  const sep = line[offset];
  if (sep && sep !== char) {
    throw new Error(`Error parsing ${context.filename}!

\`${char}\` is expected:

${line}
${' '.repeat(offset)}^
`);
  }
  return { offset: offset + 1 };
}

export function scanWord(context, line, offset) {
  ({ offset } = skipBlank(context, line, offset));
  const start = offset;
  while (offset < line.length && /\w/.test(line[offset])) offset += 1;
  return { data: line.slice(start, offset), offset };
}

export function scanType(context, line, offset) {
  const data = {};
  let tStart = -1;
  let tEnd = -1;
  let tLevel = 0;
  ({ offset } = skipBlank(context, line, offset));
  const start = offset;
  for (; offset < line.length; offset += 1) {
    const ch = line[offset];
    if (!tLevel && ' ,'.includes(ch)) {
      break;
    }
    if (ch === '<') {
      tLevel += 1;
      if (tLevel === 1) {
        tStart = offset;
      }
    } else if (ch === '>') {
      tLevel -= 1;
      if (!tLevel) {
        tEnd = offset;
        offset += 1;
        break;
      }
    }
  }
  if (tStart < 0) {
    data.name = line.slice(start, offset);
    data.t = [];
  } else {
    data.name = line.slice(start, tStart);
    data.t = scanTypes(context, line.slice(tStart + 1, tEnd), 0);
  }
  if (line[offset] === ' ') {
    const { offset: nonBlankOffset } = skipBlank(context, line, offset);
    if (line.slice(nonBlankOffset, nonBlankOffset + 8) === 'extends ') {
      offset = nonBlankOffset + 7;
      let extendType;
      ({ data: extendType, offset } = scanType(context, line, offset));
      data.extends = extendType;
    }
  }
  return {
    type: 'type',
    offset,
    data: getDep(context, data),
  };
}

export function scanTypes(context, line, offset) {
  const types = [];
  while (offset < line.length) {
    let data;
    ({ data, offset } = scanType(context, line, offset));
    types.push(data);
    ({ offset } = skipChar(context, line, offset, ','));
  }
  return types;
}

export function scanParam(context, line, offset) {
  let type;
  let name;
  ({ data: type, offset } = scanType(context, line, offset));
  ({ data: name, offset } = scanWord(context, line, offset));
  return {
    data: { type, name },
    offset,
  };
}

export function scanParams(context, line, offset) {
  const params = [];
  while (offset < line.length) {
    let data;
    ({ data, offset } = scanParam(context, line, offset));
    params.push(data);
    ({ offset } = skipChar(context, line, offset, ','));
  }
  return params;
}

const RE_COMMENT_LINE = /^\s*\/\*+\s*(.*?)\s*\*+\/\s*$/;

export function parseCommentLine(context, lines, offset) {
  const line = lines[offset];
  const matches = line.match(RE_COMMENT_LINE);
  if (matches) {
    const buffer = [];
    if (matches[1]) buffer.push(matches[1]);
    const comment = buffer.join('\n');
    return {
      type: 'comment',
      offset: offset + 1,
      data: comment && { comment },
    };
  }
  return { offset };
}

const RE_COMMENT_BLOCK_START = /^\s*\/\*+\s*(.*?)\s*$/;
const RE_COMMENT_BLOCK_END = /^\s*(.*?)\*+\//;
const RE_COMMENT_BLOCK_BODY_STRIP = /^\s*\*?( |$)/;

export function parseCommentBlock(context, lines, offset) {
  let started = false;
  const buffer = [];
  for (; offset < lines.length; offset += 1) {
    const line = lines[offset];

    if (!started) {
      // comment start
      const matches = line.match(RE_COMMENT_BLOCK_START);
      if (!matches) return { offset };
      started = true;
      if (matches[1]) buffer.push(matches[1]);
    } else {
      const matches = line.match(RE_COMMENT_BLOCK_END);
      if (!matches) {
        // comment body
        buffer.push(line.replace(RE_COMMENT_BLOCK_BODY_STRIP, ''));
      } else {
        // comment end
        started = false;
        if (matches[1]) buffer.push(matches[1]);
        const comment = buffer.join('\n');
        return {
          type: 'comment',
          offset: offset + 1,
          data: comment && { comment },
        };
      }
    }
  }
}

export function parsePackage(context, lines, offset) {
  const line = lines[offset];
  const matches = line.match(/^package ([\w.]+);$/);
  if (matches) {
    return {
      type: 'package',
      offset: offset + 1,
      data: {
        name: matches[1],
      },
    };
  }
  return { offset };
}

export function parseImport(context, lines, offset) {
  const line = lines[offset];
  {
    // wild import
    const matches = line.match(/^import ([\w.]+\.)\*;$/);
    if (matches) {
      const [, packageName] = matches;
      return {
        type: 'import',
        offset: offset + 1,
        data: {
          wild: true,
          name: packageName,
          fullName: packageName,
        },
      };
    }
  }
  {
    const matches = line.match(/^import ([\w.]+);$/);
    if (matches) {
      // console.log('import', line);
      const [, fullName] = matches;
      const name = fullName.split('.').pop();
      return {
        type: 'import',
        offset: offset + 1,
        data: {
          wild: false,
          name,
          fullName,
        },
      };
    }
  }
  return { offset };
}

export function parseInterface(context, lines, offset) {
  const line = lines[offset];
  const matches = line.match(/^public interface (\w+)/);
  if (matches) {
    return {
      type: 'interface',
      offset: offset + 1,
      data: {
        name: matches[1],
      },
    };
  }
  return { offset };
}

const RE_CLASS = /^public(?:\s+abstract)?\s+class\s+(.*?)(?:\s+extends\s+(\w+))?(?:\s+implements\s|\s*\{)/;

export function parseClass(context, lines, offset) {
  const line = lines[offset];
  const matches = line.match(RE_CLASS);
  if (matches) {
    const { data: dep } = scanType(context, matches[1], 0);
    const extend = matches[2];
    return {
      type: 'class',
      offset: offset + 1,
      data: {
        dep,
        extend: extend && {
          name: extend,
        },
      },
    };
  }
  return { offset };
}

export function parseEnum(context, lines, offset) {
  const line = lines[offset];
  const matches = line.match(/^public enum (\w+)/);
  if (matches) {
    return {
      type: 'enum',
      offset: offset + 1,
      data: {
        name: matches[1],
      },
    };
  }
  return { offset };
}

export function parseInterfaceMethod(context, lines, offset) {
  const line = lines[offset];
  const matches = line.match(/^\s*(.*?) (\w+)\((.*?)\)/);
  if (matches) {
    const [, typeStr, name, argStr] = matches;
    return {
      type: 'method',
      offset: offset + 1,
      data: {
        type: scanType(context, typeStr, 0).data,
        name,
        params: scanParams(context, argStr, 0),
      },
    };
  }
  return { offset };
}

const RE_CLASS_PROPERTY = /^\s*((?:(?:private|public|static|final)\s+)+)(.*?\s+\w+)\s*(?:=|;)/;

export function parseClassProperty(context, lines, offset) {
  const line = lines[offset];
  const matches = line.match(RE_CLASS_PROPERTY);
  if (matches && !matches[1].includes('static')) {
    const { data } = scanParam(context, matches[2], 0);
    return {
      type: 'property',
      offset: offset + 1,
      data,
    };
  }
  return { offset };
}

const RE_HAS_ENUM = /^\s*(\w+\(((['"]?).*?\3),\s*((['"]).*?\5)\)\s*(,|;|$))+/;
const RE_ENUM = /(\w+)\(((['"]?).*?\3),\s*((['"]).*?\5)\)\s*(,|;|$)/g;

export function parseEnumItems(context, lines, offset) {
  const line = lines[offset];
  const items = [];
  let finished = false;
  if (line.match(/^\s*;\s*$/)) {
    finished = true;
  } else {
    if (!RE_HAS_ENUM.test(line)) return { offset };
    offset += 1;
    let matches;
    while ((matches = RE_ENUM.exec(line))) {
      items.push({
        name: matches[1],
        code: matches[2],
        desc: matches[4],
      });
      if (matches[6] === ';') {
        finished = true;
        break;
      }
    }
  }
  return {
    type: 'items',
    offset: offset + 1,
    data: {
      items,
      finished,
    },
  };
}

export function parseFile(file) {
  const context = initContext(file);
  const { content } = file;
  const lines = content.trim().split(/[\r\n]/).map(line => line.trimEnd());

  let comment;
  const extractComment = () => {
    const current = comment;
    comment = null;
    return current;
  };

  let offset = 0;

  while (offset < lines.length) {
    let data;

    ({ offset, data } = parseCommentLine(context, lines, offset));
    if (data) {
      ({ comment } = data);
      continue;
    }

    ({ offset, data } = parseCommentBlock(context, lines, offset));
    if (data) {
      ({ comment } = data);
      continue;
    }

    ({ offset, data } = parseImport(context, lines, offset));
    if (data) {
      if (data.wild) context.deps.wild.push(data.name);
      else context.deps.exact[data.name] = data.fullName;
      continue;
    }

    ({ offset, data } = parsePackage(context, lines, offset));
    if (data) {
      context.package = {
        ...data,
        comment: extractComment(),
      };
      continue;
    }

    ({ offset, data } = parseInterface(context, lines, offset));
    if (data) {
      context.type = 'interface';
      context.payload = {
        ...data,
        fullName: `${context.package.name}.${data.name}`,
        comment: extractComment(),
        methods: [],
        content,
      };
      context.payload.dep = getDep(context, context.payload);
      continue;
    }

    if (context.type === 'interface') {
      ({ offset, data } = parseInterfaceMethod(context, lines, offset));
      if (data) {
        context.payload.methods.push({
          ...data,
          comment: extractComment(),
        });
        continue;
      }
    }

    ({ offset, data } = parseClass(context, lines, offset));
    if (data) {
      context.type = 'class';
      context.payload = {
        dep: data.dep,
        name: data.dep.name,
        extend: data.extend && getDep(context, data.extend),
        fullName: `${context.package.name}.${data.dep.name}`,
        comment: extractComment(),
        props: [],
        content,
      };
      data.dep.fullName = context.payload.fullName;
      continue;
    }

    if (context.type === 'class') {
      ({ offset, data } = parseClassProperty(context, lines, offset));
      if (data) {
        context.payload.props.push({
          ...data,
          comment: extractComment(),
        });
        continue;
      }
    }

    ({ offset, data } = parseEnum(context, lines, offset));
    if (data) {
      context.type = 'enum';
      context.payload = {
        ...data,
        fullName: `${context.package.name}.${data.name}`,
        comment: extractComment(),
        items: [],
        content,
      };
      context.payload.dep = getDep(context, context.payload);
      continue;
    }

    if (context.type === 'enum') {
      ({ offset, data } = parseEnumItems(context, lines, offset));
      if (data) {
        if (data.items) {
          const [first, ...rest] = data.items;
          context.payload.items.push({
            ...first,
            comment: extractComment(),
          }, ...rest);
        }
        context.payload.parsed = data.finished;
        if (context.payload.parsed) break;
        continue;
      }
    }

    ({ offset } = skipEmptyLines(context, lines, offset + 1));
  }

  return context;
}
