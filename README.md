# zzfx-minifier

Very simple node script to shave some bytes from ZzFX sounds. The idea is to determine what defaults are needed and
try to sort the sound definitions to put as many defaults as the final parameters, so they can be skipped.

## Usage

The sound definitions need to be defined inside a JSON; please check `sample/input.json` for an example. The output
will be a JS ES module that exports the sounds as functions.

```
node index.js -i <input> -o <output>
```
