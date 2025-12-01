# VocaFuse Voice Recording SDK

Add cross-browser voice recording to your app in 5 minutes. Handles recording, transcription, and storage.

> **Note:** Requires a backend to generate auth tokens. [Backend setup →](https://vocafuse.com/docs/server-sdks/) | [Full tutorial →](https://vocafuse.com/docs/quickstart/)

## Install

```bash
npm install vocafuse
```

> **Tip:** Works best with modern bundlers like Vite, Next.js, or Create React App.

## Quick Start

```tsx
import { useEffect, useState } from 'react'
import { VocaFuseSDK } from 'vocafuse'

export default function VoiceRecorder() {
  const [recorder, setRecorder] = useState(null)

  useEffect(() => {
    const sdk = new VocaFuseSDK({ 
      tokenEndpoint: '/api/token' // your backend returns VocaFuse tokens
    })
    
    sdk.init().then(() => {
      setRecorder(sdk.createRecorder({
        maxDuration: 60,
        onComplete: (result) => console.log('Uploaded:', result.voicenote_id),
        onError: (err) => console.error(err),
        onStateChange: () => setRecorder(r => ({ ...r })) // trigger re-render
      }))
    })
  }, [])

  if (!recorder) return <button disabled>Loading…</button>

  return (
    <button onClick={() => recorder.isRecording ? recorder.stop() : recorder.start()}>
      {recorder.isRecording ? '⏹ Stop' : '🎤 Record'}
    </button>
  )
}
```

**That's it!** The SDK handles microphone access, recording, and upload automatically.

## API Reference

### SDK Setup
```javascript
const sdk = new VocaFuseSDK({
  tokenEndpoint: '/api/token',  // required - your backend endpoint
  apiBaseUrl: 'https://api.vocafuse.com'  // optional
})

await sdk.init()  // fetches initial token
```

### Create Recorder
```javascript
const recorder = sdk.createRecorder({
  maxDuration: 60,        // seconds (default: 60)
  autoUpload: true,       // upload on stop (default: true)
  
  // Callbacks
  onStateChange: (state) => {},      // 'idle' | 'recording' | 'uploading' | 'uploaded'
  onRecordProgress: (seconds) => {}, // fired every 100ms while recording
  onUploadProgress: (percent) => {}, // 0-100
  onComplete: (result) => {},        // { voicenote_id, url, ... }
  onError: (error) => {},
  onCancel: () => {}
})
```

### Recorder Methods
```javascript
await recorder.start()   // start recording (requests mic permission)
await recorder.stop()    // stop and auto-upload
await recorder.cancel()  // stop without uploading
recorder.pause()         // pause recording
recorder.resume()        // resume recording
recorder.destroy()       // cleanup
```

### Recorder Properties
```javascript
recorder.state        // current state
recorder.duration     // current duration in seconds
recorder.isRecording  // boolean
recorder.isUploading  // boolean
```

## Common Issues

**Microphone not working?**
- Requires HTTPS (or localhost for development)
- User must grant microphone permission
- Check: `sdk.isVoicenoteSupported()` returns `true`

**Upload failing?**
- Verify your `/api/token` endpoint returns valid VocaFuse tokens
- Check browser console for errors
- Use `onError` callback to handle errors

**Need help?**
- [GitHub Issues](https://github.com/VocaFuse/Speech-SDK-Web/issues)
- [Documentation](https://vocafuse.com/docs)

## Notes

- TypeScript types included
- Works with React, Vue, Next.js, Vite, etc.
- Supports Chrome, Firefox, Safari, Edge (modern versions)
