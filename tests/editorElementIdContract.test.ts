import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement, type FunctionComponent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, assert, beforeAll, test, vi } from 'vitest';
import { ANIMATION_IDS, RIG_TWEAK_SESSION_IDS } from '../src/devtools/animation-editor/elementIds.js';
import { RIG_IDS, RIG_SESSION_IDS } from '../src/devtools/rig-editor/elementIds.js';

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock('phaser', () => ({ default: { Scene: class {}, Scenes: { Events: {} }, GameObjects: { Events: {} } } }));

const SOURCE_ROOT = join(import.meta.dirname, '../src/devtools');
const EDITOR_DIRS = ['animation-editor', 'rig-editor'].map((name) => join(SOURCE_ROOT, name));
const TABLES = { ANIMATION_IDS, RIG_TWEAK_SESSION_IDS, RIG_IDS, RIG_SESSION_IDS } as const;
type TableName = keyof typeof TABLES;
/** Hosts the character workspace in animation-editor/main.tsx renders around both views. */
const WORKSPACE_HOSTS = { [ANIMATION_IDS.app]: 'ANIMATION_IDS.app', [RIG_IDS.app]: 'RIG_IDS.app' };
/** Ids that render only in a state the contract render does not set up. */
const CONDITIONAL: Record<string, string> = {
  [RIG_IDS.meshDiagnosticsStatus]: 'renders only while a mesh attachment is selected',
};
const TAGS: Record<string, readonly string[]> = {
  HTMLButtonElement: ['button'],
  HTMLDetailsElement: ['details'],
  HTMLDialogElement: ['dialog'],
  HTMLFieldSetElement: ['fieldset'],
  HTMLFormElement: ['form'],
  HTMLInputElement: ['input'],
  HTMLOptionElement: ['option'],
  HTMLSelectElement: ['select'],
  HTMLTextAreaElement: ['textarea'],
  SVGGElement: ['g'],
  SVGLineElement: ['line'],
  SVGSVGElement: ['svg'],
};
/** Lookups through a variable holding a table: the session controller binds either copy of the session controls. */
const TABLE_VARIABLES: Record<string, readonly TableName[]> = {
  [join('rig-editor', 'SessionController.ts') + ':ids']: ['RIG_SESSION_IDS', 'RIG_TWEAK_SESSION_IDS'],
};
const SVG_TAGS = new Set(['svg', 'g', 'line', 'path', 'circle', 'rect', 'polyline', 'polygon', 'text']);
const HEX_COLOUR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const STRING_LITERAL = /(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

const CALL_ARGUMENT = /[\w>]\(\s*$/;

/**
 * String literals in source that look up an element by `#id` instead of going through a table.
 * A literal `#id` anywhere counts; a `#${…}` template counts only as a call argument (elsewhere it may be a colour).
 */
function idSelectorLiterals(source: string): string[] {
  return [...source.matchAll(STRING_LITERAL)]
    .filter(({ 2: body, index }) => {
      if (HEX_COLOUR.test(body!)) return false;
      if (/#[a-z]/i.test(body!)) return true;
      return /#\$\{/.test(body!) && CALL_ARGUMENT.test(source.slice(Math.max(0, index - 40), index));
    })
    .map(([, , body]) => body!);
}

/** `requireElement(root, TABLE.key, Type)` and `optionalElement(…)` call sites in one source file. */
function typedLookups(source: string): { table: string; key: string; type: string }[] {
  return [...source.matchAll(/(?:require|optional)Element\(\s*[^,]+,\s*(\w+)\.(\w+),\s*(\w+)\s*\)/g)].map(
    ([, table, key, type]) => ({ table: table!, key: key!, type: type! }),
  );
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && entry.name !== 'elementIds.ts' ? [path] : [];
  });
}

function idCounts(html: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [, id] of html.matchAll(/\sid="([^"]+)"/g)) counts.set(id!, (counts.get(id!) ?? 0) + 1);
  return counts;
}

