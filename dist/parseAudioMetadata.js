function getBytes(buffer, offset, count) {
  return new Uint8Array(buffer, offset, count);
}

function sliceBytes(bytes, offset, count) {
  return bytes.slice(offset, offset + count);
}

function unpackBytes(bytes, options = {}) {
  if (options.endian === "little") {
    return bytes[0] | bytes[1] << 8 | bytes[2] << 16 | bytes[3] << 24;
  } else if (options.shiftBase === 7) {
    return bytes[0] << 21 | bytes[1] << 14 | bytes[2] << 7 | bytes[3];
  }

  let value = bytes[1] << 16 | bytes[2] << 8 | bytes[3];

  if (options.byteCount === 4) {
    value = bytes[0] << 24 | value;
  }

  return value;
}

function decode(bytes, encoding) {
  const decoder = new TextDecoder(encoding);
  return decoder.decode(bytes);
}

function increaseBuffer(file, size) {
  return new Promise(resolve => {
    const fileReader = new FileReader();
    const slicedFile = size ? file.slice(0, Math.min(size, file.size)) : file;

    fileReader.onloadend = function ({
      target
    }) {
      resolve(target.result);
    };

    fileReader.readAsArrayBuffer(slicedFile);
  });
}

function getSize(buffer, offset) {
  return unpackBytes(getBytes(buffer, offset, 4), {
    endian: "big",
    shiftBase: 7
  });
}

function getFrameSize(buffer, offset, version) {
  if (version === 3) {
    return unpackBytes(getBytes(buffer, offset, 4), {
      endian: "big"
    });
  }

  return getSize(buffer, offset);
} // http://id3.org/id3v2.4.0-structure


function decodeFrame(buffer, offset, size) {
  const bytes = getBytes(buffer, offset, size);
  const [firstByte] = bytes;

  if (firstByte === 0) {
    const string = decode(bytes, "iso-8859-1");
    return string.slice(1);
  } else if (firstByte === 1) {
    const encoding = bytes[1] === 255 && bytes[2] === 254 ? "utf-16le" : "utf-16be";
    const stringBytes = bytes.length % 2 === 0 ? bytes.slice(3, -1) : bytes.slice(3);

    if (encoding === "utf-16be") {
      stringBytes[0] = 0;
    }

    return decode(stringBytes, encoding);
  } else if (firstByte === 2) {
    const stringBytes = bytes.length % 2 === 0 ? bytes.slice(1, -1) : bytes.slice(1);
    return decode(stringBytes, "utf-16le");
  } else if (firstByte === 3) {
    const string = decode(bytes, "utf-8");
    return bytes[bytes.length - 1] === 0 ? string.slice(1, -1) : string.slice(1);
  }

  return decode(bytes, "iso-8859-1");
}

function getFrameId(buffer, offset) {
  const id = decode(getBytes(buffer, offset, 4));
  return /\w{4}/.test(id) ? id : null;
}

function getPictureDataLength(bytes, offset) {
  let length = 0;

  while (bytes[offset]) {
    offset += 1;
    length += 1;
  }

  return length;
} // http://id3.org/id3v2.4.0-frames


function getPicture(buffer, offset, size) {
  let pictureOffset = 1;
  const bytes = getBytes(buffer, offset, size);
  const MIMETypeLength = getPictureDataLength(bytes, pictureOffset);
  const MIMETypeBytes = getBytes(buffer, offset + pictureOffset, MIMETypeLength);
  const MIMEType = decode(MIMETypeBytes); // Jump over MIME type, terminator and picture type

  pictureOffset += MIMETypeLength + 2; // Skip description and its terminator

  const length = getPictureDataLength(bytes, pictureOffset) + 1;
  pictureOffset += length; // Description may end in 2 null bytes

  if (bytes[pictureOffset + length + 1] === 0) {
    pictureOffset += 1;
  }

  return new Blob([bytes.slice(pictureOffset)], {
    type: MIMEType
  });
}

async function parseID3Tag(file, buffer, version, offset = 0, tags = {}) {
  const initialOffset = offset; // Skip identifier, version, flags

  offset += 6; // +10 to include header size

  const tagSize = getSize(buffer, offset) + 10;
  offset += 4;

  if (initialOffset + tagSize > buffer.byteLength) {
    buffer = await increaseBuffer(file, initialOffset + tagSize + buffer.byteLength);
  }

  while (true) {
    const id = getFrameId(buffer, offset);
    offset += 4;
    const frameSize = getFrameSize(buffer, offset, version);
    offset += 4;
    const [encodingFlagByte] = getBytes(buffer, offset + 1, 2);
    const usesCompression = (encodingFlagByte >> 1) % 2 !== 0;
    offset += 2;

    if (id) {
      const field = mapFrameIdToField(id);
      let frameOffset = offset;
      let size = frameSize;

      if (usesCompression) {
        size = getFrameSize(buffer, frameOffset, version);
        frameOffset += 4;
      }

      if (field && !tags[field]) {
        if (field === "picture") {
          tags[field] = getPicture(buffer, frameOffset, size);
        } else {
          tags[field] = decodeFrame(buffer, frameOffset, size);
        }
      }
    } else {
      offset = initialOffset + tagSize;

      if (decode(getBytes(buffer, offset, 3)) === "ID3") {
        return parseID3Tag(file, buffer, version, offset, tags);
      }

      break;
    }

    offset += frameSize;
  } // Skip padding


  while (new DataView(buffer, offset, 1).getUint8(0) === 0) {
    offset += 1;
  }

  let frameCount = 0;
  let isFirstAudioFrame = true;

  while (true) {
    const bytes = getBytes(buffer, offset, 4);

    if (bytes[0] !== 255 || bytes[1] < 112) {
      tags.duration = getDuration(frameCount, tags);
      return tags;
    }

    if (isFirstAudioFrame) {
      tags = parseAudioFrameHeader(bytes, tags);
      const frameHeaderSize = 36;
      const id = decode(getBytes(buffer, offset + frameHeaderSize, 4));

      if (id === "Xing" || id === "Info") {
        return parseXingHeader(buffer, offset + frameHeaderSize, tags);
      }

      buffer = await increaseBuffer(file);
      isFirstAudioFrame = false;
    }

    frameCount += 1;
    offset += getAudioFrameSize(bytes[2], tags);
  }
}

