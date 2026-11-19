const assert = require('assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  getDefaultMemoryDir,
  getStoragePaths,
  previewStorageRoot,
  saveData,
  setStorageRoot
} = require('../src/storage/localDataStore');
const { resolveSelectedMemoryRoot } = require('../src/storage/storagePathSelection');

(async () => {
  const testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'rizhi-storage-test-'));
  const userData = path.join(testRoot, 'user-data');
  const appRoot = path.join(testRoot, 'app');
  const app = {
    isPackaged: false,
    getPath(name) {
      if (name !== 'userData') throw new Error(`Unexpected app path: ${name}`);
      return userData;
    },
    getAppPath() {
      return appRoot;
    }
  };
  assert.equal(getDefaultMemoryDir({
    isPackaged: true,
    getPath(name) {
      assert.equal(name, 'exe');
      return path.join(testRoot, 'chosen', 'rizhi', 'rizhi', '日织.exe');
    }
  }), path.join(testRoot, 'chosen', 'rizhi', 'memory'));
  const selectedAppRoot = path.join(testRoot, 'chosen', 'rizhi');
  assert.equal(resolveSelectedMemoryRoot(path.dirname(selectedAppRoot)), path.join(selectedAppRoot, 'memory'));
  assert.equal(resolveSelectedMemoryRoot(selectedAppRoot), path.join(selectedAppRoot, 'memory'));
  assert.equal(resolveSelectedMemoryRoot(path.join(selectedAppRoot, 'memory')), path.join(selectedAppRoot, 'memory'));

  try {
    const initialPaths = await getStoragePaths(app);
    assert.equal(initialPaths.dataDirectory, path.join(appRoot, 'memory'));
    const mediaRelativePath = '2026-09/2026-09-26/photo.jpg';
    const initialMediaFile = path.join(initialPaths.mediaDirectory, ...mediaRelativePath.split('/'));
    await fs.mkdir(path.dirname(initialMediaFile), { recursive: true });
    await fs.writeFile(initialMediaFile, 'media-one');
    const unrelatedFile = path.join(initialPaths.dataDirectory, 'keep-me.txt');
    await fs.writeFile(unrelatedFile, 'user-file');
    const nestedUnrelatedFile = path.join(initialPaths.dataDirectory, 'custom', 'nested', 'keep-too.txt');
    await fs.mkdir(path.dirname(nestedUnrelatedFile), { recursive: true });
    await fs.writeFile(nestedUnrelatedFile, 'nested-user-file');

    const data = {
      version: 2,
      tasks: [{
        id: 'task-1',
        date: '2026-09-26',
        startTime: '23:00',
        endTime: '01:30',
        title: '测试任务',
        timeModel: 'start-date-v1',
        statusPolicy: 'auto-after-end'
      }],
      journals: [{
        id: 'journal-1',
        date: '2026-09-26',
        content: '测试记录',
        tagId: 'legacy-5',
        tagIds: ['legacy-3', 'legacy-5'],
        media: [{ id: 'media-1', kind: 'image', sourcePath: mediaRelativePath, mediaRoot: initialPaths.mediaDirectory }]
      }],
      profile: { classDuration: 50 }
    };
    await saveData(app, data);
    const savedMonth = JSON.parse(await fs.readFile(path.join(initialPaths.dataDirectory, '2026-09', 'rizhi-data-2026-09.json'), 'utf8'));
    assert.equal(savedMonth.tasks.length, 1);
    assert.equal(savedMonth.tasks[0].endTime, '01:30');
    assert.equal(savedMonth.tasks[0].timeModel, 'start-date-v1');
    assert.equal(savedMonth.tasks[0].statusPolicy, 'auto-after-end');
    assert.deepEqual(savedMonth.journals[0].tagIds, ['legacy-3', 'legacy-5']);
    assert.equal(Object.hasOwn(savedMonth.journals[0], 'tagId'), false);

    const nextStorageRoot = path.join(testRoot, 'migrated-root');
    const dataMigration = await setStorageRoot(app, nextStorageRoot, data);
    const migratedMediaRoot = nextStorageRoot;
    assert.equal(dataMigration.paths.storageRoot, nextStorageRoot);
    assert.equal(dataMigration.paths.dataDirectory, nextStorageRoot);
    assert.equal(dataMigration.paths.settingsFilePath, path.join(nextStorageRoot, 'rizhi-settings.json'));
    assert.equal(dataMigration.paths.settingsLocationPath, path.join(userData, 'rizhi-settings-location.json'));
    assert.equal(dataMigration.paths.mediaDirectory, migratedMediaRoot);
    assert.equal(dataMigration.data.journals[0].media[0].mediaRoot, migratedMediaRoot);
    const migratedMonth = JSON.parse(await fs.readFile(path.join(nextStorageRoot, '2026-09', 'rizhi-data-2026-09.json'), 'utf8'));
    assert.equal(migratedMonth.tasks.length, 1);
    assert.equal(migratedMonth.tasks[0].timeModel, 'start-date-v1');
    assert.deepEqual(migratedMonth.journals[0].tagIds, ['legacy-3', 'legacy-5']);
    assert.equal(Object.hasOwn(migratedMonth.journals[0], 'tagId'), false);
    assert.equal(await fs.readFile(path.join(migratedMediaRoot, ...mediaRelativePath.split('/')), 'utf8'), 'media-one');
    assert.equal(await fs.readFile(initialMediaFile, 'utf8'), 'media-one');
    assert.equal(JSON.parse(await fs.readFile(path.join(initialPaths.dataDirectory, '2026-09', 'rizhi-data-2026-09.json'), 'utf8')).tasks.length, 1);
    assert.equal(await fs.readFile(path.join(nextStorageRoot, 'keep-me.txt'), 'utf8'), 'user-file');
    assert.equal(await fs.readFile(path.join(nextStorageRoot, 'custom', 'nested', 'keep-too.txt'), 'utf8'), 'nested-user-file');
    assert.equal(await fs.readFile(unrelatedFile, 'utf8'), 'user-file');

    const reloadedPaths = await getStoragePaths(app);
    assert.equal(reloadedPaths.storageRoot, nextStorageRoot);
    assert.equal(reloadedPaths.mediaDirectory, migratedMediaRoot);

    const occupiedRoot = path.join(testRoot, 'occupied-root');
    const occupiedMonth = path.join(occupiedRoot, '2026-09');
    await fs.mkdir(path.join(occupiedMonth, '2026-09-26'), { recursive: true });
    await fs.writeFile(path.join(occupiedMonth, 'rizhi-data-2026-09.json'), JSON.stringify({
      version: 2,
      tasks: [
        { ...data.tasks[0], title: '目标地址版本' },
        { id: 'target-task', date: '2026-09-27', title: '仅在目标地址' }
      ],
      journals: [],
      profile: { classDuration: 45, targetOnlySetting: true }
    }));
    await fs.writeFile(path.join(occupiedMonth, '2026-09-26', 'photo.jpg'), 'target-media');
    const untouchedMonth = path.join(occupiedRoot, '2026-10', 'rizhi-data-2026-10.json');
    await fs.mkdir(path.dirname(untouchedMonth), { recursive: true });
    await fs.writeFile(untouchedMonth, JSON.stringify({ tasks: [{ id: 'october-task', date: '2026-10-01', title: '十月任务' }], journals: [], profile: {} }));
    await fs.writeFile(path.join(occupiedRoot, 'rizhi-settings.json'), JSON.stringify({ profile: { classDuration: 45, targetOnlySetting: true } }));
    const planned = await previewStorageRoot(app, occupiedRoot, dataMigration.data);
    assert.equal(planned.added.journals, 1);
    assert.ok(planned.conflicts.some((item) => item.includes('任务 ID task-1')));
    assert.ok(planned.conflicts.some((item) => item.includes('photo.jpg')));

    const mergedMigration = await setStorageRoot(app, occupiedRoot, dataMigration.data);
    assert.equal(mergedMigration.data.tasks.find((item) => item.id === 'task-1').title, '目标地址版本');
    assert.equal(mergedMigration.data.tasks.find((item) => item.id === 'target-task').title, '仅在目标地址');
    assert.equal(mergedMigration.data.tasks.find((item) => item.id === 'october-task').title, '十月任务');
    assert.equal(mergedMigration.data.journals.length, 1);
    assert.equal(mergedMigration.data.profile.classDuration, 45);
    assert.equal(mergedMigration.data.profile.targetOnlySetting, true);
    assert.equal(await fs.readFile(path.join(occupiedMonth, '2026-09-26', 'photo.jpg'), 'utf8'), 'target-media');
    const copiedMedia = mergedMigration.data.journals[0].media[0];
    assert.notEqual(copiedMedia.sourcePath, mediaRelativePath);
    assert.equal(await fs.readFile(path.join(occupiedRoot, ...copiedMedia.sourcePath.split('/')), 'utf8'), 'media-one');
    assert.equal(await fs.readFile(path.join(nextStorageRoot, ...mediaRelativePath.split('/')), 'utf8'), 'media-one');
    assert.ok(mergedMigration.migration.conflicts.some((item) => item.includes('photo.jpg')));
    assert.ok((await fs.readdir(occupiedMonth)).some((name) => name.startsWith('rizhi-data-2026-09.json.before-migration-')));
    assert.ok((await fs.readdir(occupiedRoot)).some((name) => name.startsWith('rizhi-settings.json.before-migration-')));
    assert.equal(JSON.parse(await fs.readFile(untouchedMonth, 'utf8')).tasks[0].title, '十月任务');

    const corruptRoot = path.join(testRoot, 'corrupt-target');
    await fs.mkdir(path.join(corruptRoot, '2026-09'), { recursive: true });
    await fs.writeFile(path.join(corruptRoot, '2026-09', 'rizhi-data-2026-09.json'), '{invalid');
    await assert.rejects(previewStorageRoot(app, corruptRoot, mergedMigration.data), /无法读取目标数据文件/);
    assert.equal((await getStoragePaths(app)).dataDirectory, occupiedRoot);

    const nestedApp = {
      isPackaged: false,
      getPath: () => path.join(testRoot, 'nested-user-data'),
      getAppPath: () => path.join(testRoot, 'nested-app')
    };
    await saveData(nestedApp, data);
    const intendedMemory = path.join(testRoot, 'nested-layout', 'rizhi', 'memory');
    const accidentalMemory = path.join(intendedMemory, 'rizhi', 'memory');
    const accidental = await setStorageRoot(nestedApp, accidentalMemory, data);
    const restored = await setStorageRoot(nestedApp, intendedMemory, accidental.data);
    assert.equal(restored.paths.dataDirectory, intendedMemory);
    assert.equal(restored.data.tasks[0].title, '测试任务');
    assert.equal((await fs.stat(accidentalMemory)).isDirectory(), true);

    console.log('localDataStore migration tests passed');
  } finally {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
