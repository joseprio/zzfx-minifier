#!/usr/bin/env node

import yargs from "yargs";
import { readFileSync, writeFileSync } from "fs";
import ejs from "ejs";

const options = yargs(process.argv.slice(2))
  .usage("Usage: -i <input> -o <output>")
  .option("i", {
    alias: "input",
    describe: "The input JSON file",
    type: "string",
    demandOption: true,
  })
  .option("o", {
    alias: "output",
    describe: "The output JS module",
    type: "string",
    demandOption: false,
  }).argv;

const zzfxDefaults = {
  volume: 1,
  randomness: 0.05,
  frequency: 220,
  attack: 0,
  sustain: 0,
  release: 0.1,
  shape: 0,
  shapeCurve: 1,
  slide: 0,
  deltaSlide: 0,
  pitchJump: 0,
  pitchJumpTime: 0,
  repeatTime: 0,
  noise: 0,
  modulation: 0,
  bitCrush: 0,
  delay: 0,
  sustainVolume: 1,
  decay: 0,
  tremolo: 0,
};
const zzfxDefaultsKeys = Object.keys(zzfxDefaults);
const zzfxKeyToCol = {};
zzfxDefaultsKeys.forEach((key, index) => {
  zzfxKeyToCol[key] = index;
});

const inputData = JSON.parse(readFileSync(options.input));
const inputKeys = Object.keys(inputData);

// Fill input data with defaults
inputKeys.forEach((key) => {
  const data = inputData[key];
  for (let c = 0; c < data.length; c++) {
    if (data[c] == null) {
      data[c] = zzfxDefaults[zzfxDefaultsKeys[c]];
    }
  }
  for (let c = data.length; c < zzfxDefaultsKeys.length; c++) {
    data.push(zzfxDefaults[zzfxDefaultsKeys[c]]);
  }
  if (data.length !== zzfxDefaultsKeys.length) {
    throw new Error(
      `Wrong number of arguments in data: found ${data.length}, expected ${zzfxDefaultsKeys.length}`
    );
  }
});

const bestDefaultValues = {};

zzfxDefaultsKeys.forEach((key, keyIndex) => {
  const foundValues = new Map();
  let maxTotal = -1;
  let maxTotalValue = null;

  let colDefaults = [];
  for (let c = 0; c < inputKeys.length; c++) {
    colDefaults.push(inputData[inputKeys[c]][keyIndex]);
    const value = inputData[inputKeys[c]][keyIndex];
    if (typeof value === "string") {
      // Parametrized call, don't process the default
      continue;
    }
    let currentFoundValue = foundValues.get(value);
    if (currentFoundValue == null) {
      currentFoundValue = {
        value,
        total: 0,
      };
      foundValues.set(value, currentFoundValue);
    }
    currentFoundValue.total++;
    if (currentFoundValue.total > maxTotal) {
      maxTotal = currentFoundValue.total;
      maxTotalValue = value;
    }
  }

  bestDefaultValues[key] = {
    key,
    total: maxTotal,
    value: maxTotalValue,
  };
});

const computeBestColsCache = {};
function computeBestCols(unprocessedInputKeys, unprocessedCols) {
  // We've processed all columns
  if (unprocessedCols.size < 1) {
    return { savings: 0, orderedCols: [] };
  }

  if (unprocessedInputKeys.size < 1) {
    return {
      savings: 0,
      orderedCols: Array.from(unprocessedCols),
    };
  }

  // Check cache
  const cacheKey =
    JSON.stringify(Array.from(unprocessedInputKeys)) +
    JSON.stringify(Array.from(unprocessedCols));
  if (computeBestColsCache[cacheKey]) {
    return computeBestColsCache[cacheKey];
  }

  let bestData = null;
  unprocessedCols.forEach((colKey) => {
    const colDefault = bestDefaultValues[colKey].value;
    const newUnprocessedInputKeysArray = Array.from(
      unprocessedInputKeys
    ).filter(
      (inputKey) => inputData[inputKey][zzfxKeyToCol[colKey]] === colDefault
    );
    const newUnprocessedInputKeysSet = new Set(newUnprocessedInputKeysArray);
    const newUnprocessedCols = new Set(unprocessedCols);
    newUnprocessedCols.delete(colKey);
    const currentColSavings = newUnprocessedInputKeysArray.length;
    const currentData = computeBestCols(
      newUnprocessedInputKeysSet,
      newUnprocessedCols
    );
    const totalSavings = currentColSavings + currentData.savings;
    if (bestData == null || totalSavings > bestData.savings) {
      bestData = {
        savings: totalSavings,
        orderedCols: [...currentData.orderedCols, colKey],
      };
    }
  });
  computeBestColsCache[cacheKey] = bestData;
  return bestData;
}

const solidInitialColumns = Object.keys(zzfxDefaults).filter((col) => {
  if (bestDefaultValues[col].total === 1) {
    return true;
  }
  return false;
});
const targetCols = Object.keys(zzfxDefaults).filter((col) => {
  if (bestDefaultValues[col].total === 1) {
    return false;
  }
  if (bestDefaultValues[col].total === inputKeys.length) {
    return false;
  }
  return true;
});

const bestData = computeBestCols(new Set(inputKeys), new Set(targetCols));
const exportColumnOrder = [...solidInitialColumns, ...bestData.orderedCols];

// Compute constants, parameters and exports

// Constants
// ---------
// These are the defaults that apply for all entries; putting it as a constant
// may hopefully inline it
// We know the it applies to all entries if the total is the same as the number
// of entries
const constants = Object.entries(bestDefaultValues)
  .filter(([key, value]) => value.total === inputKeys.length)
  .map(([key, value]) => `const ${key} = ${value.value};`)
  .join("\n");

// Parameters
// ----------
// The parameter handler of the zzfx function; we will smartly not define a
// default if we know that all sounds define that value, which have a total
// equal to 1. We also filter the ones we processed as constants in the
// previous step

const parameters = exportColumnOrder
  .map((col) => {
    const { total, value } = bestDefaultValues[col];
    return `${col}${total === 1 ? "" : " = " + value}`;
  })
  .join(", ");

// Exports
// ----------
// We will generate an individual export for each defined sound, calling the
// function with the right parameters and omitting the defaults

const exports = inputKeys
  .map((key) => {
    const inputArguments = inputData[key].filter(
      (col) => typeof col === "string"
    );
    const inputParameterMap = new Map(
      inputData[key].map((col, colIndex) => [zzfxDefaultsKeys[colIndex], col])
    );

    const parameters = exportColumnOrder.map((col) => {
      const inputParameter = inputParameterMap.get(col);
      const defaultValue = bestDefaultValues[col];
      return defaultValue.total > 1 && inputParameter === defaultValue.value
        ? ""
        : inputParameter;
    });
    let saved = 0;
    while (parameters.length > 0 && parameters[parameters.length - 1] === "") {
      saved++;
      parameters.pop();
    }

    return `export function ${key}(${inputArguments.join(", ")}) {
  // // Removed ${saved} arguments at the end
  zzfx(
    ...[
        ${parameters.join(", ")}
    ]
  );
}`;
  })
  .join("\n\n");

const template = readFileSync(
  new URL("./template/ZzFXMicro.js.template", import.meta.url)
);
const result = ejs.render(template.toString(), {
  constants,
  parameters,
  exports,
});

if (options.output) {
  writeFileSync(options.output, result);
} else {
  console.log(result);
}
