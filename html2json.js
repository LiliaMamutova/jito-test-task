function convertHtml2JsonAndSet() {
  const htmlTextAreaValue = document.getElementById("html").value;
  const jsonObj = html2json(htmlTextAreaValue);
  const jsonArea = document.getElementById("json");
  jsonArea.textContent = JSON.stringify(jsonObj, null, 2);
}

const VOID_TAGS = {
  area: true,
  base: true,
  br: true,
  col: true,
  embed: true,
  hr: true,
  img: true,
  input: true,
  link: true,
  meta: true,
  param: true,
  source: true,
  track: true,
  wbr: true,
};

const RAWTEXT_TAGS = {
  script: true,
  style: true,
  textarea: true,
  title: true,
};

const RCDATA_TAGS = {
  textarea: true,
  title: true,
};

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00A0",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};


function isLetter(char) {
  return (char >= "a" && char <= "z") || (char >= "A" && char <= "Z");
}

function decodeEntities(text) {
  if (!text || text.indexOf("&") === -1) {
    return text;
  }

  const entitiesRegex = /&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);/gi;

  return text.replace(entitiesRegex, (match, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const codePoint = isHex
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);

      if (isNaN(codePoint) || codePoint > 0x10ffff) {
        return match;
      }

      const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
      if (codePoint === 0 || isSurrogate) {
        return "\uFFFD";
      }

      return String.fromCodePoint(codePoint);
    }

    return hasOwn(ENTITIES, entity) ? ENTITIES[entity] : match;
  });
}

function createElement(tag, attributes) {
  return {
    type: "element",
    tag,
    attributes: attributes || Object.create(null),
    children: [],
  }
}

function createText(text) {
  return {
    type: "text",
    content: text,
  }
}

function createComment(comment) {
  return {
    type: "comment",
    comment,
  }
}

function createDoctype(doctype) {
  return {
    type: "doctype",
    content: doctype,
  }
}

function isWhitespace(char) {
  switch (char) {
    case " ":
    case "\t":
    case "\n":
    case "\r":
    case "\f":
      return true;
    default:
      return false;
  }
}

function isTagStart(html, idx) {
  if(html[idx] !== "<") {
    return false;
  }
  const nextChar = html[idx + 1];
  return isLetter(nextChar);
}

function isCloseTagStart(html, idx){
  if(html[idx] !== "<" || html[idx + 1] !== "/"){
    return false;
  }
  const nextChar = html[idx + 2];
  return isLetter(nextChar);
}

function readTagName(html, idx) {
  const start = idx;

  while (idx < html.length) {
    const char = html[idx];
    if (isWhitespace(char) || char === "/" || char === ">") {
      break;
    }
    idx++;
  }

  return { tagName: html.slice(start, idx).toLowerCase(), idx };
}

function readAttributes(html, idx) {
  const length = html.length;
  const attributes = Object.create(null);
  let selfClosing = false;

  while (idx < length) {
    const loopStart = idx;

    while (idx < length && isWhitespace(html[idx])) {
      idx++;
    }
    if (idx >= length) {
      break;
    }

    const char = html[idx];

    if (char === ">") {
      idx++;
      break;
    }

    if (char === "/") {
      if (html[idx + 1] === ">") {
        selfClosing = true;
        idx += 2;
        break;
      }
      idx++;
      continue;
    }

    const nameStart = idx;
    if (html[idx] === "=") {
      idx++;
    }
    while (idx < length) {
      const c = html[idx];
      if (isWhitespace(c) || c === "=" || c === ">" || c === "/") {
        break;
      }
      idx++;
    }
    const name = html.slice(nameStart, idx).toLowerCase();

    while (idx < length && isWhitespace(html[idx])) {
      idx++;
    }

    let value = "";
    if (html[idx] === "=") {
      idx++;
      while (idx < length && isWhitespace(html[idx])) {
        idx++;
      }

      if (idx < length) {
        const quote = html[idx];
        if (quote === '"' || quote === "'") {
          idx++;
          const closeIdx = html.indexOf(quote, idx);
          if (closeIdx === -1) {
            value = html.slice(idx);
            idx = length;
          } else {
            value = html.slice(idx, closeIdx);
            idx = closeIdx + 1;
          }
        } else {
          const valueStart = idx;
          while (idx < length && !isWhitespace(html[idx]) && html[idx] !== ">") {
            idx++;
          }
          value = html.slice(valueStart, idx);
        }
      }
    }

    if (name && !hasOwn(attributes, name)) {
      attributes[name] = decodeEntities(value);
    }

    if (idx === loopStart) {
      idx++;
    }
  }

  return { attributes, selfClosing, idx };
}

function parseOpenTag(html, idx) {
  const tagResult = readTagName(html, idx + 1);
  const attributeResult = readAttributes(html, tagResult.idx);

  return {
    element: createElement(tagResult.tagName, attributeResult.attributes),
    selfClosing: attributeResult.selfClosing,
    idx: attributeResult.idx,
  };
}

