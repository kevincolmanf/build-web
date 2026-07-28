// audioFile: un File/Blob con el audio (webm/mp4/mp3). Devuelve texto.
export async function transcribeAudio(audioFile, { client }) {
  const res = await client.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-1',
    language: 'es',
  });
  return (res.text || '').trim();
}
