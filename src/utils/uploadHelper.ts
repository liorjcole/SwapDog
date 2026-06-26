import * as FileSystem from 'expo-file-system/legacy';
import { getAuth } from 'firebase/auth';

/**
 * Upload a local image URI to Firebase Storage via REST API + expo-file-system.
 *
 * Bypasses the Firebase JS SDK entirely — avoids the "Creating blobs from
 * ArrayBuffer and ArrayBufferView are not supported" error that breaks all
 * SDK upload paths in React Native.
 *
 * Full null-guard chain:
 *   uploadAsync result → uploadResult.body → JSON.parse → downloadTokens
 */
export async function uploadPhotoToStorage(
  localUri: string,
  storagePath: string,
): Promise<string> {
  const auth = getAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');

  const token = await user.getIdToken();
  const bucket = 'swapdog-d0cfe.firebasestorage.app';
  const encodedPath = encodeURIComponent(storagePath);
  const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?name=${encodedPath}`;

  console.log('[uploadHelper] Uploading to:', uploadUrl);

  const uploadResult = await FileSystem.uploadAsync(uploadUrl, localUri, {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'image/jpeg',
    },
  });

  if (!uploadResult || !uploadResult.body) {
    throw new Error('Upload failed: no response from server');
  }

  if (uploadResult.status !== 200) {
    throw new Error(`Upload failed (${uploadResult.status}): ${uploadResult.body}`);
  }

  const data = JSON.parse(uploadResult.body) as { downloadTokens?: string };
  const downloadToken = data?.downloadTokens;
  if (!downloadToken) {
    throw new Error('Upload succeeded but no download token returned');
  }

  const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${downloadToken}`;
  console.log('[uploadHelper] Download URL:', downloadURL);
  return downloadURL;
}

/**
 * Defense-in-depth guard: never let a local (file://) URI get persisted.
 *
 * If `uri` is already a remote http(s) URL it is returned unchanged. Otherwise
 * it is treated as a local picker URI and uploaded to Storage first, returning
 * the resulting https download URL. Empty/falsy input passes through untouched.
 *
 * Use this for every profile-photo save path so a raw file:// URI can never
 * reach Firestore (the original root cause of disappearing profile photos).
 */
export async function ensureRemotePhotoURL(
  uri: string,
  storagePath: string,
): Promise<string> {
  if (!uri || /^https?:\/\//.test(uri)) return uri;
  return uploadPhotoToStorage(uri, storagePath);
}