function tagOf(html: string, id: string): string | undefined {
  return new RegExp(`<([a-zA-Z][\\w-]*)\\b[^>]*\\sid="${id}"`).exec(html)?.[1]?.toLowerCase();
}

let markup: { animation: string; animationProject: string; rig: string };

beforeAll(async () => {
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }), localStorage: storage });
  vi.stubGlobal('localStorage', storage);
  const { AnimationEditorView } = await import('../src/devtools/animation-editor/editorMarkup.js');
  const { RigEditorView } = await import('../src/devtools/rig-editor/editorMarkup.js');
  const { AnimationLibraryController } = await import('../src/devtools/animation-editor/AnimationLibraryController.js');
  const { AnimationVariationController } =
    await import('../src/devtools/animation-editor/AnimationVariationController.js');
  const { EnvironmentPreviewController } =
    await import('../src/devtools/animation-editor/EnvironmentPreviewController.js');
  const { FootContactGroundController } =
    await import('../src/devtools/animation-editor/FootContactGroundController.js');
  const { IKBakeController } = await import('../src/devtools/animation-editor/IKBakeController.js');
  const { IKInspectorController } = await import('../src/devtools/animation-editor/IKInspectorController.js');
  const { KeyframeRetimingController } = await import('../src/devtools/animation-editor/KeyframeRetimingController.js');
  const { MirrorToolsController } = await import('../src/devtools/animation-editor/MirrorToolsController.js');
  const { MotionDiagnosticsController } =
    await import('../src/devtools/animation-editor/MotionDiagnosticsController.js');
  const { MotionPreviewController } = await import('../src/devtools/animation-editor/MotionPreviewController.js');
  const { NewAnimationController } = await import('../src/devtools/animation-editor/NewAnimationController.js');
  const { PoseLibraryController } = await import('../src/devtools/animation-editor/PoseLibraryController.js');
  const { RigTweakController } = await import('../src/devtools/animation-editor/RigTweakController.js');
  const { AttachmentController } = await import('../src/devtools/rig-editor/AttachmentController.js');
  const { ArtworkController } = await import('../src/devtools/shared/artwork/ArtworkController.js');
  const { GroundGuideWorkspace } = await import('../src/devtools/shared/GroundGuideWorkspace.js');
  const { PackageController } = await import('../src/devtools/shared/package/PackageController.js');

  // RigEditorView's props are optional, which createElement's overloads do not infer.
  const rigView = RigEditorView as FunctionComponent<NonNullable<Parameters<typeof RigEditorView>[0]>>;
  // The same controllers and optional panels animation-editor/main.tsx passes to the active view.
  const artwork = new ArtworkController();
  const attachments = new AttachmentController(artwork);
  const packages = new PackageController();
  const groundGuide = new GroundGuideWorkspace('animation-preview-world');
  const animation = {
    mirrorTools: new MirrorToolsController(
      () => {},
      () => storage,
    ),
    poseLibrary: new PoseLibraryController(),
    newAnimation: new NewAnimationController(),
    variations: new AnimationVariationController(),
    animationLibrary: new AnimationLibraryController(),
    ikInspector: new IKInspectorController(),
    ikBake: new IKBakeController(() => {}),
    retiming: new KeyframeRetimingController(),
    motionDiagnostics: new MotionDiagnosticsController(),
    rigTweak: new RigTweakController(attachments),
    footContacts: new FootContactGroundController(),
    environment: new EnvironmentPreviewController(),
    motionPreview: new MotionPreviewController(),
    groundGuide,
    packages,
    artwork,
    attachments,
  };
  markup = {
    animation: renderToStaticMarkup(createElement(AnimationEditorView, animation)),
    animationProject: renderToStaticMarkup(
      createElement(AnimationEditorView, { ...animation, projectEnvironment: true }),
    ),
    rig: renderToStaticMarkup(createElement(rigView, { packages, artwork, attachments, groundGuide })),
  };
});
afterAll(() => vi.unstubAllGlobals());

