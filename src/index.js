import JSZip from 'jszip';

const byKey = key => (a, b) => {
  if (a[key] < b[key]) return -1;
  if (a[key] > b[key]) return 1;
  return 0;
};
const byName = byKey('name');

export default class JarParser {
  constructor(files) {
    this.files = files;
    this.interfaces = [];
    this.classes = [];
    this.enums = [];
    for (const file of files) {
      this.parseFile(file);
    }
    this.interfaces.sort(byName);
    this.interfaces.forEach(item => item.methods.sort(byName));
    this.classes.sort(byName);
    this.classes.forEach(item => item.props.sort(byName));
    this.enums.sort(byName);
  }

  static async parse(blob) {
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
    return new JarParser(files);
  }

  parseFile(file) {
    const { content } = file;
    const data = {
      deps: {},
    };
    let comment = {};
    const extractComment = () => {
      if (comment) {
        const { value } = comment;
        comment = {};
        return value;
      }
    };
    for (let line of content.split('\n')) {
      line = line.trimEnd();

      {
        // one line comment
        const matches = line.match(/^\s*\/\*+\s*(.*?)\s*\*+\/\s*$/);
        if (!comment.started && matches) {
          comment = {
            buffer: [],
          };
          if (matches[1]) comment.buffer.push(matches[1]);
          comment.value = comment.buffer.join('\n');
          // console.log('one line comment', line);
          continue;
        }
      }

      {
        // comment start
        const matches = line.match(/^\s*\/\*+\s*(.*?)\s*$/);
        if (!comment.started && matches) {
          comment = {
            started: true,
            buffer: [],
          };
          if (matches[1]) comment.buffer.push(matches[1]);
          // console.log('comment start', line);
          continue;
        }
      }

      {
        // comment end
        const matches = line.match(/^\s*(.*?)\*+\//);
        if (comment.started && matches) {
          comment.started = false;
          if (matches[1]) comment.buffer.push(matches[1]);
          comment.value = comment.buffer.join('\n');
          // console.log('comment end', line);
          continue;
        }
      }

      // comment body
      if (comment.started) {
        comment.buffer.push(line.replace(/^\s*\*?( |$)/, ''));
        // console.log('comment body', line);
        continue;
      }

      if (!line) {
        // console.log('empty line');
        continue;
      }

      {
        const matches = line.match(/^package ([\w.]+);$/);
        if (matches) {
          // console.log('package', line);
          data.package = {
            comment: extractComment(),
            name: matches[1],
          };
          continue;
        }
      }

      {
        const matches = line.match(/^import ([\w.]+);$/);
        if (matches) {
          // console.log('import', line);
          const [, fullName] = matches;
          const name = fullName.split('.').pop();
          data.deps[name] = fullName;
          continue;
        }
      }

      {
        const matches = line.match(/^public interface (\w+)/);
        if (matches) {
          // console.log('interface', line);
          data.type = 'interface';
          data.comment = extractComment();
          data.name = matches[1];
          data.fullName = `${data.package.name}.${data.name}`;
          data.methods = [];
          data.content = content;
          continue;
        }
      }

      {
        const matches = line.match(/^public(?: abstract)? class (.*?)(?: extends (\w+))? (?:implements |\{)/);
        if (matches) {
          // console.log('class', line);
          data.type = 'class';
          data.comment = extractComment();
          const { data: classInfo } = this.scanType(data, matches[1]);
          data.name = classInfo.name;
          data.t = classInfo.t;
          data.fullName = `${data.package.name}.${data.name}`;
          data.props = [];
          const extend = matches[2];
          if (extend) {
            data.extend = {
              name: extend,
              fullName: data.deps[extend] || `${data.package.name}.${extend}`,
            };
          }
          data.content = content;
          continue;
        }
      }

      {
        const matches = line.match(/^public enum (\w+)/);
        if (matches) {
          // console.log('enum', line);
          data.type = 'enum';
          data.comment = extractComment();
          data.name = matches[1];
          data.fullName = `${data.package.name}.${data.name}`;
          data.items = [];
          data.content = content;
          continue;
        }
      }

      {
        const method = data.type === 'interface' && this.parseMethod(data, line);
        if (method) {
          // console.log('method', line);
          data.methods.push({
            ...method,
            comment: extractComment(),
          });
          continue;
        }
      }

      {
        const property = data.type === 'class' && this.parseProperty(data, line);
        if (property) {
          // console.log('property', line);
          data.props.push({
            ...property,
            comment: extractComment(),
          });
          continue;
        }
      }

      {
        const result = data.type === 'enum' && this.parseEnum(data, line);
        const { items, finish } = result || {};
        if (items && items.length) {
          // console.log('enum', line);
          const [first, ...rest] = items;
          data.items.push({
            ...first,
            comment: extractComment(),
          }, ...rest);
          if (finish) break;
          continue;
        }
      }
    }

    if (data.type === 'interface') {
      this.interfaces.push(data);
    } else if (data.type === 'class') {
      this.classes.push(data);
    } else if (data.type === 'enum') {
      this.enums.push(data);
    }
  }

  parseMethod(context, line) {
    const matches = line.match(/^\s*(.*?) (\w+)\((.*?)\)/);
    if (!matches) return;
    const [, type, name, argStr] = matches;
    return {
      type: this.scanType(context, type).data,
      name,
      params: this.scanParams(context, argStr),
    };
  }

  parseProperty(context, line) {
    const matches = line.match(/^\s*((?:(?:private|public|static|final)\s+)+)(.*?\s+\w+)\s*(?:=|;)/);
    if (matches) {
      if (matches[1].includes('static')) return;
      const { data } = this.scanParam(context, matches[2]);
      return data;
    }
  }

  parseEnum(context, line) {
    if (line.match(/^\s*;\s*$/)) return { items: [], finish: true };
    let matches = line.match(/^\s*(\w+\(((['"]?).*?\3),\s*((['"]).*?\5)\)\s*(,|;|$))+/);
    if (!matches) return;
    matches = line.matchAll(/(\w+)\(((['"]?).*?\3),\s*((['"]).*?\5)\)\s*(,|;|$)/g);
    let finish = false;
    const items = [];
    for (const match of matches) {
      items.push({
        name: match[1],
        code: match[2],
        desc: match[4],
      });
      if (match[6] === ';') {
        finish = true;
        break;
      }
    }
    return { items, finish };
  }

  scanBlank(line, offset = 0) {
    while (line[offset] === ' ') offset += 1;
    return { offset };
  }

  scanWord(line, offset = 0) {
    ({ offset } = this.scanBlank(line, offset));
    const start = offset;
    while (offset < line.length && /\w/.test(line[offset])) offset += 1;
    return { data: line.slice(start, offset), offset };
  }

  scanParam(context, line, offset = 0) {
    let type;
    let name;
    ({ data: type, offset } = this.scanType(context, line, offset));
    ({ data: name, offset } = this.scanWord(line, offset));
    return {
      data: { type, name },
      offset,
    };
  }

  scanParams(context, line, offset = 0) {
    const params = [];
    while (offset < line.length) {
      let data;
      ({ data, offset } = this.scanParam(context, line, offset));
      params.push(data);
    }
    return params;
  }

  scanTypes(context, line, offset = 0) {
    const types = [];
    while (offset < line.length) {
      let data;
      ({ data, offset } = this.scanType(context, line, offset));
      types.push(data);
    }
    return types;
  }

  scanType(context, line, offset = 0) {
    const data = {};
    let tStart = -1;
    let tEnd = -1;
    let tLevel = 0;
    ({ offset } = this.scanBlank(line, offset));
    const start = offset;
    for (; offset < line.length; offset += 1) {
      const ch = line[offset];
      if (ch === ' ' && !tLevel) {
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
      data.t = this.scanTypes(context, line.slice(tStart + 1, tEnd));
    }
    data.fullName = context.deps[data.name] || `${context.package.name}.${data.name}`;
    return { data, offset };
  }
}
