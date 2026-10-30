const DB_NAME = 'my_whisk_ai_image_db';
const DB_VERSION = 1;
const STORE_NAME = 'reference_images';

export interface StoredImageRecord {
  id: string;
  dataUrl: string;
  mimeType: string;
  createdAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not supported in this browser environment'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const ImageDB = {
  async saveImage(id: string, dataUrl: string, mimeType = 'image/jpeg'): Promise<void> {
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({
          id,
          dataUrl,
          mimeType,
          createdAt: Date.now(),
        } as StoredImageRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (err) {
      console.warn('IndexedDB saveImage fallback warning:', err);
    }
  },

  async getImage(id: string): Promise<string | null> {
    try {
      const db = await openDB();
      const record = await new Promise<StoredImageRecord | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return record ? record.dataUrl : null;
    } catch (err) {
      console.warn('IndexedDB getImage warning:', err);
      return null;
    }
  },

  async deleteImage(id: string): Promise<void> {
    try {
      const db = await openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (err) {
      console.warn('IndexedDB deleteImage warning:', err);
    }
  },
};
