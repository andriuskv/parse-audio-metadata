# parse-audio-metadata

Audio file metadata parser for a browser.

### Supported audio file types
mp3 with ID3v2.3 and ID3v2.4 headers, flac, opus, ogg and m4a.

### Installation

```
npm install parse-audio-metadata
```

### Usage
```javascript
import parseAudioMetadata from "parse-audio-metadata";

const metadata = await parseAudioMetadata(file);
```

or

```javascript
const { default: parseAudioMetadata } = await import("parse-audio-metadata");

const metadata = await parseAudioMetadata(file);
```
