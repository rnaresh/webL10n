/*  Copyright (c) 2012 Mozilla.
  *
  * Permission is hereby granted, free of charge, to any person obtaining a copy
  * of this software and associated documentation files (the "Software"), to
  * deal in the Software without restriction, including without limitation the
  * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
  * sell copies of the Software, and to permit persons to whom the Software is
  * furnished to do so, subject to the following conditions:
  *
  * The above copyright notice and this permission notice shall be included in
  * all copies or substantial portions of the Software.
  *
  * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
  * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
  * IN THE SOFTWARE.
  */

'use strict';
function parseL20n(text) {
  var parsedText = '';

  // utilities
  function next(re) {
    var match = re.exec(text);
    if (!match || !match.length)
      return null;
    // the RegExp (re) should always start with /^\s* -- except for comments
    assert(match.index == 0 || match[0] == '*\/');
    var index = match.index + match[0].length;
    parsedText += text.substring(0, index);
    text = text.substr(index);
    return match[0].replace(/^\s*/, '');
  }
  function assert(test) {
    if (!test)
      throw 'l10n parsing error: \n' +
        parsedText.substr(parsedText.length - 128) +
        ' ### ' + text.substring(0, 128);
  }
  function check(re) {
    var rv = next(re);
    assert(rv);
    return rv;
  }

  // tokens
  const reIdentifier = /^\s*[a-zA-Z]\w*/;
  const reNumber = /^\s*[0-9]\w*/;
  const reColonSep = /^\s*:\s*/;
  const reCommaSep = /^\s*,\s*/;
  const reValueBegin = /^\s*['"\[\{]/;
  const reStringDelim = /^\s*('''|"""|['"])/;

  // JSON-like values: string|array|list
  function readValue() {
    function evalString(str) {
      return str.replace(/\\\\/g, '\\')
                .replace(/\\n/g, '\n')
                .replace(/\\r/g, '\r')
                .replace(/\\t/g, '\t')
                .replace(/\\b/g, '\b')
                .replace(/\\f/g, '\f')
                .replace(/\\{/g, '{')
                .replace(/\\}/g, '}')
                .replace(/\\"/g, '"')
                .replace(/\\'/g, "'");
    }
    function getString() {
      // escape sequences: \, {{...}}
      var str = '';
      var len = text.length;
      var escapeMode = false;
      var delimFound = false;
      var delim = check(reStringDelim);
      var checkDelim = (delim.length == 1) ?
        function(pos) {
          return (text[pos] == delim);
        } : function(pos) {
          return (pos > 2) && (text.substring(pos - 2, pos + 1) == delim);
        };

      var i = 0;
      while (!delimFound && (i < len)) {
        if (escapeMode)
          escapeMode = false;
        else {
          delimFound = checkDelim(i);
          escapeMode = (text[i] == '\\');
          if ((i > 0) && (text[i] == '{') && (text[i - 1] == '{'))
            i = text.indexOf('}}', i);
        }
        i++;
      }
      if (delimFound) {
        parsedText += text.substring(0, i);
        str = evalString(text.substring(0, i - delim.length));
        text = text.substr(i);
      }
      return str;
    }
    function getSplitString() {
      // escape sequences: \, {{...}}
      var str = '';
      var len = text.length;
      var escapeMode = false;
      var delimFound = false;
      var delim = check(reStringDelim);
      var checkDelim = (delim.length == 1) ?
        function(pos) {
          return (text[pos] == delim);
        } : function(pos) {
          return (pos > 2) && (text.substring(pos - 2, pos + 1) == delim);
        };

      // same as readString() but splits the string when {{extends}} are found
      var i = 0;
      var last = 0;
      var output = [];
      while (!delimFound && (i < len)) {
        if (escapeMode)
          escapeMode = false;
        else {
          delimFound = checkDelim(i);
          escapeMode = (text[i] == '\\');
          if ((i > 0) && (text[i] == '{') && (text[i - 1] == '{')) {
            if (i > 1)
              output.push(evalString(text.substring(last, i - 1)));
            last = i - 1;
            i = text.indexOf('}}', last) + 2;
            output.push(evalString(text.substring(last, i)));
            last = i--;
          }
        }
        i++;
      }
      if (delimFound) {
        parsedText += text.substring(0, i);
        str = evalString(text.substring(last, i - delim.length));
        if (str.length)
          output.push(str);
        text = text.substr(i);
      } // else => trow exception
      return last ? output : str;
    }
    function getArray() {
      var reArrayEnd = /^\s*\]/;
      check(/^\s*\[/);
      if (next(reArrayEnd))
        return [];
      var table = [];
      do {
        table.push(readValue());
      } while (next(reCommaSep));
      check(reArrayEnd);
      return table;
    }
    function getList() {
      var reListEnd = /^\s*\}/;
      check(/^\s*\{/);
      if (next(reListEnd))
        return {};
      var list = {};
      do {
        var id = next(reIdentifier);
        check(reColonSep);
        list[id] = readValue();
      } while (next(reCommaSep));
      check(reListEnd);
      return list;
    }

    // return a string|array|list according to the first token
    var match = reValueBegin.exec(text);
    if (!match || !match.length)
      return null;
    var token = match[0];
    switch (token[token.length - 1]) {
      case '"':
      case "'":
        return getString();
        //return getSplitString();
        break;
      case '[':
        return getArray();
        break;
      case '{':
        return getList();
        break;
    }
    return null;
  }

  // C-style logical expressions
  function readExpression() {
    // member parsing
    function getPrimary() { // (expression) | number | value | ID
      if (next(/^\s*\(/)) {           // (expression)
        var expr = readExpression();
        check(/^\s*\)/);
        return { expression: expr };
      }
      var num = next(reNumber);       // number
      if (num)
        return parseInt(num, 10);
      if (reValueBegin.test(text))    // value
        return readValue();
      var id = next(reIdentifier);    // ID
      if (id)
        return id;
      return null;
    }
    function getAttr(primary) { // primary[.expression] | primary..ID
      var attr;
      if (next(/^\.\./))        // primary..ID
        attr = check(reIdentifier);
      else if (next(/^\[\./)) { // primary[.expression]
        attr = readExpression();
        check(/^\s*\]/);
      }
      return attr ? { primary: primary, attr: attr } : null;
    }
    function getProp(primary) { // primary[expression] | primary.ID
      var prop;
      if (next(/^\./))        // primary.ID
        prop = check(reIdentifier);
      else if (next(/^\[/)) { // primary[expression]
        prop = readExpression();
        check(/^\s*\]/);
      }
      return prop ? { primary: primary, prop: prop } : null;
    }
    function getCall(primary) { // primary(expression, ...)
      var params = [];
      if (next(/^\(/)) {
        do {
          params.push(readExpression());
        } while (next(reCommaSep));
        check(/^\)/);
        return { primary: primary, params: params };
      }
      return null;
    }
    function getMember() {  // primary | attr | prop | call
      var primary = getPrimary();
      if (!primary)
        return null;
      var member = getAttr(primary) || getProp(primary) || getCall(primary);
      while (member) {
        primary = member;
        member = getAttr(primary) || getProp(primary) || getCall(primary);
      }
      return member || primary;
    }

    // condition parsing
    const reUnaryOp = /^\s*[+\-!]/;
    const reBinaryOp = /^\s*(==|!=|<=|>=|\+|\-|\*|\/|%)/;
    const reLogicalOp = /^\s*(\|\||\&\&)/;
    function getUnary() {
      var operator = next(reUnaryOp);
      var member = getMember();
      return operator ? {
        operator: operator,
        member: member
      } : member;
    }
    function getBinary() {
      var left = getUnary();
      var operator = next(reBinaryOp);
      return operator ? {
        binary: {
          left: left,
          operator: operator,
          right: getBinary()
        }
      } : left;
    }
    function getLogical() {
      var left = getBinary();
      var operator = next(reLogicalOp);
      return operator ? {
        logical: {
          left: left,
          operator: operator,
          right: getLogical()
        }
      } : left;
    }
    function getConditional() {
      var logical = getLogical();
      if (next(/^\s*\?\s*/)) {
        var ifTrue = getConditional();
        check(reColonSep);
        var ifFalse = getConditional();
        return {
          conditional: {
            logical: logical,
            ifTrue: ifTrue,
            ifFalse: ifFalse
          }
        };
      } else
        return logical;
    }

    // an expression is always a conditional expression
    return getConditional();
  }

  // identifiers: ID + optional [index] or (params)
  function readIdentifier() {
    var id = {};
    id.key = check(reIdentifier);

    // possible index or macro params
    switch (text[0]) {

      case '[': // index
        check(/^\[/);
        id.index = [];
        do {
          id.index.push(readExpression());
        } while (next(reCommaSep));
        check(/^\s*]/);
        break;

      case '(': // macro params
        check(/^\(/);
        id.params = [];
        do {
          id.params.push(readExpression());
        } while (next(reCommaSep));
        check(/^\s*\)/);
        break;
    }

    return id;
  }

  // "LOL" entities :-/
  function lolParser() {
    var lolData = {};

    // entity delimiter
    function nextEntity() {
      while (next(/^\s*\/\*/))
        check(/\*\//);      // commments are ignored
      return next(/^\s*</); // found entity or macro
    }

    // entity attributes (key:value pairs)
    function readAttributes() {
      var attributes = {};
      var empty = true;
      var id = next(reIdentifier);
      while (id) {
        check(reColonSep);
        attributes[id] = readValue();
        id = next(reIdentifier);
        empty = false;
      }
      return empty ? null : attributes;
    }

    // parsing loop
    while (nextEntity()) {
      var id = readIdentifier();
      var key = id.key;
      if (key in lolData) // duplicate key: forget the former one
        delete(lolData[key]);

      // value and attributes
      if (!id.params) { // entity (= general case)
        var value = readValue();           // (optional) string | array | list
        var attributes = readAttributes(); // (optional) key-value pairs
        if (!attributes && !id.index) {    // plain string (= general case)
          lolData[key] = value;
        } else {
          lolData[key] = {};
          if (id.index)
            lolData[key].index = id.index;
          if (value)
            lolData[key].value = value;
          if (attributes)
            lolData[key].attributes = attributes;
        }
      } else { // macro
        check(/^\s*\{/);
        lolData[key] = {};
        lolData[key].params = id.params;
        lolData[key].macro = readExpression();
        check(/^\s*\}/);
      }

      // end of entity
      check(/^\s*>/);
    }
    return lolData;
  }

  // The format used for values|expressions|identifiers makes perfect sense,
  // but a more generic entity format is needed to replace the "LOL" one.
  // Alternative entity parsers (e.g. JSON-like) could go below.
  function jsonParser() {}

  return lolParser();
}

