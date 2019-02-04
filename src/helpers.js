function getBytes(buffer, offset, count) {
  return new Uint8Array(buffer, offset, count);
}

function sliceBytes(bytes, offset, count) {
  return bytes.slice(offset, offset + count);
}

function unpackBytes(bytes, options = {}) {
  if (options.endian === "little") {
    return bytes[0] | bytes[1] << 8 | bytes[2] << 16 | bytes[3] << 24;
  }
  else if (options.shiftBase === 7) {
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

    fileReader.onloadend = function({ target }) {
      resolve(target.result);
    };
    fileReader.readAsArrayBuffer(slicedFile);
  });
}

export {
  getBytes,
  sliceBytes,
  unpackBytes,
  decode,
  increaseBuffer
};
