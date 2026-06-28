#!/usr/bin/env node

import { migrateRuntimeTasks } from '../packages/adapters/storage/runtime-task/runtime-task-migration.ts';

const argumentsByName = parseArguments(process.argv.slice(2));
const from = requireArgument(argumentsByName, 'from');
const to = requireArgument(argumentsByName, 'to');
const result = await migrateRuntimeTasks({
  from,
  to,
  apply: argumentsByName.has('apply'),
  replace: argumentsByName.has('replace')
});

console.log(JSON.stringify(result, null, 2));

function parseArguments(arguments_: readonly string[]): ReadonlyMap<string, string | true> {
  const parsed = new Map<string, string | true>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--apply' || argument === '--replace') {
      parsed.set(argument.slice(2), true);
      continue;
    }
    if (argument === '--from' || argument === '--to') {
      const value = arguments_[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${argument} requires a path.`);
      }
      parsed.set(argument.slice(2), value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? ''}`);
  }
  return parsed;
}

function requireArgument(argumentsByName: ReadonlyMap<string, string | true>, name: string): string {
  const value = argumentsByName.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}
