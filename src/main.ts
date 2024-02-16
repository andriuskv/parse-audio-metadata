import { getBytes, decode, getBuffer } from "./helpers.ts";
import parseMp3File from "./parseMp3File.ts";
import parseFlacFile from "./parseFlacFile.ts";
import parseOggOpusFile from "./parseOggOpusFile.ts";
import parseM4aFile from "./parseM4aFile.ts";
import parseWavFile from "./parseWavFile.ts";

const isNode = typeof window === "undefined" && typeof global !== "undefined";

// http://id3lib.sourceforge.net/id3/id3v2com-00.html
function getID3TagSize(buffer: ArrayBuffer) {
  const bytes = getBytes(buffer, 6, 4);
  return bytes[0] * 2097152 + bytes[1] * 16384 + bytes[2] * 128 + bytes[3];
}

// If file is not provided assume that the buffer consists of the whole file.
async function parseFile(buffer: ArrayBuffer, file?: File | Blob) {
  const bytes = getBytes(buffer, 0, 8);
  const string = decode(bytes);

  if (string.startsWith("ID3")) {
    if (bytes[3] < 3) {
      throw new Error("Unsupported ID3 tag version.");
    }
    // +10 to skip tag header
    const size = getID3TagSize(buffer) + 10;

    if (file) {
      buffer = await getBuffer(file, buffer.byteLength + size + 1024);
    }
    const string = decode(getBytes(buffer, size, 4));

    // Edge case when there is ID3 tag embedded in .flac file.
    // Instead of parsing ID3 tag - ignore it and treat it as normal .flac file.
    if (string === "fLaC") {
      return parseFlacFile(buffer, file, size + 4);
    }
    return parseMp3File(buffer, bytes[3], file);
  }
  else if (string.startsWith("fLaC")) {
    return parseFlacFile(buffer, file);
  }
  else if (string.startsWith("OggS")) {
    if (file) {
      buffer = await getBuffer(file);
    }
    return parseOggOpusFile(buffer);
  }
  else if (string.endsWith("ftyp")) {
    if (file) {
      buffer = await getBuffer(file);
    }
    return parseM4aFile(buffer);
  }
  else if (string.startsWith("RIFF")) {
    return parseWavFile(buffer);
  }
  throw new Error("Invalid or unsupported file.");
}

async function parseAudioMetadata(input: File | ArrayBuffer | string) {
  if (input instanceof ArrayBuffer) {
    return parseFile(input);
  }
  let blob: File | Blob = input as File;

  if (isNode && typeof input === "string") {
    try {
      const { openAsBlob } = await import("node:fs");
      blob = await openAsBlob(input);
    } catch (e) {
      throw new Error("Unable to open file path.");
    }
  }
  const buffer = await getBuffer(blob, 24 * 1024);

  return parseFile(buffer, blob);
}

export default parseAudioMetadata;