function getAudioFrameSize(byte, {
  bitrate,
  sampleRate
}) {
  const padding = (byte & 0x02) > 0 ? 1 : 0;
  return Math.floor(144000 * bitrate / sampleRate) + padding;
} // https://www.codeproject.com/Articles/8295/MPEG-Audio-Frame-Header#MPEGAudioFrameHeader


function parseAudioFrameHeader(bytes, data) {
  const sampleRatesTable = [[11025, 12000, 8000], null, [22050, 24000, 16000], [44100, 48000, 32000]];
  const samplesPerFrameTable = [[384, 1152, 576], null, [384, 1152, 576], [384, 1152, 1152]]; // Bitrates

  const version1layer1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0];
  const version1layer2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0];
  const version1layer3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const version2layer1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0];
  const version2layer2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const version2layer3 = version2layer2;
  const bitratesByVerionAndLayer = [[null, version2layer3, version2layer2, version2layer1], null, [null, version2layer3, version2layer2, version2layer1], [null, version1layer3, version1layer2, version1layer1]];
  const verionIndex = bytes[1] >> 3 & 0x03;
  const layerIndex = bytes[1] >> 1 & 0x03;
  const sampleRateIndex = bytes[2] >> 2 & 0x03;
  const bitrateIndex = bytes[2] >> 4 & 0x0F;
  data.sampleRate = sampleRatesTable[verionIndex][sampleRateIndex];
  data.samplesPerFrame = samplesPerFrameTable[verionIndex][layerIndex];
  data.bitrate = bitratesByVerionAndLayer[verionIndex][layerIndex][bitrateIndex];
  return data;
}

function getDuration(frameCount, {
  samplesPerFrame,
  sampleRate
}) {
  return Math.floor(frameCount * samplesPerFrame / sampleRate);
}

function parseXingHeader(buffer, offset, tags) {
  // +8 to jump to frame count bytes
  const frameCount = unpackBytes(getBytes(buffer, offset + 8, 4), {
    endian: "big"
  });
  tags.duration = getDuration(frameCount, tags);
  return tags;
}

function mapFrameIdToField(id) {
  const map = {
    TIT2: "title",
    TPE1: "artist",
    TALB: "album",
    APIC: "picture"
  };
  return map[id];
}

var _isObject = function (it) {
  return typeof it === 'object' ? it !== null : typeof it === 'function';
};

var toString = {}.toString;

var _cof = function (it) {
  return toString.call(it).slice(8, -1);
};

function createCommonjsModule(fn, module) {
	return module = { exports: {} }, fn(module, module.exports), module.exports;
}

var _core = createCommonjsModule(function (module) {
var core = module.exports = { version: '2.6.9' };
if (typeof __e == 'number') __e = core; // eslint-disable-line no-undef
});
var _core_1 = _core.version;

var _global = createCommonjsModule(function (module) {
// https://github.com/zloirock/core-js/issues/86#issuecomment-115759028
var global = module.exports = typeof window != 'undefined' && window.Math == Math
  ? window : typeof self != 'undefined' && self.Math == Math ? self
  // eslint-disable-next-line no-new-func
  : Function('return this')();
if (typeof __g == 'number') __g = global; // eslint-disable-line no-undef
});

var _shared = createCommonjsModule(function (module) {
var SHARED = '__core-js_shared__';
var store = _global[SHARED] || (_global[SHARED] = {});

(module.exports = function (key, value) {
  return store[key] || (store[key] = value !== undefined ? value : {});
})('versions', []).push({
  version: _core.version,
  mode:  'global',
  copyright: '© 2019 Denis Pushkarev (zloirock.ru)'
});
});

var id = 0;
var px = Math.random();
var _uid = function (key) {
  return 'Symbol('.concat(key === undefined ? '' : key, ')_', (++id + px).toString(36));
};

var _wks = createCommonjsModule(function (module) {
var store = _shared('wks');

var Symbol = _global.Symbol;
var USE_SYMBOL = typeof Symbol == 'function';

var $exports = module.exports = function (name) {
  return store[name] || (store[name] =
    USE_SYMBOL && Symbol[name] || (USE_SYMBOL ? Symbol : _uid)('Symbol.' + name));
};

$exports.store = store;
});

// 7.2.8 IsRegExp(argument)


