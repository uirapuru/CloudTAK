#!/usr/bin/env node
// Checks that every literal t('key') used in src/ exists in every locale
// and that all locales share the same key set.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const root = new URL('../src/', import.meta.url).pathname;
const localesDir = join(root, 'locales');

function flatten(obj, prefix = '', out = new Set()) {
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object') flatten(v, key, out);
        else out.add(key);
    }
    return out;
}

const locales = {};
for (const locale of readdirSync(localesDir)) {
    const dir = join(localesDir, locale);
    if (!statSync(dir).isDirectory()) continue;
    const keys = new Set();
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
        const area = basename(file, '.json');
        flatten(JSON.parse(readFileSync(join(dir, file), 'utf8')), area, keys);
    }
    locales[locale] = keys;
}

function walk(dir, files = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === 'locales' || name === 'node_modules') continue;
        if (statSync(p).isDirectory()) walk(p, files);
        else if (/\.(vue|ts)$/.test(name) && !/\.spec\.ts$/.test(name)) files.push(p);
    }
    return files;
}

const used = new Map();
const re = /\b(?:\$?t|te)\(\s*['"`]([a-zA-Z0-9_.]+)['"`]/g;
for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) {
        if (!m[1].includes('.')) continue;
        if (!used.has(m[1])) used.set(m[1], file.replace(root, ''));
    }
}

let errors = 0;
const names = Object.keys(locales);
for (const [key, file] of used) {
    for (const l of names) {
        if (!locales[l].has(key)) { console.log(`missing ${l}: ${key} (${file})`); errors++; }
    }
}
const [first, ...rest] = names;
for (const l of rest) {
    for (const k of locales[first]) if (!locales[l].has(k)) { console.log(`only in ${first}: ${k}`); errors++; }
    for (const k of locales[l]) if (!locales[first].has(k)) { console.log(`only in ${l}: ${k}`); errors++; }
}
console.log(`${used.size} keys used, ${names.map((l) => `${l}=${locales[l].size}`).join(' ')}, ${errors} problems`);
process.exit(errors ? 1 : 0);
