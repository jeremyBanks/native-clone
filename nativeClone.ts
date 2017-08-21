const cloneSyncFallback = <T>(x:T):T => {
  // we don't polyfill; if there's no native implementation we have to throw.
  throw new Error('no native structured clone implementation found');
};
export let cloneSync = cloneSyncFallback;
export const canCloneSync = () => cloneAsync !== cloneAsyncFallback;

const cloneAsyncFallback = async <T>(x:T):Promise<T> => {
  // promisify the sync implementation, or at least the not-available error.
  return cloneSync(x);
}
export let cloneAsync = cloneAsyncFallback;
export const canCloneAsync = () => cloneSync !== cloneSyncFallback || canCloneSync();

const asyncImplementationFactories:(() => undefined|(<T>(x:T) => Promise<T>))[] = [
  (/*
    MessageChannel implementation

    No side-effects.
  */) => {
    if (typeof MessageChannel !== 'function') return;
    if (typeof Map !== 'function') return;

    const pendingClones: Map<number, (clonedValue: any) => void> = new Map;
    const channel = new MessageChannel();
    const inPort = channel.port1;
    const outPort = channel.port2;

    let nextIndex: number = 0;

    outPort.onmessage = event => {
      const [key, value] = event.data;
      const resolve = pendingClones.get(key) as (clonedValue: any) => void;
      resolve(value);
      pendingClones.delete(key);
    };

    outPort.start();

    return <T>(value:T):Promise<T> => {
      return new Promise(resolve => {
        const key = nextIndex++;
        pendingClones.set(key, resolve);
        inPort.postMessage([key, value]);
      });
    };
  },

  (/*
    IndexedDB implementation

    Side effect: creates an empty IndexedDB, but nothing should care.
  */) => {
    if (typeof indexedDB !== 'object' || !indexedDB) return;

    const loadDb:Promise<IDBDatabase> = new Promise((resolve, reject) => {
      const dbName = '/tmp/github.com/jeremybanks/native-clone';
      const request = indexedDB.open(dbName, 1);
      
      request.onerror = event => reject(request.error);

      request.onupgradeneeded = event => {
        const db = request.result as IDBDatabase;

        for (const name of Array.from(db.objectStoreNames)) {
          db.deleteObjectStore(name);
        }

        const store = db.createObjectStore('pending');
      }

      request.onsuccess = event => {
        const db = request.result as IDBDatabase;

        resolve(db);
      }
    });
    
    const cloneAsync = <T>(value:T):Promise<T> => loadDb.then<T>(db => {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(['pending'], 'readwrite');
        const objectStore = transaction.objectStore('pending');

        const addRequest = objectStore.add(value, 1);
        addRequest.onsuccess = event => {
          const getRequest = objectStore.get(1);
          getRequest.onsuccess = event => {
            resolve(getRequest.result);

            // now that we have the cloned value, abort the transaction so we don't touch the database.
            transaction.abort();
          };
          getRequest.onerror = event => reject(getRequest.error);
        }
        addRequest.onerror = event => reject(addRequest.error);
      });
    });

    var o = {a: [1, 2, null]}
    cloneAsync(o).then(c => console.log(o, c, o !== c ? "good" : "bad"));

    return cloneAsync;
  },

  (/*
    self.postMessage implementation

    Side effect: dispatches message events on window, and other code may react unexpectedly.
  */) => {
    if (typeof self !== 'object' || !self) return;
    if (typeof self.addEventListener !== 'function') return;
    if (typeof self.postMessage !== 'function') return;

    const pendingClones: Map<string, (clonedValue: any) => void> = new Map;

    let nonce = `native-clone-${Math.random() * 2147483647 ^ +new Date()}`;
    let nextIndex: number = 0;

    self.addEventListener('message', event => {
      if (typeof event.data !== 'object' || !event.data) return;

      const [key, value] = event.data;
      if (!key) return;

      const resolve = pendingClones.get(key);
      if (!resolve) return;

      resolve(value);
      pendingClones.delete(key);

      event.stopImmediatePropagation();
    });

    return <T>(value:T):Promise<T> => {
      return new Promise(resolve => {
        const key = `${nonce}-${nextIndex++}`;
        pendingClones.set(key, resolve);
        self.postMessage([key, value], '*');
      });
    };
  }
];

const syncImplementationFactories:(() => undefined|(<T>(x:T) => T))[] = [
    // there are no implementations
];

for (const asyncFactory of asyncImplementationFactories) {
  const asyncImpl = asyncFactory();
  if (asyncImpl) {
      cloneAsync = asyncImpl;
      break;
  }
}

for (const syncFactory of syncImplementationFactories) {
  const syncImpl = syncFactory();
  if (syncImpl) {
      cloneSync = syncImpl;
      break;
  }
}