const views = () =>
  [
    { view: 'AnimationEditorView', html: markup.animation, tables: ['ANIMATION_IDS', 'RIG_TWEAK_SESSION_IDS'] },
    {
      view: 'AnimationEditorView (project)',
      html: markup.animationProject,
      tables: ['ANIMATION_IDS', 'RIG_TWEAK_SESSION_IDS'],
    },
    { view: 'RigEditorView', html: markup.rig, tables: ['RIG_IDS', 'RIG_SESSION_IDS'] },
  ] as const;
const editorSources = () =>
  EDITOR_DIRS.flatMap(sourceFiles).map((path) => ({
    file: relative(SOURCE_ROOT, path),
    source: readFileSync(path, 'utf8'),
  }));

test('the id selector scan flags literal id lookups and ignores colours and table lookups', () => {
  assert.deepEqual(idSelectorLiterals(`app.querySelector('#animation-facing')!`), ['#animation-facing']);
  assert.deepEqual(idSelectorLiterals('app.querySelector(`#tweak-${id}`)'), ['#tweak-${id}']);
  assert.deepEqual(idSelectorLiterals('this.element<HTMLInputElement>(`#${id}`)'), ['#${id}']);
  assert.deepEqual(idSelectorLiterals(`document.querySelector('#a > summary')`), ['#a > summary']);
  assert.deepEqual(idSelectorLiterals(`label('Start', x, y, '#a53d21'); fill = "#fff";`), []);
  assert.deepEqual(idSelectorLiterals('input.value = `#${tint.toString(16)}`;'), []);
  assert.deepEqual(idSelectorLiterals(`requireElement(app, ANIMATION_IDS.facing, HTMLSelectElement)`), []);
});

test('every table id renders exactly once in its view', () => {
  const problems = views().flatMap(({ view, html, tables }) => {
    const counts = idCounts(html);
    return tables.flatMap((table) =>
      Object.entries(TABLES[table]).flatMap(([key, id]) => {
        const count = counts.get(id) ?? 0;
        if (id in WORKSPACE_HOSTS) return count === 0 ? [] : [`${view}: ${table}.${key} "${id}" is a workspace host`];
        if (id in CONDITIONAL) return count <= 1 ? [] : [`${view}: ${table}.${key} "${id}" renders ${count} times`];
        return count === 1 ? [] : [`${view}: ${table}.${key} "${id}" renders ${count} times`];
      }),
    );
  });
  assert.deepEqual(problems, []);
});

test('each editor table maps every key to a different id', () => {
  for (const tables of [
    ['ANIMATION_IDS', 'RIG_TWEAK_SESSION_IDS'],
    ['RIG_IDS', 'RIG_SESSION_IDS'],
  ] as const) {
    const ids = tables.flatMap((table) => Object.values(TABLES[table]));
    assert.deepEqual(
      ids.filter((id, index) => ids.indexOf(id) !== index),
      [],
    );
  }
});

test('workspace hosts and conditional ids are rendered from the tables', () => {
  const sources = editorSources();
  const main = sources.find(({ file }) => file === join('animation-editor', 'main.tsx'))!.source;
  for (const reference of Object.values(WORKSPACE_HOSTS)) assert.include(main, `id={${reference}}`);
  for (const id of Object.keys(CONDITIONAL)) {
    const [table, key] = Object.entries(TABLES).flatMap(([name, entries]) =>
      Object.entries(entries)
        .filter(([, value]) => value === id)
        .map(([entry]) => [name, entry] as const),
    )[0]!;
    assert.isTrue(
      sources.some(({ source }) => source.includes(`id={${table}.${key}}`)),
      `no markup renders id={${table}.${key}}`,
    );
  }
});