var MATCH = _wks('match');
var _isRegexp = function (it) {
  var isRegExp;
  return _isObject(it) && ((isRegExp = it[MATCH]) !== undefined ? !!isRegExp : _cof(it) == 'RegExp');
};

var _anObject = function (it) {
  if (!_isObject(it)) throw TypeError(it + ' is not an object!');
  return it;
};

var _aFunction = function (it) {
  if (typeof it != 'function') throw TypeError(it + ' is not a function!');
  return it;
};

// 7.3.20 SpeciesConstructor(O, defaultConstructor)


var SPECIES = _wks('species');
var _speciesConstructor = function (O, D) {
  var C = _anObject(O).constructor;
  var S;
  return C === undefined || (S = _anObject(C)[SPECIES]) == undefined ? D : _aFunction(S);
};

// 7.1.4 ToInteger
var ceil = Math.ceil;
var floor = Math.floor;
var _toInteger = function (it) {
  return isNaN(it = +it) ? 0 : (it > 0 ? floor : ceil)(it);
};

// 7.2.1 RequireObjectCoercible(argument)
var _defined = function (it) {
  if (it == undefined) throw TypeError("Can't call method on  " + it);
  return it;
};

// true  -> String#at
// false -> String#codePointAt
var _stringAt = function (TO_STRING) {
  return function (that, pos) {
    var s = String(_defined(that));
    var i = _toInteger(pos);
    var l = s.length;
    var a, b;
    if (i < 0 || i >= l) return TO_STRING ? '' : undefined;
    a = s.charCodeAt(i);
    return a < 0xd800 || a > 0xdbff || i + 1 === l || (b = s.charCodeAt(i + 1)) < 0xdc00 || b > 0xdfff
      ? TO_STRING ? s.charAt(i) : a
      : TO_STRING ? s.slice(i, i + 2) : (a - 0xd800 << 10) + (b - 0xdc00) + 0x10000;
  };
};

var at = _stringAt(true);

 // `AdvanceStringIndex` abstract operation
// https://tc39.github.io/ecma262/#sec-advancestringindex
var _advanceStringIndex = function (S, index, unicode) {
  return index + (unicode ? at(S, index).length : 1);
};

// 7.1.15 ToLength

var min = Math.min;
var _toLength = function (it) {
  return it > 0 ? min(_toInteger(it), 0x1fffffffffffff) : 0; // pow(2, 53) - 1 == 9007199254740991
};

// getting tag from 19.1.3.6 Object.prototype.toString()

var TAG = _wks('toStringTag');
// ES3 wrong here
var ARG = _cof(function () { return arguments; }()) == 'Arguments';

// fallback for IE11 Script Access Denied error
var tryGet = function (it, key) {
  try {
    return it[key];
  } catch (e) { /* empty */ }
};

var _classof = function (it) {
  var O, T, B;
  return it === undefined ? 'Undefined' : it === null ? 'Null'
    // @@toStringTag case
    : typeof (T = tryGet(O = Object(it), TAG)) == 'string' ? T
    // builtinTag case
    : ARG ? _cof(O)
    // ES3 arguments fallback
    : (B = _cof(O)) == 'Object' && typeof O.callee == 'function' ? 'Arguments' : B;
};

var builtinExec = RegExp.prototype.exec;

 // `RegExpExec` abstract operation
// https://tc39.github.io/ecma262/#sec-regexpexec
var _regexpExecAbstract = function (R, S) {
  var exec = R.exec;
  if (typeof exec === 'function') {
    var result = exec.call(R, S);
    if (typeof result !== 'object') {
      throw new TypeError('RegExp exec method returned something other than an Object or null');
    }
    return result;
  }
  if (_classof(R) !== 'RegExp') {
    throw new TypeError('RegExp#exec called on incompatible receiver');
  }
  return builtinExec.call(R, S);
};

// 21.2.5.3 get RegExp.prototype.flags

var _flags = function () {
  var that = _anObject(this);
  var result = '';
  if (that.global) result += 'g';
  if (that.ignoreCase) result += 'i';
  if (that.multiline) result += 'm';
  if (that.unicode) result += 'u';
  if (that.sticky) result += 'y';
  return result;
};

var nativeExec = RegExp.prototype.exec;
// This always refers to the native implementation, because the
// String#replace polyfill uses ./fix-regexp-well-known-symbol-logic.js,
// which loads this file before patching the method.
var nativeReplace = String.prototype.replace;

var patchedExec = nativeExec;

var LAST_INDEX = 'lastIndex';

var UPDATES_LAST_INDEX_WRONG = (function () {
  var re1 = /a/,
      re2 = /b*/g;
  nativeExec.call(re1, 'a');
  nativeExec.call(re2, 'a');
  return re1[LAST_INDEX] !== 0 || re2[LAST_INDEX] !== 0;
})();

// nonparticipating capturing group, copied from es5-shim's String#split patch.
var NPCG_INCLUDED = /()??/.exec('')[1] !== undefined;

var PATCH = UPDATES_LAST_INDEX_WRONG || NPCG_INCLUDED;

