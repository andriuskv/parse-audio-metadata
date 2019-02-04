# parse-audio-metadata

File based audio metadata parser for browser.

### Supported audio file types
mp3 with ID3v2.3 and ID3v2.4 headers, flac, opus, ogg and m4a

### Installation

```
npm install parse-audio-metadata
```

### Usage
```javascript
import parseAudioMetadata from "parse-audio-metadata";

const metadata = await parseAudioMetadata(blob);
```
