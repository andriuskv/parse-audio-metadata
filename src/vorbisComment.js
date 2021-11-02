import { sliceBytes, decode, unpackBytes } from "./helpers.js";

function convertBase64ToUint8(data) {
  const raw = atob(data);
  const array = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i++) {
    array[i] = raw.charCodeAt(i);
  }
  return array;
}

function unpackPicutreBlockBytes(bytes, offset) {
  return unpackBytes(sliceBytes(bytes, offset, 4), { endian: "big" });
}

// https://xiph.org/flac/format.html#metadata_block_picture
function parsePictureBlock(bytes, tags) {

  // Start from 4th byte to skip picture type
  let offset = 4;

  const MIMETypeLength = unpackPicutreBlockBytes(bytes, offset);
  offset += 4;

  const MIMEType = decode(sliceBytes(bytes, offset, MIMETypeLength));
  offset += MIMETypeLength;

  const descriptionLength = unpackPicutreBlockBytes(bytes, offset);
  offset += 4;

  // Skip description
  offset += descriptionLength;

  // Skip picture width, height, color depth, number of colors used
  offset += 16;

  const pictureLength = unpackPicutreBlockBytes(bytes, offset);
  offset += 4;

  tags.picture = new Blob([sliceBytes(bytes, offset, pictureLength)], { type: MIMEType });
  return tags;
}

function unpackVorbisCommentBytes(bytes, offset) {
  return unpackBytes(sliceBytes(bytes, offset, 4), { endian: "little" });
}

// https://xiph.org/flac/format.html#metadata_block_vorbis_comment
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
    }
    else {
      tags[name.toLowerCase()] = value;
    }
    offset += userCommentLength;
    userCommentCount -= 1;
  }
  return tags;
}

export {
  parseVorbisComment,
  parsePictureBlock
};