if (PATCH) {
  patchedExec = function exec(str) {
    var re = this;
    var lastIndex, reCopy, match, i;

    if (NPCG_INCLUDED) {
      reCopy = new RegExp('^' + re.source + '$(?!\\s)', _flags.call(re));
    }
    if (UPDATES_LAST_INDEX_WRONG) lastIndex = re[LAST_INDEX];

    match = nativeExec.call(re, str);

    if (UPDATES_LAST_INDEX_WRONG && match) {
      re[LAST_INDEX] = re.global ? match.index + match[0].length : lastIndex;
    }
    if (NPCG_INCLUDED && match && match.length > 1) {
      // Fix browsers whose `exec` methods don't consistently return `undefined`
      // for NPCG, like IE8. NOTE: This doesn' work for /(.?)?/
      // eslint-disable-next-line no-loop-func
      nativeReplace.call(match[0], reCopy, function () {
        for (i = 1; i < arguments.length - 2; i++) {
          if (arguments[i] === undefined) match[i] = undefined;
        }
      });
    }

    return match;
  };
}

var _regexpExec = patchedExec;

var _fails = function (exec) {
  try {
    return !!exec();
  } catch (e) {
    return true;
  }
};

// Thank's IE8 for his funny defineProperty
var _descriptors = !_fails(function () {
  return Object.defineProperty({}, 'a', { get: function () { return 7; } }).a != 7;
});

var document = _global.document;
// typeof document.createElement is 'object' in old IE
var is = _isObject(document) && _isObject(document.createElement);
var _domCreate = function (it) {
  return is ? document.createElement(it) : {};
};

var _ie8DomDefine = !_descriptors && !_fails(function () {
  return Object.defineProperty(_domCreate('div'), 'a', { get: function () { return 7; } }).a != 7;
});

// 7.1.1 ToPrimitive(input [, PreferredType])

// instead of the ES6 spec version, we didn't implement @@toPrimitive case
// and the second argument - flag - preferred type is a string
var _toPrimitive = function (it, S) {
  if (!_isObject(it)) return it;
  var fn, val;
  if (S && typeof (fn = it.toString) == 'function' && !_isObject(val = fn.call(it))) return val;
  if (typeof (fn = it.valueOf) == 'function' && !_isObject(val = fn.call(it))) return val;
  if (!S && typeof (fn = it.toString) == 'function' && !_isObject(val = fn.call(it))) return val;
  throw TypeError("Can't convert object to primitive value");
};

var dP = Object.defineProperty;

var f = _descriptors ? Object.defineProperty : function defineProperty(O, P, Attributes) {
  _anObject(O);
  P = _toPrimitive(P, true);
  _anObject(Attributes);
  if (_ie8DomDefine) try {
    return dP(O, P, Attributes);
  } catch (e) { /* empty */ }
  if ('get' in Attributes || 'set' in Attributes) throw TypeError('Accessors not supported!');
  if ('value' in Attributes) O[P] = Attributes.value;
  return O;
};

var _objectDp = {
	f: f
};

var _propertyDesc = function (bitmap, value) {
  return {
    enumerable: !(bitmap & 1),
    configurable: !(bitmap & 2),
    writable: !(bitmap & 4),
    value: value
  };
};

var _hide = _descriptors ? function (object, key, value) {
  return _objectDp.f(object, key, _propertyDesc(1, value));
} : function (object, key, value) {
  object[key] = value;
  return object;
};

var hasOwnProperty = {}.hasOwnProperty;
var _has = function (it, key) {
  return hasOwnProperty.call(it, key);
};

var _functionToString = _shared('native-function-to-string', Function.toString);

var _redefine = createCommonjsModule(function (module) {
var SRC = _uid('src');

var TO_STRING = 'toString';
var TPL = ('' + _functionToString).split(TO_STRING);

_core.inspectSource = function (it) {
  return _functionToString.call(it);
};

(module.exports = function (O, key, val, safe) {
  var isFunction = typeof val == 'function';
  if (isFunction) _has(val, 'name') || _hide(val, 'name', key);
  if (O[key] === val) return;
  if (isFunction) _has(val, SRC) || _hide(val, SRC, O[key] ? '' + O[key] : TPL.join(String(key)));
  if (O === _global) {
    O[key] = val;
  } else if (!safe) {
    delete O[key];
    _hide(O, key, val);
  } else if (O[key]) {
    O[key] = val;
  } else {
    _hide(O, key, val);
  }
// add fake Function#toString for correct work wrapped methods / constructors with methods like LoDash isNative
})(Function.prototype, TO_STRING, function toString() {
  return typeof this == 'function' && this[SRC] || _functionToString.call(this);
});
});

// optional / simple context binding

var _ctx = function (fn, that, length) {
  _aFunction(fn);
  if (that === undefined) return fn;
  switch (length) {
    case 1: return function (a) {
      return fn.call(that, a);
    };
    case 2: return function (a, b) {
      return fn.call(that, a, b);
    };
    case 3: return function (a, b, c) {
      return fn.call(that, a, b, c);
    };
  }
  return function (/* ...args */) {
    return fn.apply(that, arguments);
  };
};

var PROTOTYPE = 'prototype';