function parseCloseTag(html, idx) {
  const tagResult = readTagName(html, idx + 2);
  const closeIdx = html.indexOf(">", tagResult.idx);

  return {
    tagName: tagResult.tagName,
    idx: closeIdx === -1 ? html.length : closeIdx + 1,
  };
}

function parseComment(html, idx) {
  const contentStart = idx + 4; // after "<!--"
  const end = html.indexOf("-->", contentStart);

  if (end === -1) {
    return { node: createComment(html.slice(contentStart)), idx: html.length };
  }
  return { node: createComment(html.slice(contentStart, end)), idx: end + 3 };
}

function parseDeclaration(html, idx) {
  const end = html.indexOf(">", idx);
  const nextIdx = end === -1 ? html.length : end + 1;
  const rawContent = html.slice(idx, nextIdx);

  const isDoctype = /^<!doctype/i.test(rawContent);
  const node = isDoctype ? createDoctype(rawContent) : createComment(rawContent);

  return { node, idx: nextIdx };
}

function readRawText(html, idx, tagName) {
  const regex = new RegExp("</" + tagName + "(?=[\\s/>])", "gi");
  regex.lastIndex = idx;

  const match = regex.exec(html);
  const end = match ? match.index : html.length;

  let content = html.slice(idx, end);
  if (hasOwn(RCDATA_TAGS, tagName)) {
    content = decodeEntities(content);
  }

  return { content, idx: end };
}

function readText(html, idx) {
  let end = idx;

  while (end < html.length) {
    const nextAngle = html.indexOf("<", end);

    if (nextAngle === -1) {
      end = html.length;
      break;
    }

    const next = html[nextAngle + 1];
    const startsMarkup =
        isTagStart(html, nextAngle) ||
        isCloseTagStart(html, nextAngle) ||
        next === "!" ||
        next === "?";

    if (startsMarkup) {
      end = nextAngle;
      break;
    }

    end = nextAngle + 1;
  }

  return { content: decodeEntities(html.slice(idx, end)), idx: end };
}

const MAX_DEPTH = 512;
const MAX_ERRORS = 100;

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function reportError(errors, message) {
  if (errors.length < MAX_ERRORS) {
    errors.push(message);
  }
}

function prepareInput(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "string" ? value : String(value);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// function isBlank(text) {
//   for (let i = 0; i < text.length; i++) {
//     if (!isWhitespace(text[i])) {
//       return false;
//     }
//   }
//   return true;
// }

function closeElement(stack, tagName, errors) {
  for (let i = stack.length - 1; i > 0; i--) {
    if (stack[i].tag === tagName) {
      for (let j = stack.length - 1; j > i; j--) {
        reportError(errors, `<${stack[j].tag}> closed implicitly by </${tagName}>`);
      }
      stack.length = i;
      return;
    }
  }
  reportError(errors, `Stray closing tag </${tagName}>`);
}

function openElement(html, stack, parsed, errors) {
  const { element, selfClosing } = parsed;
  let idx = parsed.idx;

  stack[stack.length - 1].children.push(element);

  if (hasOwn(VOID_TAGS, element.tag)) {
    return idx;
  }

  if (stack.length >= MAX_DEPTH) {
    reportError(errors, `Maximum depth exceeded at <${element.tag}>`);
    return idx;
  }

  stack.push(element);

  if (hasOwn(RAWTEXT_TAGS, element.tag)) {
    const raw = readRawText(html, idx, element.tag);
    if (raw.content !== "") {
      element.children.push(createText(raw.content));
    }
    idx = raw.idx;
  }

  return idx;
}

function parseNext(html, idx, stack, errors) {
  const parent = stack[stack.length - 1];

  if (html.startsWith("<!--", idx)) {
    const result = parseComment(html, idx);
    parent.children.push(result.node);
    return result.idx;
  }

  if (html[idx] === "<" && (html[idx + 1] === "!" || html[idx + 1] === "?")) {
    const result = parseDeclaration(html, idx);
    parent.children.push(result.node);
    return result.idx;
  }

  if (isCloseTagStart(html, idx)) {
    const result = parseCloseTag(html, idx);
    closeElement(stack, result.tagName, errors);
    return result.idx;
  }

  if (isTagStart(html, idx)) {
    return openElement(html, stack, parseOpenTag(html, idx), errors);
  }

  const result = readText(html, idx);
  parent.children.push(createText(result.content));
  return result.idx;
}

function html2json(htmlText) {
  const root = { type: "document", children: [], errors: [] };
  const stack = [root];

  try {
    const html = prepareInput(htmlText);
    let idx = 0;

    while (idx < html.length) {
      const nextIdx = parseNext(html, idx, stack, root.errors);
      idx = nextIdx > idx ? nextIdx : idx + 1;
    }

    for (let i = stack.length - 1; i > 0; i--) {
      reportError(root.errors, `Unclosed tag <${stack[i].tag}>`);
    }
  } catch (error) {
    reportError(root.errors, `Unexpected error: ${error.message}`);
  }

  return root;
}

