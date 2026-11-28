# LMBP SDK source

The `lmbp/` directory contains the runtime sources, protocol schemas and QR code generator from Avora's `sdk/node` at commit `1df2ef3940e34e202ef19b075b73e91698b1aa60`.

Sophron compiles these files into the Electron main process. When refreshing the source, keep the static imports of the QR code generator in `src/index.ts` and the six JSON schemas in `src/engine/params.js` so Vite includes the assets in the build. The gateway uses Sophron's existing `ws` and `better-sqlite3` dependencies.