var $export = function (type, name, source) {
  var IS_FORCED = type & $export.F;
  var IS_GLOBAL = type & $export.G;
  var IS_STATIC = type & $export.S;
  var IS_PROTO = type & $export.P;
  var IS_BIND = type & $export.B;
  var target = IS_GLOBAL ? _global : IS_STATIC ? _global[name] || (_global[name] = {}) : (_global[name] || {})[PROTOTYPE];
  var exports = IS_GLOBAL ? _core : _core[name] || (_core[name] = {});
  var expProto = exports[PROTOTYPE] || (exports[PROTOTYPE] = {});
  var key, own, out, exp;
  if (IS_GLOBAL) source = name;
  for (key in source) {
    // contains in native
    own = !IS_FORCED && target && target[key] !== undefined;
    // export native or passed
    out = (own ? target : source)[key];
    // bind timers to global for call from export context
    exp = IS_BIND && own ? _ctx(out, _global) : IS_PROTO && typeof out == 'function' ? _ctx(Function.call, out) : out;
    // extend global
    if (target) _redefine(target, key, out, type & $export.U);
    // export
    if (exports[key] != out) _hide(exports, key, exp);
    if (IS_PROTO && expProto[key] != out) expProto[key] = out;
  }
};
_global.core = _core;
// type bitmap
$export.F = 1;   // forced
$export.G = 2;   // global
$export.S = 4;   // static
$export.P = 8;   // proto
$export.B = 16;  // bind
$export.W = 32;  // wrap
$export.U = 64;  // safe
$export.R = 128; // real proto method for `library`
var _export = $export;

_export({
  target: 'RegExp',
  proto: true,
  forced: _regexpExec !== /./.exec
}, {
  exec: _regexpExec
});

var SPECIES$1 = _wks('species');

var REPLACE_SUPPORTS_NAMED_GROUPS = !_fails(function () {
  // #replace needs built-in support for named groups.
  // #match works fine because it just return the exec results, even if it has
  // a "grops" property.
  var re = /./;
  re.exec = function () {
    var result = [];
    result.groups = { a: '7' };
    return result;
  };
  return ''.replace(re, '$<a>') !== '7';
});

var SPLIT_WORKS_WITH_OVERWRITTEN_EXEC = (function () {
  // Chrome 51 has a buggy "split" implementation when RegExp#exec !== nativeExec
  var re = /(?:)/;
  var originalExec = re.exec;
  re.exec = function () { return originalExec.apply(this, arguments); };
  var result = 'ab'.split(re);
  return result.length === 2 && result[0] === 'a' && result[1] === 'b';
})();

var _fixReWks = function (KEY, length, exec) {
  var SYMBOL = _wks(KEY);

  var DELEGATES_TO_SYMBOL = !_fails(function () {
    // String methods call symbol-named RegEp methods
    var O = {};
    O[SYMBOL] = function () { return 7; };
    return ''[KEY](O) != 7;
  });

  var DELEGATES_TO_EXEC = DELEGATES_TO_SYMBOL ? !_fails(function () {
    // Symbol-named RegExp methods call .exec
    var execCalled = false;
    var re = /a/;
    re.exec = function () { execCalled = true; return null; };
    if (KEY === 'split') {
      // RegExp[@@split] doesn't call the regex's exec method, but first creates
      // a new one. We need to return the patched regex when creating the new one.
      re.constructor = {};
      re.constructor[SPECIES$1] = function () { return re; };
    }
    re[SYMBOL]('');
    return !execCalled;
  }) : undefined;

  if (
    !DELEGATES_TO_SYMBOL ||
    !DELEGATES_TO_EXEC ||
    (KEY === 'replace' && !REPLACE_SUPPORTS_NAMED_GROUPS) ||
    (KEY === 'split' && !SPLIT_WORKS_WITH_OVERWRITTEN_EXEC)
  ) {
    var nativeRegExpMethod = /./[SYMBOL];
    var fns = exec(
      _defined,
      SYMBOL,
      ''[KEY],
      function maybeCallNative(nativeMethod, regexp, str, arg2, forceStringMethod) {
        if (regexp.exec === _regexpExec) {
          if (DELEGATES_TO_SYMBOL && !forceStringMethod) {
            // The native String method already delegates to @@method (this
            // polyfilled function), leasing to infinite recursion.
            // We avoid it by directly calling the native @@method method.
            return { done: true, value: nativeRegExpMethod.call(regexp, str, arg2) };
          }
          return { done: true, value: nativeMethod.call(str, regexp, arg2) };
        }
        return { done: false };
      }
    );
    var strfn = fns[0];
    var rxfn = fns[1];

    _redefine(String.prototype, KEY, strfn);
    _hide(RegExp.prototype, SYMBOL, length == 2
      // 21.2.5.8 RegExp.prototype[@@replace](string, replaceValue)
      // 21.2.5.11 RegExp.prototype[@@split](string, limit)
      ? function (string, arg) { return rxfn.call(string, this, arg); }
      // 21.2.5.6 RegExp.prototype[@@match](string)
      // 21.2.5.9 RegExp.prototype[@@search](string)
      : function (string) { return rxfn.call(string, this); }
    );
  }
};

var $min = Math.min;
var $push = [].push;
var $SPLIT = 'split';
var LENGTH = 'length';
var LAST_INDEX$1 = 'lastIndex';
var MAX_UINT32 = 0xffffffff;

// babel-minify transpiles RegExp('x', 'y') -> /x/y and it causes SyntaxError
var SUPPORTS_Y = !_fails(function () { RegExp(MAX_UINT32, 'y'); });