test('editor markup renders table ids through the table, not as literals', () => {
  const tableIds = new Set<string>(Object.values(TABLES).flatMap((table) => Object.values(table)));
  const literals = editorSources()
    .filter(({ file }) => file.endsWith('.tsx'))
    .flatMap(({ file, source }) =>
      [...source.matchAll(/\b(?:id|htmlFor)="([^"]+)"/g)]
        .filter(([, id]) => tableIds.has(id!))
        .map(([attribute]) => `${file}: ${attribute}`),
    );
  assert.deepEqual(literals, []);
});

test('each element lookup claims the type of the element its id renders', () => {
  const htmlFor = (table: TableName) =>
    table === 'RIG_IDS' || table === 'RIG_SESSION_IDS' ? markup.rig : markup.animation;
  const problems = editorSources().flatMap(({ file, source }) =>
    typedLookups(source).flatMap(({ table: name, key, type }) => {
      const tables = name in TABLES ? [name as TableName] : TABLE_VARIABLES[`${file}:${name}`];
      if (!tables) return [`${file}: ${name}.${key} is not an element id table`];
      return tables.flatMap((table) => checkLookup(file, table, key, type, htmlFor(table)));
    }),
  );
  assert.deepEqual(problems, []);
});

/** Problems with one `requireElement(root, TABLE.key, Type)` call site, checked against its view's markup. */
function checkLookup(file: string, table: TableName, key: string, type: string, html: string): string[] {
  const id = (TABLES[table] as Record<string, string>)[key];
  if (!id) return [`${file}: ${table}.${key} is not in the table`];
  if (id in WORKSPACE_HOSTS) return type === 'HTMLElement' ? [] : [`${file}: ${table}.${key} is a <div> host`];
  const tag = tagOf(html, id);
  if (!tag) return id in CONDITIONAL ? [] : [`${file}: ${table}.${key} "${id}" is not rendered`];
  if (type === 'HTMLElement')
    return SVG_TAGS.has(tag) ? [`${file}: ${table}.${key} is an SVG <${tag}>, not an HTMLElement`] : [];
  const tags = TAGS[type];
  if (!tags) return [`${file}: add ${type} to TAGS in this test`];
  return tags.includes(tag) ? [] : [`${file}: ${table}.${key} is a <${tag}>, not an ${type}`];
}

/** Ids that a stylesheet's selectors name, ignoring comments and declarations (where `#` starts a colour). */
function cssIdSelectors(css: string): string[] {
  const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{[^{}]*\}/g, ',');
  return [...selectors.matchAll(/#([a-zA-Z][\w-]*)/g)].map(([, id]) => id!);
}

test('the stylesheet id scan reads selectors, not colours', () => {
  assert.deepEqual(cssIdSelectors('/* #note */ #timeline .key:hover, .a > #tweak-inspector { color: #a53d21; }'), [
    'timeline',
    'tweak-inspector',
  ]);
});

test("every id the editors' stylesheets select renders in a view", () => {
  const rendered = new Set([...idCounts(markup.animation).keys(), ...idCounts(markup.rig).keys()]);
  const stale = EDITOR_DIRS.flatMap((directory) =>
    readdirSync(directory)
      .filter((name) => name.endsWith('.css'))
      .flatMap((name) =>
        cssIdSelectors(readFileSync(join(directory, name), 'utf8'))
          .filter((id) => !rendered.has(id) && !(id in WORKSPACE_HOSTS))
          .map((id) => `${relative(SOURCE_ROOT, join(directory, name))}: #${id}`),
      ),
  );
  assert.deepEqual([...new Set(stale)], []);
});

test('the editors look up elements only through the id tables', () => {
  const found = editorSources().flatMap(({ file, source }) => [
    ...idSelectorLiterals(source).map((literal) => `${file}: '${literal}'`),
    ...[...source.matchAll(/getElementById\(/g)].map(() => `${file}: getElementById(`),
  ]);
  assert.deepEqual(found, []);
});
