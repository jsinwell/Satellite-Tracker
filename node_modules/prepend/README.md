# Prepend

Add data to the beginning of file

## Install

```
npm i prepend --save
```

## How to use?

```js
var prepend = require('prepend');

prepend('README.md', 'some data for beginning', function(error) {
    if (error)
        console.error(error.message);
});

```

## License

MIT