// @@split logic
_fixReWks('split', 2, function (defined, SPLIT, $split, maybeCallNative) {
  var internalSplit;
  if (
    'abbc'[$SPLIT](/(b)*/)[1] == 'c' ||
    'test'[$SPLIT](/(?:)/, -1)[LENGTH] != 4 ||
    'ab'[$SPLIT](/(?:ab)*/)[LENGTH] != 2 ||
    '.'[$SPLIT](/(.?)(.?)/)[LENGTH] != 4 ||
    '.'[$SPLIT](/()()/)[LENGTH] > 1 ||
    ''[$SPLIT](/.?/)[LENGTH]
  ) {
    // based on es5-shim implementation, need to rework it
    internalSplit = function (separator, limit) {
      var string = String(this);
      if (separator === undefined && limit === 0) return [];
      // If `separator` is not a regex, use native split
      if (!_isRegexp(separator)) return $split.call(string, separator, limit);
      var output = [];
      var flags = (separator.ignoreCase ? 'i' : '') +
                  (separator.multiline ? 'm' : '') +
                  (separator.unicode ? 'u' : '') +
                  (separator.sticky ? 'y' : '');
      var lastLastIndex = 0;
      var splitLimit = limit === undefined ? MAX_UINT32 : limit >>> 0;
      // Make `global` and avoid `lastIndex` issues by working with a copy
      var separatorCopy = new RegExp(separator.source, flags + 'g');
      var match, lastIndex, lastLength;
      while (match = _regexpExec.call(separatorCopy, string)) {
        lastIndex = separatorCopy[LAST_INDEX$1];
        if (lastIndex > lastLastIndex) {
          output.push(string.slice(lastLastIndex, match.index));
          if (match[LENGTH] > 1 && match.index < string[LENGTH]) $push.apply(output, match.slice(1));
          lastLength = match[0][LENGTH];
          lastLastIndex = lastIndex;
          if (output[LENGTH] >= splitLimit) break;
        }
        if (separatorCopy[LAST_INDEX$1] === match.index) separatorCopy[LAST_INDEX$1]++; // Avoid an infinite loop
      }
      if (lastLastIndex === string[LENGTH]) {
        if (lastLength || !separatorCopy.test('')) output.push('');
      } else output.push(string.slice(lastLastIndex));
      return output[LENGTH] > splitLimit ? output.slice(0, splitLimit) : output;
    };
  // Chakra, V8
  } else if ('0'[$SPLIT](undefined, 0)[LENGTH]) {
    internalSplit = function (separator, limit) {
      return separator === undefined && limit === 0 ? [] : $split.call(this, separator, limit);
    };
  } else {
    internalSplit = $split;
  }

  return [
    // `String.prototype.split` method
    // https://tc39.github.io/ecma262/#sec-string.prototype.split
    function split(separator, limit) {
      var O = defined(this);
      var splitter = separator == undefined ? undefined : separator[SPLIT];
      return splitter !== undefined
        ? splitter.call(separator, O, limit)
        : internalSplit.call(String(O), separator, limit);
    },
    // `RegExp.prototype[@@split]` method
    // https://tc39.github.io/ecma262/#sec-regexp.prototype-@@split
    //
    // NOTE: This cannot be properly polyfilled in engines that don't support
    // the 'y' flag.
    function (regexp, limit) {
      var res = maybeCallNative(internalSplit, regexp, this, limit, internalSplit !== $split);
      if (res.done) return res.value;

      var rx = _anObject(regexp);
      var S = String(this);
      var C = _speciesConstructor(rx, RegExp);

      var unicodeMatching = rx.unicode;
      var flags = (rx.ignoreCase ? 'i' : '') +
                  (rx.multiline ? 'm' : '') +
                  (rx.unicode ? 'u' : '') +
                  (SUPPORTS_Y ? 'y' : 'g');

      // ^(? + rx + ) is needed, in combination with some S slicing, to
      // simulate the 'y' flag.
      var splitter = new C(SUPPORTS_Y ? rx : '^(?:' + rx.source + ')', flags);
      var lim = limit === undefined ? MAX_UINT32 : limit >>> 0;
      if (lim === 0) return [];
      if (S.length === 0) return _regexpExecAbstract(splitter, S) === null ? [S] : [];
      var p = 0;
      var q = 0;
      var A = [];
      while (q < S.length) {
        splitter.lastIndex = SUPPORTS_Y ? q : 0;
        var z = _regexpExecAbstract(splitter, SUPPORTS_Y ? S : S.slice(q));
        var e;
        if (
          z === null ||
          (e = $min(_toLength(splitter.lastIndex + (SUPPORTS_Y ? 0 : q)), S.length)) === p
        ) {
          q = _advanceStringIndex(S, q, unicodeMatching);
        } else {
          A.push(S.slice(p, q));
          if (A.length === lim) return A;
          for (var i = 1; i <= z.length - 1; i++) {
            A.push(z[i]);
            if (A.length === lim) return A;
          }
          q = p = e;
        }
      }
      A.push(S.slice(p));
      return A;
    }
  ];
});

function convertBase64ToUint8(data) {
  const raw = window.atob(data);
  const array = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i++) {
    array[i] = raw.charCodeAt(i);
  }

  return array;
}

function unpackPicutreBlockBytes(bytes, offset) {
  return unpackBytes(sliceBytes(bytes, offset, 4), {
    endian: "big"
  });
} // https://xiph.org/flac/format.html#metadata_block_picture


