class StructuredCloner {
  // false positives okay as long as clone will then throw errors instead of returning bad results.
  static mayBeSupported() {
    return true;
  }

  // whether this can be used sync, or just async.
  static isSync() {
    return this.prototype.cloneSync !== StructuredCloner.prototype.cloneSync;
  }

  // a string warning of any side effects if this method is used.
  static warning?: string = undefined;

  // the cloner instance will be disabled if it not supported or has thrown an error.
  disabled: boolean = false;

  cloneSync<T>(value: T): T {
    throw new Error("not supported");
  }

  async cloneAsync<T>(value: T):Promise<T> {
    return this.cloneSync(value);
  }
}

interface StructuredClonerFactory {
  mayBeSupported(): boolean;
  isSync(): boolean;
  warning?: string;
  new(): StructuredCloner;
}
// We'll create an array of all our cloner factories in priority order.
const clonerFactories:StructuredClonerFactory[] = [];
const registerCloner = <T extends StructuredClonerFactory>(constructor: T): T => {
  clonerFactories.push(constructor);
  return constructor;
}

@registerCloner
class NodeV8SerializeSyncCloner extends StructuredCloner {
  static warning = "This cloner depends on a Node API that is not yet stable.";

  static mayBeSupported() {
    return (typeof require === 'function') && (typeof module === 'object') && (module !== null);
  }

  private v8: any = undefined;

  constructor() {
    super();

    this.v8 = require('v8');
  }

  cloneSync<T>(value: T): T {
    return this.v8.deserialize(this.v8.serialize(value));
  }
}

@registerCloner
class MessageChannelAsyncCloner extends StructuredCloner {
  static mayBeSupported() {
    return (typeof MessageChannel === 'function') && (typeof Map === 'function');
  }

  private pendingClones: Map<number, (clonedValue: any) => void>;
  private nextIndex: number;
  private inPort: MessagePort;
  private outPort: MessagePort;

  constructor() {
    super();
    this.pendingClones = new Map;
    this.nextIndex = 0;
    const channel = new MessageChannel();
    this.inPort = channel.port1;
    this.outPort = channel.port2;

    this.outPort.onmessage = event => {
      const [key, value] = event.data;
      const resolve = this.pendingClones.get(key) as (clonedValue: any) => void;
      resolve(value);
      this.pendingClones.delete(key);
    };

    this.outPort.start();
  }

  cloneAsync<T>(value: T):Promise<T> {
    return new Promise<T>(resolve => {
      const key = this.nextIndex++;
      this.pendingClones.set(key, resolve);
      this.inPort.postMessage([key, value]);
    });
  }
}

@registerCloner
class IndexedDBAsyncCloner extends StructuredCloner {
  static warning = "A new IndexedDB database will be created for this cloner, but no data will ever be saved to it.";

  static mayBeSupported() {
    return (typeof indexedDB === 'object') && (indexedDB !== null);
  }

  private dbReady:Promise<IDBDatabase>;

  constructor() {
    super();
    this.dbReady = new Promise((resolve, reject) => {
      const dbName = '/tmp/github.com/jeremybanks/native-clone';
      const request = indexedDB.open(dbName, 1);
      
      request.onerror = event => reject(request.error);

      request.onupgradeneeded = event => {
        const db = request.result as IDBDatabase;

        for (const name of Array.from(db.objectStoreNames)) {
          db.deleteObjectStore(name);
        }

        const store = db.createObjectStore('cloning');
      }

      request.onsuccess = event => {
        const db = request.result as IDBDatabase;

        resolve(db);
      }
    });
  }

  async cloneAsync<T>(value: T):Promise<T> {
    const db = await this.dbReady;
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(['cloning'], 'readwrite');
      const objectStore = transaction.objectStore('cloning');

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
  }
}

@registerCloner
class PostMessageAsyncCloner extends StructuredCloner {
  static warning = "This cloner will dispatch message events on window that may interfere with other code.";

  static mayBeSupported() {
    return (typeof self === 'object') && (self !== null) && (typeof self.addEventListener === 'function') && (typeof self.postMessage === 'function');
  }

  constructor() {
    super();

  }



    (/*
      self.postMessage implementation

      Side effect: dispatches message events on window, and other code may react unexpectedly.
    */) => {
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

    cloneAsync<T>(value: T):Promise<T> => {
        return new Promise(resolve => {
          const key = `${nonce}-${nextIndex++}`;
          pendingClones.set(key, resolve);
          self.postMessage([key, value], '*');
        });
      };
    }
];

const syncImplementationFactories:(() => undefined|(<T>(x: T) => T))[] = [
    (/*
      Node v8.serialize() implementation

      Side effect: none, but depends on an unstable Node API.
    */) => {
    },

    (/*
      Notifiction implementation

      Side effect: will briefly display a notification if we get permission after initialization.
    */) => {
      if (typeof Notification !== 'function') return;

      // don't do this if it will display notifications
      if ((Notification as any).permission === 'granted') return;

      return <T>(value: T): T => {
        var notifiction = new Notification('', {data: value, silent: true} as any);

        // if we have been granted the permission, at least try to close them.
        notifiction.onshow = notifiction.close.bind(notifiction);

        return (notifiction as any).data;
      };
    }
];
