# parse-audio-metadata
Audio file metadata parser for the browser and Node.js.

### Supported audio file types
mp3 with ID3v2.3 and ID3v2.4 headers, flac, opus, ogg, wav and m4a.

### Installation
```
npm install parse-audio-metadata
```

### Usage
The `input` can be of type File/Blob, ArrayBuffer.

```javascript
import parseAudioMetadata from "parse-audio-metadata";

const metadata = await parseAudioMetadata(input);
```
or
```javascript
const { default: parseAudioMetadata } = await import("parse-audio-metadata");

const metadata = await parseAudioMetadata(input);
```
\
To run in node use code bellow to get the blob.
```javascript
import { openAsBlob } from "node:fs";

const blob = await openAsBlob(filePath);
```