function parsePictureBlock(bytes, tags) {
  // Start from 4th byte to skip picture type
  let offset = 4;
  const MIMETypeLength = unpackPicutreBlockBytes(bytes, offset);
  offset += 4;
  const MIMEType = decode(sliceBytes(bytes, offset, MIMETypeLength));
  offset += MIMETypeLength;
  const descriptionLength = unpackPicutreBlockBytes(bytes, offset);
  offset += 4; // Skip description

  offset += descriptionLength; // Skip picture width, height, color depth, number of colors used

  offset += 16;
  const pictureLength = unpackPicutreBlockBytes(bytes, offset);
  offset += 4;
  tags.picture = new Blob([sliceBytes(bytes, offset, pictureLength)], {
    type: MIMEType
  });
  return tags;
}

function unpackVorbisCommentBytes(bytes, offset) {
  return unpackBytes(sliceBytes(bytes, offset, 4), {
    endian: "little"
  });
} // https://xiph.org/flac/format.html#metadata_block_vorbis_comment
// https://tools.ietf.org/html/rfc7845#section-5.2


function parseVorbisComment(bytes, tags, offset = 0) {
  const vendorStringLength = unpackVorbisCommentBytes(bytes, offset);
  offset += vendorStringLength + 4;
  let userCommentCount = unpackVorbisCommentBytes(bytes, offset);
  offset += 4;

  while (userCommentCount) {
    const userCommentLength = unpackVorbisCommentBytes(bytes, offset);
    offset += 4;
    const userComment = decode(sliceBytes(bytes, offset, userCommentLength), "utf-8");
    const [name, value] = userComment.split("=");

    if (name === "METADATA_BLOCK_PICTURE") {
      tags = parsePictureBlock(convertBase64ToUint8(value), tags);
    } else {
      tags[name.toLowerCase()] = value;
    }

    offset += userCommentLength;
    userCommentCount -= 1;
  }

  return tags;
}

function parseStreamInfoBlock(bytes, tags) {
  const sampleRate = bytesToNum(bytes.slice(10, 13)) >> 4;
  const sampleBytes = [bytes[13] & 0x0F, ...bytes.slice(14, 18)];
  const totalSamples = bytesToNum(sampleBytes);

  if (sampleRate) {
    tags.duration = Math.floor(totalSamples / sampleRate);
  }

  return tags;
}

function bytesToNum(bytes) {
  return bytes.reduce((result, byte) => (result << 8) + byte, 0);
}

async function parseBlocks(file, buffer, offset = 4) {
  let tags = {};
  let isLastBlock = false;

  while (!isLastBlock) {
    const header = getBytes(buffer, offset, 4);
    const length = unpackBytes(header, {
      endian: "big"
    });
    const firstByte = header[0];
    const blockType = firstByte & 0x7F;
    isLastBlock = (firstByte & 0x80) === 0x80;
    offset += 4;

    if (offset + length > buffer.byteLength) {
      buffer = await increaseBuffer(file, buffer.byteLength + offset + length);
    }

    if (blockType === 0) {
      const bytes = getBytes(buffer, offset, length);
      tags = parseStreamInfoBlock(bytes, tags);
    } else if (blockType === 4) {
      const bytes = getBytes(buffer, offset, length);
      tags = parseVorbisComment(bytes, tags);
    } else if (blockType === 6) {
      const bytes = getBytes(buffer, offset, length);
      tags = parsePictureBlock(bytes, tags);
    }

    offset += length;
  }

  return tags;
}

function mergeTypedArrays(a, b) {
  const c = new Uint8Array(a.length + b.length);
  c.set(a);
  c.set(b, a.length);
  return c;
} // https://tools.ietf.org/html/rfc7845#section-5.1
// https://xiph.org/vorbis/doc/Vorbis_I_spec.html#x1-630004.2.2


function parseIdHeader(bytes, tags) {
  tags.sampleRate = unpackBytes(sliceBytes(bytes, 12, 4), {
    endian: "little"
  });
  return tags;
}

function parseSegment(segment, tags) {
  const type = decode(sliceBytes(segment, 0, 5));

  if (type === "OpusH" || type === "\x01vorb") {
    return parseIdHeader(segment, tags);
  } else if (type === "OpusT") {
    return parseVorbisComment(segment, tags, 8);
  } else if (type === "\x03vorb") {
    return parseVorbisComment(segment, tags, 7);
  }

  throw new Error("Unknown type");
} // https://en.wikipedia.org/wiki/Ogg#Page_structure


function parsePages(buffer) {
  let tags = {};
  let offset = 0;
  let headersToFind = 2;
  let segment = new Uint8Array();

  while (offset < buffer.byteLength) {
    // Jump to header type
    offset += 5;
    const [headerType] = getBytes(buffer, offset, 1);
    offset += 1; // 4 = end of stream

    if (headerType === 4) {
      const samples = unpackBytes(getBytes(buffer, offset, 4), {
        endian: "little"
      });
      tags.duration = Math.floor(samples / tags.sampleRate);
      return tags;
    } // Jump to segment count


    offset += 20;
    const [segmentCount] = getBytes(buffer, offset, 1);
    offset += 1;
    const segmentTable = getBytes(buffer, offset, segmentCount);
    let segmentLength = 0;
    offset += segmentCount;

    for (let i = 0; i < segmentCount; i++) {
      segmentLength += segmentTable[i];
    }

    if (headersToFind) {
      const finalSegment = segmentTable[segmentTable.length - 1];
      segment = mergeTypedArrays(segment, getBytes(buffer, offset, segmentLength));

      if (segmentLength % 255 !== 0 || !finalSegment) {
        headersToFind -= 1;
        tags = parseSegment(segment, tags);
        segment = new Uint8Array();
      }
    }

    offset += segmentLength;
  }
}

