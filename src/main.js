import { getBytes, decode, increaseBuffer } from "./helpers.js";
import parseMp3File from "./parseMp3File.js";
import parseFlacFile from "./parseFlacFile.js";
import parseOggOpusFile from "./parseOggOpusFile.js";
import parseM4aFile from "./parseM4aFile.js";

async function parseFile(file, buffer) {
  const bytes = getBytes(buffer, 0, 8);
  const string = decode(bytes);

  if (string.startsWith("ID3")) {
    if (bytes[3] < 3) {
      throw new Error("Unsupported version");
    }
    return parseMp3File(file, buffer, bytes[3]);
  }
  else if (string.startsWith("fLaC")) {
    return parseFlacFile(file, buffer);
  }
  else if (string.startsWith("OggS")) {
    buffer = await increaseBuffer(file);
    return parseOggOpusFile(buffer);
  }
  else if (string.endsWith("ftyp")) {
    buffer = await increaseBuffer(file);
    return parseM4aFile(buffer);
  }
  throw new Error("Unsupported file");
}

function parseAudioMetadata(file) {
  return new Promise(resolve => {
    const fileReader = new FileReader();
    const size = Math.min(24 * 1024, file.size);

    fileReader.onloadend = function({ target }) {
      resolve(parseFile(file, target.result));
    };
    fileReader.readAsArrayBuffer(file.slice(0, size));
  });
}

export default parseAudioMetadata;
