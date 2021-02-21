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

const bestDefaultValues = [];

zzfxDefaultsKeys.forEach((key, keyIndex) => {
  const foundValues = new Map();
  let maxTotal = -1;
  let maxTotalValue = null;

  for (let c = 0; c < inputKeys.length; c++) {
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

  bestDefaultValues.push({
    key,
    total: maxTotal,
    value: maxTotalValue,
  });
});

bestDefaultValues.sort((a, b) => a.total - b.total);

const bestDefaultValuesMap = new Map(
  bestDefaultValues.map((bestDefaultValue) => [
    bestDefaultValue.key,
    bestDefaultValue,
  ])
);

// Compute constants, parameters and exports

// Constants
// ---------
// These are the defaults that apply for all entries; putting it as a constant
// may hopefully inline it
// We know the it applies to all entries if the total is the same as the number
// of entries
const constants = bestDefaultValues
  .filter((value) => value.total === inputKeys.length)
  .map(
    (constantValue) => `const ${constantValue.key} = ${constantValue.value};`
  )
  .join("\n");

// Parameters
// ----------
// The parameter handler of the zzfx function; we will smartly not define a
// default if we know that all sounds define that value, which have a total
// equal to 1. We also filter the ones we processed as constants in the
// previous step

const parameters = bestDefaultValues
  .filter((value) => value.total !== inputKeys.length)
  .map(
    (paramValue) =>
      `${paramValue.key}${
        paramValue.total === 1 ? "" : " = " + paramValue.value
      }`
  )
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

    const parameters = bestDefaultValues
      .filter((value) => value.total !== inputKeys.length)
      .map((paramValue) => {
        const inputParameter = inputParameterMap.get(paramValue.key);
        return paramValue.total > 1 && inputParameter === paramValue.value
          ? ""
          : inputParameter;
      });
    while (parameters.length > 0 && parameters[parameters.length - 1] === "") {
      parameters.pop();
    }

    return `export function ${key}(${inputArguments.join(", ")}) {
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
