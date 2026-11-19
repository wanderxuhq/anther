'use strict';

// Re-export the official node-pty. This package exists only so anther can pull
// node-pty in through an optional dependency that is restricted to Windows:
// `os` / `cpu` filters can only live on the package itself, not on a dependency
// entry in the consumer's package.json.
module.exports = require('node-pty');
