import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync, buildSync } from 'esbuild';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const equipmentModule = { exports: {} };
vm.runInNewContext(buildSync({
  entryPoints: [new URL('../src/utils/equipmentConfig.ts', import.meta.url).pathname],
  bundle: true, write: false, platform: 'node', format: 'cjs'
}).outputFiles[0].text, { module: equipmentModule, exports: equipmentModule.exports, URL });
const equipmentUtils = equipmentModule.exports;
// Evaluate the real helper/handler bodies without starting Firebase, Express or disk persistence.
function between(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Source section missing: ${start}`);
  return source.slice(from, to);
}
function evaluate(source, globals = {}) {
  class TestDate extends Date {
    static now() { return Date.parse('2026-11-16T12:00:00.000Z'); }
  }
  const context = vm.createContext({ URL, console, Date: TestDate, ...equipmentUtils, setUndoToast: () => {}, ...globals });
  vm.runInContext(transformSync(source, { loader: 'ts', target: 'es2022' }).code, context);
  return context;
}
const app = read('src/context/AppContext.tsx');
const server = read('server.ts');
const clientHelpers = between(app, '  const nextMonotonicIso =', '  const mergeSnapshotsClientSide =');
const serverHelpers = between(server, 'function preserveServerMediaIfSameTime', 'function mergeConcurrentOfflineSnapshot')
  + between(server, 'function mergeArrayWithAndroidPrimary', 'function mergeSnapshotsWithAndroidPrimary');
const helpers = evaluate(`${clientHelpers}\n${serverHelpers}\nObject.assign(globalThis, { nextMonotonicIso, mergeCollectionById, mergeArrayById, mergeArrayWithAndroidPrimary, preserveServerMediaIfSameTime });`);
const photo = 'data:image/jpeg;base64,/9j/AA==';
const timestamp = '2026-11-16T12:00:00.000Z';
const future = '2030-01-01T00:00:00.000Z';

test('monotonic clock advances beyond a server clock in the future', () => {
  assert.equal(helpers.nextMonotonicIso(future), '2030-01-01T00:00:00.001Z');
  assert.ok(Number.isFinite(Date.parse(helpers.nextMonotonicIso('invalid'))));
});

for (const merge of ['mergeCollectionById', 'mergeArrayById', 'mergeArrayWithAndroidPrimary']) {
  test(`${merge}: quota fallback preserves both photo and photos at the same timestamp`, () => {
    const stored = { id: 'fixture', updated_at: timestamp, photo, photos: [photo], images: [{ id: 'image-fixture', url: photo }], documents: [{ id: 'doc-fixture', url: 'data:application/pdf;base64,AA==' }], name: 'old' };
    const light = { ...stored, photo: null, photos: [], images: [], documents: [], name: 'edited' };
    const [result] = helpers[merge]([stored], [light]);
    assert.equal(result.photo, photo);
    assert.equal(result.photos[0], photo);
    assert.equal(result.images[0].id, 'image-fixture');
    assert.equal(result.documents[0].id, 'doc-fixture');
    assert.equal(result.name, 'edited');
  });
  test(`${merge}: an explicit removal with a newer timestamp stays removed`, () => {
    const [result] = helpers[merge](
      [{ id: 'fixture', updated_at: timestamp, photo, photos: [photo], images: [{ id: 'image-fixture' }], documents: [{ id: 'doc-fixture' }] }],
      [{ id: 'fixture', updated_at: future, photo: null, photos: [], images: [], documents: [] }]
    );
    assert.equal(result.photo, null);
    assert.equal(result.photos.length, 0);
    assert.equal(result.images.length, 0);
    assert.equal(result.documents.length, 0);
  });
}

const arrays = ['customers', 'properties', 'appointments', 'workRecords', 'invoices', 'inquiries', 'offers', 'orders', 'equipments', 'materials', 'expenses'];
const snapshot = (equipments = []) => ({ ...Object.fromEntries(arrays.map((key) => [key, []])), equipments, deletedIds: {}, taxSettings: {} });
function runPut(current, data, revision, source = 'android') {
  let saved;
  let response;
  let merges = 0;
  let handler;
  const globals = {
    app: { put: (_path, _auth, callback) => { handler = callback; } },
    allowAppSyncAccess: () => {},
    recordAndroidSyncActivity: () => {},
    getStore: () => current,
    hasSnapshotAnyRecords: (snap) => arrays.some((key) => snap[key]?.length),
    mergeTombstones: (a, b) => ({ ...a, ...b }),
    preserveServerMediaIfSameTime: helpers.preserveServerMediaIfSameTime,
    mergeSnapshotsWithAndroidPrimary: (a, b) => { merges++; return { ...b, equipments: helpers.mergeArrayWithAndroidPrimary(a.equipments, b.equipments) }; },
    mergeConcurrentOfflineSnapshot: (a, b) => { merges++; return { ...b, equipments: helpers.mergeArrayById(a.equipments, b.equipments) }; },
    saveStore: (data) => { saved = data; return { data, revision: current.revision + 1 }; }
  };
  evaluate(between(server, "  app.put('/api/internal/state'", '  const activeAndroidTunnels'), globals);
  handler({ body: { data, baseRevision: revision, source }, headers: {} }, { json: (value) => { response = value; } });
  return { saved, response, merges };
}
test('PUT at the current revision accepts client state despite an older record clock', () => {
  const current = { revision: 7, data: snapshot([{ id: 'fixture', updated_at: future, name: 'server' }]) };
  const result = runPut(current, snapshot([{ id: 'fixture', updated_at: timestamp, name: 'client' }]), 7);
  assert.equal(result.saved.equipments[0].name, 'client');
  assert.equal(result.response.merged, false);
  assert.equal(result.merges, 0);
  assert.equal('data' in result.response, false);
});
test('PUT at the current revision restores quota-stripped media only at equal timestamps', () => {
  const current = { revision: 7, data: snapshot([{ id: 'fixture', updated_at: timestamp, photo, photos: [photo] }]) };
  const result = runPut(current, snapshot([{ id: 'fixture', updated_at: timestamp, photo: null, photos: [] }]), 7);
  assert.equal(result.saved.equipments[0].photo, photo);
  assert.equal(result.saved.equipments[0].photos[0], photo);
  assert.equal(result.response.merged, false);
  const removed = runPut(current, snapshot([{ id: 'fixture', updated_at: future, photo: null }]), 7);
  assert.equal(removed.saved.equipments[0].photo, null);
});
test('PUT merges unseen server revisions, including a server containing only deletions', () => {
  for (const data of [snapshot(), snapshot([{ id: 'remote', updated_at: timestamp }])]) {
    const result = runPut({ revision: 8, data }, snapshot([{ id: 'local', updated_at: future }]), 7);
    assert.equal(result.merges, 1);
    assert.equal(result.response.merged, true);
  }
});
test('an empty new web tab cannot replace populated server state', () => {
  const current = { revision: 7, data: snapshot([{ id: 'fixture' }]) };
  const result = runPut(current, snapshot(), 0, 'web');
  assert.equal(result.saved, undefined);
  assert.equal(result.response.data.equipments[0].id, 'fixture');
});

function declaration(name) {
  return between(app, `  const ${name} =`, '\n  const ');
}
for (const [method, collection] of [
  ['updateEquipment', 'equipments'], ['updateCustomer', 'customers'],
  ['updateProperty', 'properties'], ['updateWorkRecord', 'workRecords'],
  ['updateAppointment', 'appointments'], ['updateOrder', 'orders'],
  ['updateMaterial', 'materials'], ['updateExpense', 'expenses'], ['recordMaintenance', 'equipments']
]) {
  test(`${method}: an edit advances the record clock beyond its previous timestamp`, async () => {
    const globals = snapshot();
    globals[collection] = [{ id: 'fixture', updated_at: future, name: 'fixture', notes: '', hours: 1, hourly_rate: 50, amount: 10, history: [] }];
    const context = evaluate(`${clientHelpers}\n${declaration(method)}\nglobalThis.mutate = ${method};`, {
      ...globals,
      getTodayLocalIso: () => '2026-11-16',
      extractGoogleEventId: () => null,
      syncAppointmentToGoogleCalendar: async () => 'calendar-fixture',
      attachGoogleEventIdToNotes: (notes) => notes,
      setInvoices: () => {}
    });
    for (const key of arrays) {
      context[`set${key[0].toUpperCase()}${key.slice(1)}`] = (update) => { context[key] = typeof update === 'function' ? update(context[key]) : update; };
    }
    if (method === 'recordMaintenance') context.mutate('fixture', 'Fixture', '', '2027-01-01');
    else context.mutate('fixture', { notes: 'edited' });
    await Promise.resolve();
    assert.ok(context[collection][0].updated_at > future);
  });
}

const imageSource = read('src/utils/imageCompress.ts').replaceAll('export function ', 'function ');
function imageModule(globals = {}) {
  return evaluate(`${imageSource}\nObject.assign(globalThis, { normalizePhotoSrc, compressImageFile });`, globals);
}
test('normalizes JPEG, PNG and WebP base64 before interpreting a leading slash as a path', () => {
  const { normalizePhotoSrc } = imageModule();
  for (const [raw, mime] of [['/9j/AA==', 'jpeg'], ['iVBORw0KGgo=', 'png'], ['UklGRg==', 'webp']]) {
    assert.equal(normalizePhotoSrc(raw), `data:image/${mime};base64,${raw}`);
  }
  for (const valid of [photo, 'blob:https://example.test/image', 'https://example.test/photo.jpg', 'http://example.test/photo.jpg', '/photos/fixture.jpg']) {
    assert.equal(normalizePhotoSrc(valid), valid);
  }
  for (const invalid of [null, '', 'null', 'javascript:alert(1)', 'data:text/html,test', 'https://', '/9j/not-valid!']) {
    assert.equal(normalizePhotoSrc(invalid), null);
  }
});
function compressionFixture({ objectError = false, canvasError = false, readerError = false } = {}) {
  const calls = { reads: 0, revoked: 0, white: false, dimensions: null };
  class Image {
    naturalWidth = 8160;
    naturalHeight = 6120;
    set src(value) { queueMicrotask(() => { if (objectError && value.startsWith('blob:')) this.onerror(); else this.onload(); }); }
  }
  class FileReader {
    result = photo;
    readAsDataURL() { calls.reads++; queueMicrotask(() => readerError ? this.onerror() : this.onload()); }
  }
  const context = imageModule({
    Image, FileReader,
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL: () => { calls.revoked++; } },
    document: { createElement: () => {
      const ctx = { fillStyle: '', fillRect() { calls.white = this.fillStyle === '#FFFFFF'; }, drawImage() {} };
      return { width: 0, height: 0, getContext: () => ctx, toDataURL() { if (canvasError) throw new Error('fixture canvas failure'); calls.dimensions = [this.width, this.height]; return photo; } };
    } }
  });
  return { calls, compress: context.compressImageFile };
}
test('compresses a 50 MP photo using an object URL and a white, bounded canvas', async () => {
  const { calls, compress } = compressionFixture();
  assert.equal(await compress({}, 760), photo);
  assert.equal(calls.reads, 0);
  assert.equal(calls.revoked, 1);
  assert.equal(calls.white, true);
  assert.deepEqual(calls.dimensions, [760, 570]);
});
test('falls back to FileReader after object URL decoding fails', async () => {
  const { calls, compress } = compressionFixture({ objectError: true });
  assert.equal(await compress({}), photo);
  assert.equal(calls.reads, 1);
  assert.equal(calls.revoked, 1);
});
test('FileReader or canvas failure rejects instead of leaving the upload pending', async () => {
  for (const options of [{ objectError: true, readerError: true }, { canvasError: true }]) {
    await assert.rejects(compressionFixture(options).compress({}));
  }
});

test('MCP equipment upsert retains media unless replaced or explicitly removed; control fields never enter specs', () => {
  const source = read('src/server/mcpAdminEngine.ts');
  const context = evaluate(between(source, 'function mutateUpsertOnSnapshotInner(', 'export function upsertCollectionRecord(')
    + '\nglobalThis.upsert = mutateUpsertOnSnapshotInner;', {
    getTodayLocalIso: () => '2026-11-16',
    assertIsoDate: (value) => value,
    addDaysIso: () => '2027-01-01',
    stripHeavyPhotos: (record) => record
  });
  for (const [patch, expected] of [
    [{ has_photo: true, photo_count: 1 }, photo],
    [{ photo: null }, photo],
    [{ photo: 'data:image/png;base64,iVBORw0KGgo=' }, 'data:image/png;base64,iVBORw0KGgo='],
    [{ remove_photo: true }, null]
  ]) {
    const data = snapshot([{ id: 'fixture', name: 'Fixture equipment', photo,
      specs: { remove_photo: 'true', has_photo: 'true', photo_count: '1', motor: '50' } }]);
    context.upsert(data, 'equipments', { id: 'fixture', ...patch,
      specs: { remove_photo: 'false', has_photo: 'true', photo_count: '2', model_code: 'fixture' } });
    assert.equal(data.equipments[0].photo, expected);
    for (const key of ['remove_photo', 'has_photo', 'photo_count']) {
      assert.equal(key in data.equipments[0].specs, false);
      assert.equal(key in data.equipments[0], false);
    }
    assert.equal(data.equipments[0].specs.motor, '50');
  }
});

const workModal = read('src/components/modals/ArbeitModal.tsx');
for (const isCreating of [true, false]) {
  test(`clock start confirmation: ${isCreating ? 'new entry advances to end, preset 17:00' : 'editing closes without advancing to end'}`, () => {
    const context = evaluate(between(workModal, '  const openClockPicker =', '  // Material handlers')
      + '\nglobalThis.confirm = handleConfirmClockPicker;', {
      draftHour: 7, draftMinute: 0, activeTimeField: 'start', clockStep: 'minute',
      startTime: '07:00', endTime: '17:00', isCreating,
      parseTimeToMinutes: (value) => value.split(':').reduce((h, m) => Number(h) * 60 + Number(m)),
      minutesToTimeString: (value) => `${String(Math.floor(value / 60) % 24).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
    });
    for (const key of ['draftHour', 'draftMinute', 'clockStep', 'activeTimeField', 'startTime', 'endTime']) {
      context[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => { context[key] = value; };
    }
    // The selected minute is supplied directly, before React has committed its state update.
    context.confirm(8, 35);
    assert.equal(context.startTime, '08:35');
    assert.equal(context.activeTimeField, isCreating ? 'end' : null);
    assert.equal(context.endTime, '17:00');
    if (isCreating) {
      assert.equal(context.draftHour, 17);
      assert.equal(context.draftMinute, 0);
      assert.equal(context.clockStep, 'hour');
    }
  });
}
test('24h dial maps outer ring to 01–12, inner ring to 13–00, and minutes to five-minute steps', () => {
  const context = evaluate(between(workModal, '              const OUTER_HOURS =', '\n              return (')
    + '\nglobalThis.select = updateFromPointer;', {
    draftHour: 7, draftMinute: 0, clockStep: 'hour',
    clockDialRef: { current: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 248, height: 248 }) } },
    setDraftHour: () => {}, setDraftMinute: () => {}
  });
  assert.equal(context.select(124, 28).hour, 12);
  assert.equal(context.select(124, 64).hour, 0);
  assert.equal(context.select(220, 124).hour, 3);
  assert.equal(context.select(184, 124).hour, 15);
  context.clockStep = 'minute';
  assert.equal(context.select(124, 28).minute, 0);
  assert.equal(context.select(220, 124).minute, 15);
  assert.equal(context.select(28, 124).minute, 45);
});