function getAtomSize(buffer, offset) {
  return unpackBytes(getBytes(buffer, offset, 4), {
    endian: "big",
    byteCount: 4
  });
} // https://developer.apple.com/library/archive/documentation/QuickTime/QTFF/QTFFChap2/qtff2.html#//apple_ref/doc/uid/TP40000939-CH204-56313


function parseMovieHeaderAtom(buffer, offset) {
  const version = new DataView(buffer, offset, 1).getUint8(0);
  let timeUnitPerSecond = 0;
  let durationInTimeUnits = 0; // Jump over version and skip flags

  offset += 4;

  if (version === 0) {
    // Skip creation and modification dates
    offset += 8;
    timeUnitPerSecond = getAtomSize(buffer, offset);
    offset += 4;
    durationInTimeUnits = getAtomSize(buffer, offset);
  } else {
    // Skip creation and modification dates
    offset += 16;
    timeUnitPerSecond = getAtomSize(buffer, offset);
    offset += 4;
    durationInTimeUnits = getAtomSize(buffer, offset + 4);
  }

  return Math.floor(durationInTimeUnits / timeUnitPerSecond);
}

function getMIMEType(bytes) {
  if (bytes[0] === 255 && bytes[1] === 216) {
    return "image/jpg";
  } else if (decode(bytes.slice(0, 4)) === "\x89PNG") {
    return "image/png";
  }

  return "";
}

function parseMetadataItemListAtom(buffer, offset, atomSize, tags) {
  const atomTypeToField = {
    "\xA9ART": "artist",
    "\xA9nam": "title",
    "\xA9alb": "album",
    "\xA9cmt": "comment",
    "\xA9day": "year",
    "\xA9too": "encoding",
    covr: "picture"
  };

  while (atomSize) {
    const size = getAtomSize(buffer, offset);
    const type = decode(getBytes(buffer, offset + 4, 4), "iso-8859-1");
    const field = atomTypeToField[type]; // Jump size length, atom type and skip flags and reserved bytes

    const headerSize = 24;

    if (field && size > headerSize) {
      const dataSize = size - headerSize;
      const dataBytes = getBytes(buffer, offset + headerSize, dataSize);

      if (field === "picture") {
        tags[field] = new Blob([dataBytes], {
          type: getMIMEType(dataBytes)
        });
      } else {
        tags[field] = decode(dataBytes, "utf-8");
      }
    }

    offset += size;
    atomSize -= size;
  }

  return tags;
} // http://xhelmboyx.tripod.com/formats/mp4-layout.txt
// https://developer.apple.com/library/archive/documentation/QuickTime/QTFF/Metadata/Metadata.html


function traverseAtoms(buffer) {
  const atoms = ["moov", "mvhd", "udta", "meta", "ilst"];
  let tags = {};
  let offset = 0;

  while (atoms.length && offset < buffer.byteLength) {
    const size = getAtomSize(buffer, offset);
    const type = decode(getBytes(buffer, offset + 4, 4)); // If atom is found move inside it

    if (atoms[0] === type) {
      offset += 8;
      atoms.shift();

      if (type === "mvhd") {
        tags.duration = parseMovieHeaderAtom(buffer, offset);
        offset += size - 8;
      } else if (type === "ilst") {
        tags = parseMetadataItemListAtom(buffer, offset, size - 8, tags);
      } else if (type === "meta") {
        // Meta atom has extra 4 byte header
        offset += 4;
      }
    } else {
      offset += size;
    }
  }

  return tags;
}

function getID3TagSize(buffer) {
  const bytes = getBytes(buffer, 6, 4);
  return bytes[0] * 2097152 + bytes[1] * 16384 + bytes[2] * 128 + bytes[3];
}

async function parseFile(file, buffer) {
  const bytes = getBytes(buffer, 0, 8);
  const string = decode(bytes);

  if (string.startsWith("ID3")) {
    if (bytes[3] < 3) {
      throw new Error("Unsupported ID3 tag version");
    } // +10 to skip tag header


    const size = getID3TagSize(buffer) + 10;
    buffer = await increaseBuffer(file, buffer.byteLength + size + 1024);
    const string = decode(getBytes(buffer, size, 4));

    if (string === "fLaC") {
      return parseBlocks(file, buffer, size + 4);
    }

    return parseID3Tag(file, buffer, bytes[3]);
  } else if (string.startsWith("fLaC")) {
    return parseBlocks(file, buffer);
  } else if (string.startsWith("OggS")) {
    buffer = await increaseBuffer(file);
    return parsePages(buffer);
  } else if (string.endsWith("ftyp")) {
    buffer = await increaseBuffer(file);
    return traverseAtoms(buffer);
  }

  throw new Error("Invalid or unsupported file");
}

function parseAudioMetadata(file) {
  return new Promise(resolve => {
    const fileReader = new FileReader();
    const size = Math.min(24 * 1024, file.size);

    fileReader.onloadend = function ({
      target
    }) {
      resolve(parseFile(file, target.result));
    };

    fileReader.readAsArrayBuffer(file.slice(0, size));
  });
}

export default parseAudioMetadata;
