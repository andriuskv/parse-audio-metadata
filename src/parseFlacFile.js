import { getBytes, unpackBytes, increaseBuffer } from "./helpers.js";
import { parseVorbisComment, parsePictureBlock } from "./vorbisComment.js";

// https://xiph.org/flac/format.html#metadata_block_streaminfo
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

async function parseBlocks(file, buffer) {
  let tags = {};
  let offset = 4;
  let isLastBlock = false;

  while (!isLastBlock) {
    const header = getBytes(buffer, offset, 4);
    const length = unpackBytes(header, { endian: "big" });
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
    }
    else if (blockType === 4) {
      const bytes = getBytes(buffer, offset, length);

      tags = parseVorbisComment(bytes, tags);
    }
    else if (blockType === 6) {
      const bytes = getBytes(buffer, offset, length);

      tags = parsePictureBlock(bytes, tags);
    }
    offset += length;
  }
  return tags;
}

export default parseBlocks;
