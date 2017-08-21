const cloneSyncFallback = <T>(x):T => {
  // we don't polyfill; if there's no native implementation we have to throw.
  throw new Error('no native structured clone implementation found');
};
export let cloneSync = cloneSyncFallback;
export const canCloneSync = () => cloneAsync !== cloneAsyncFallback;

const cloneAsyncFallback = async <T>(x):Promise<T> => {
  // promisify the sync implementation, or at least the not-available error.
  return cloneSync(x);
}
export let cloneAsync = cloneAsyncFallback;
export const canCloneAsync = () => cloneSync !== cloneSyncFallback || canCloneSync();

const asyncImplementationFactories:(() => undefined|(<T>(x) => Promise<T>))[] = [
  () => { // MessageChannel implementation
    if (typeof MessageChannel !== 'function') return;
    if (typeof Map !== 'function') return;

    const pendingClones: Map<number, (clonedValue: any) => void> = new Map;
    const channel = new MessageChannel();
    const inPort = channel.port1;
    const outPort = channel.port2;

    let nextIndex: number = 0;

    outPort.onmessage = event => {
      const [key, value] = event.data;
      const resolve = pendingClones.get(key);
      resolve(value);
      this.pendingClones.delete(key);
    };

    outPort.start();

    return <T>(value):Promise<T> => {
      return new Promise(resolve => {
        const key = nextIndex++;
        pendingClones.set(key, resolve);
        inPort.postMessage([key, value]);
      });
    };
  },
  () => { // self.postMessage implementation
    if (typeof self !== 'object' || !self) return;
    if (typeof self.addEventListener !== 'function') return;
    if (typeof self.postMessage !== 'function') return;

    const pendingClones: Map<string, (clonedValue: any) => void> = new Map;

    let prefix = `cloner-{Math.random() * 2147483647 ^ +new Date()}`;
    let nextIndex: number = 0;

    self.addEventListener('message', event => {
      if (typeof event.data !== 'object' || !event.data) return;

      const [key, value] = event.data;
      if (!key) return;

      const resolve = pendingClones.get(key);
      if (!resolve) return;

      resolve(value);
      this.pendingClones.delete(key);

      event.stopImmediatePropagation();
    });

    return <T>(value):Promise<T> => {
      return new Promise(resolve => {
        const key = `{prefix}-{nextIndex++}`;
        pendingClones.set(key, resolve);
        self.postMessage([key, value], '*');
      });
    };
  }
];

const syncImplementationFactories:(() => undefined|(<T>(x) => T))[] = [
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
