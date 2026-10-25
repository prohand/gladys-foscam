// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { DEFAULT_CONFIG } from '../src/config.js';
import { ACTIONS } from '../src/app.js';
import {
  CONNECTION_STATES,
  DETECTION_KINDS,
  NIGHT_VISION_MODES,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
} from '../src/capabilities/scenes.js';
import { WIDGET_KEYS } from '../src/capabilities/widgets.js';
import { LANGUAGES } from '../src/i18n.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const pkg = JSON.parse(await read('../package.json'));
const appSource = await read('../src/app.js');

const keysOf = (entries) => (entries ?? []).map((entry) => entry.key).sort();

test('the version is the same everywhere, and the image is tagged with it', () => {
  // The Release workflow writes all three: never edited by hand.
  assert.equal(manifest.version, pkg.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-foscam:${pkg.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/prohand\/gladys-foscam\//,
  );
});

test('the name and description fit what the store allows', () => {
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  for (const [language, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${language} must be 10-100 characters, got ${text.length}`,
    );
  }
});

test('the cameras are reached on the local network only', () => {
  // The Foscam CGI is a LAN API: no cloud channel, so no "prefer local" toggle.
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(!('GLADYS_PREFER_LOCAL' in DEFAULT_CONFIG));
});

test('every manifest action is registered', () => {
  assert.deepEqual(keysOf(manifest.actions), Object.values(ACTIONS).sort());
  for (const key of Object.values(ACTIONS)) {
    assert.match(appSource, new RegExp(`onAction\\('${key}'`), `action "${key}" has no handler`);
  }
});

// The store schema is the admission authority: a field type outside this list,
// or a placeholder that is not a multi-language object, gets the integration
// rejected by the indexer.
const FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'select',
  'multi_select',
  'secret',
  'oauth2',
  'section',
];

test('every field uses a type the store accepts', () => {
  const allFields = [
    ...manifest.config_schema,
    ...(manifest.actions ?? []).flatMap((a) => a.fields ?? []),
    ...(manifest.widgets ?? []).flatMap((w) => w.settings ?? []),
    ...(manifest.scene_triggers ?? []).flatMap((t) => t.fields ?? []),
    ...(manifest.scene_actions ?? []).flatMap((a) => a.fields ?? []),
  ];
  for (const field of allFields) {
    assert.ok(
      FIELD_TYPES.includes(field.type),
      `field "${field.key}": unknown type "${field.type}"`,
    );
    assert.match(field.key, /^[a-z0-9_]+$/, `field key "${field.key}" must be snake_case`);
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder object`);
      assert.ok(
        ['string', 'number', 'secret'].includes(field.type),
        `field "${field.key}": a ${field.type} field cannot have a placeholder`,
      );
    }
    if (field.min !== undefined || field.max !== undefined) {
      assert.equal(field.type, 'number', `field "${field.key}": min/max are number-only`);
    }
    if (field.source !== undefined) {
      assert.equal(field.source, 'devices');
      assert.equal(field.options, undefined, `field "${field.key}": source and options together`);
    }
  }
});

test('the password is a secret field', () => {
  const password = manifest.config_schema.find((field) => field.key === 'password');
  assert.equal(password.type, 'secret');
  assert.equal(password.default, undefined, 'a secret has no default');
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores no value`);
      for (const link of field.links ?? []) {
        assert.match(link.url, /^https:\/\//, 'section links must be https');
      }
      continue;
    }
    assert.ok(
      field.key in DEFAULT_CONFIG,
      `config key "${field.key}" is missing in DEFAULT_CONFIG`,
    );
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
});

const CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  // Added with Gladys 5.3.
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('the categories stay inside the vocabulary the store indexes', () => {
  const { categories } = manifest;
  assert.ok(categories.length >= 1 && categories.length <= 3);
  assert.equal(new Set(categories).size, categories.length);
  for (const category of categories) {
    assert.ok(CATEGORIES.includes(category), `unknown category "${category}"`);
  }
});

test('the Gladys floor covers every field the manifest declares', () => {
  // Older cores reject a manifest field they do not know: `categories` needs
  // 4.86, the widgets and scene declarations 5.1, `keywords` / `countries` /
  // `music` 5.3. The floor is compared as numbers, never as text.
  const [major, minor] = manifest.gladys_version.replace(/^>=/, '').split('.').map(Number);
  const floorAtLeast = (wantMajor, wantMinor) =>
    major > wantMajor || (major === wantMajor && minor >= wantMinor);
  assert.ok(floorAtLeast(5, 1), `got ${manifest.gladys_version}`);
  if (manifest.keywords || manifest.countries || manifest.music) {
    assert.ok(floorAtLeast(5, 3), `keywords/countries/music need >=5.3.0`);
  }
});

test('the search keywords follow the store rules', () => {
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, keywords.length, 'keywords must be unique');
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, `keyword "${keyword}": 2-30 characters`);
  }
});

test('the integration is not limited to some countries', () => {
  // Foscam cameras are sold worldwide and reached on the LAN: declaring
  // `countries` would hide the integration from the catalog shelves elsewhere.
  assert.equal(manifest.countries, undefined);
});

test('every scene action and widget is handled, and every trigger fired is declared', () => {
  assert.deepEqual(keysOf(manifest.scene_actions), Object.values(SCENE_ACTIONS).sort());
  assert.deepEqual(keysOf(manifest.scene_triggers), Object.values(SCENE_TRIGGERS).sort());
  assert.deepEqual(keysOf(manifest.widgets), Object.values(WIDGET_KEYS).sort());
  assert.ok(manifest.widgets.length <= 5, 'the core takes 5 widgets at most');
  assert.match(appSource, /onSceneAction\(key/);
  assert.match(appSource, /onWidgetGet\(key/);
  assert.match(appSource, /onWidgetAction\(key/);
});

test('the options of the manifest are the values of the code', () => {
  const optionsOf = (list, key, field) =>
    manifest[list]
      .find((entry) => entry.key === key)
      .fields.find((entry) => entry.key === field)
      .options.map((option) => option.value)
      .sort();
  assert.deepEqual(
    optionsOf('scene_triggers', 'detection', 'kind'),
    Object.values(DETECTION_KINDS).sort(),
  );
  assert.deepEqual(
    optionsOf('scene_triggers', 'camera_connection', 'state'),
    Object.values(CONNECTION_STATES).sort(),
  );
  assert.deepEqual(
    optionsOf('scene_actions', 'set_night_vision', 'mode'),
    [...NIGHT_VISION_MODES].sort(),
  );
});

test('scene action timeouts stay in the range the core accepts', () => {
  for (const action of manifest.scene_actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120, action.key);
    for (const output of action.outputs ?? []) {
      assert.ok(
        ['string', 'number', 'boolean'].includes(output.type),
        `${action.key}.${output.key}`,
      );
    }
  }
});

/** Every multi-language object of the manifest, with where it sits. */
function multiLanguageTexts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => multiLanguageTexts(child, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  const keys = Object.keys(node);
  if (keys.includes('en') && keys.every((key) => /^[a-z]{2}$/.test(key))) {
    return [{ path, text: node }];
  }
  return keys.flatMap((key) => multiLanguageTexts(node[key], `${path}.${key}`));
}

test('every multi-language text of the manifest carries en, fr, de and es', () => {
  // Gladys shows the reader's language and falls back to English: a text
  // missing one of them shows up in English in the middle of a translated
  // screen. The store accepts any two-letter key, so nothing else catches it.
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50, `only ${texts.length} texts found`);
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path}: languages`);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

test('the per-language length limits of the store hold in every language', () => {
  const within = (text, min, max, where) => {
    for (const language of LANGUAGES) {
      const { length } = text[language];
      assert.ok(length >= min && length <= max, `${where}.${language}: ${length} characters`);
    }
  };
  for (const widget of manifest.widgets) {
    within(widget.label, 3, 30, `widget ${widget.key} label`);
    within(widget.description, 1, 100, `widget ${widget.key} description`);
  }
  for (const section of manifest.config_schema.filter((field) => field.type === 'section')) {
    within(section.description, 1, 1000, `section ${section.key} description`);
  }
});

test('the user documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    const text = await read(`../docs/${language}.md`);
    // Every page documents the same surfaces.
    for (const key of [...Object.values(SCENE_ACTIONS), ...Object.values(SCENE_TRIGGERS)]) {
      assert.ok(text.includes(`\`${key}\``), `docs/${language}.md does not mention ${key}`);
    }
  }
});

test('the cover is a PNG of 800 x 534 under 150 KB', async () => {
  const cover = await readFile(new URL('../cover.png', import.meta.url));
  assert.equal(cover.subarray(1, 4).toString(), 'PNG');
  assert.equal(cover.readUInt32BE(16), 800);
  assert.equal(cover.readUInt32BE(20), 534);
  assert.ok((await stat(new URL('../cover.png', import.meta.url))).size <= 150 * 1024);
});
