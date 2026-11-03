export {protectedMediaProcess,opusAudio} from '@dot-bridge/core/audio/media-process.js';
import {readableDocument} from '@dot-bridge/core/channels/document-process.js';
export function readableFile(bytes,mime){return readableDocument(bytes,{mimeType:mime,maxCharacters:30000});}
