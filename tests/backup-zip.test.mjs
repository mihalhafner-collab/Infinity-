import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { crc32, deflateRawSync } from 'node:zlib';
import { transformSync } from 'esbuild';

const source = fs.readFileSync(new URL('../src/utils/backupZip.ts', import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs', target: 'es2022' }).code,
  { module, exports: module.exports, TextDecoder, DecompressionStream, Blob, Response });
const { buildLightWebBackupObject, extractAndroidBackupForWebApp } = module.exports;
const photo = 'data:image/jpeg;base64,/9j/AA==';
const data = {
  customers: [{ id: 'customer-fixture', name: 'Fixture customer', phone: '0000', photo }],
  equipments: [{ id: 'equipment-fixture', name: 'Fixture equipment', photo }],
  properties: [{ id: 'property-fixture', photos: [photo] }],
  workRecords: [{ id: 'work-fixture', photos: [photo], notes: 'Fixture text '.repeat(30000) }],
  invoices: [{ id: 'invoice-fixture', total: 123.45 }]
};

// Construct standard ZIP fixtures independently of the importer, with valid CRC/header records.
function zip(entries, method = 8) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, object] of entries) {
    const fileName = Buffer.from(name);
    const bytes = Buffer.from(JSON.stringify(object));
    const packed = method === 8 ? deflateRawSync(bytes) : bytes;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc32(bytes), 14);
    header.writeUInt32LE(packed.length, 18);
    header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(fileName.length, 26);
    local.push(header, fileName, packed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(method, 10);
    record.writeUInt32LE(crc32(bytes), 16);
    record.writeUInt32LE(packed.length, 20);
    record.writeUInt32LE(bytes.length, 24);
    record.writeUInt16LE(fileName.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, fileName);
    offset += header.length + fileName.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new File([Buffer.concat([...local, directory, end])], 'fixture.zip');
}
function assertBusinessData(backup) {
  assert.equal(backup.customers[0].phone, data.customers[0].phone);
  assert.equal(backup.workRecords[0].notes, data.workRecords[0].notes);
  assert.equal(backup.invoices[0].total, data.invoices[0].total);
  assert.equal(backup.customers[0].photo, null);
  assert.equal(backup.equipments[0].photo, null);
  assert.equal(backup.workRecords[0].photos.length, 0);
  assert.equal(backup.properties[0].photos.length, 0);
}
test('light backup preserves business fields without changing the full backup', () => {
  assertBusinessData(buildLightWebBackupObject(data));
  assert.equal(data.customers[0].photo, photo);
  assert.equal(data.workRecords[0].photos[0], photo);
});
test('plain JSON backup imports business data', async () => {
  assertBusinessData(await extractAndroidBackupForWebApp(new File([JSON.stringify(data)], 'fixture.json')));
});
for (const method of [0, 8]) {
  test(`large ZIP backup imports without stalling (compression method ${method})`, { timeout: 3000 }, async () => {
    assertBusinessData(await extractAndroidBackupForWebApp(zip([['hausgarten_backup_v1.json', data]], method)));
  });
}
test('ZIP import prefers the compact web backup when both variants are present', async () => {
  const file = zip([
    ['hausgarten_backup_v1.json', data],
    ['hausgarten_webapp_light.json', { customers: [{ id: 'light-fixture' }] }]
  ]);
  assert.equal((await extractAndroidBackupForWebApp(file)).customers[0].id, 'light-fixture');
});
