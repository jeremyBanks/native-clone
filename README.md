`native-clone` provides `cloneSync()` and `cloneAsync()` methods wrapping
native/built-in implementations of the HTML5 Structured Clone algorithm, as
[described in this Stack Overflow post](https://stackoverflow.com/questions/122102/what-is-the-most-efficient-way-to-deep-clone-an-object-in-javascript/10916838#10916838).

If no suitable built-in implementation is available, an error will be thrown.
